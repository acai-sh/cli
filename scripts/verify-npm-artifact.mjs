#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");

await main();

async function main() {
  assertRealNodeRuntime();

  const canonicalSkill = await readFile(
    join(workspaceRoot, ".agents", "skills", "acai", "SKILL.md"),
    "utf8",
  );

  const tempRoot = await mkdtemp(join(tmpdir(), "acai-npm-artifact-"));

  try {
    const tarballPath = await packArtifact(tempRoot);
    const installRoot = await installPackedArtifact(tarballPath, tempRoot);
    const packageRoot = join(installRoot, "node_modules", "@acai.sh", "cli");
    const entrypoint = join(packageRoot, "dist", "acai.js");
    const binPath = join(installRoot, "node_modules", ".bin", "acai");

    await access(entrypoint);
    await access(binPath);

    const api = await createMockApiServer();
    try {
      await verifyHelpOutput(binPath, api.env, api.requests);
      await verifySkillCommand(binPath, canonicalSkill, api.env, api.requests);
      await verifyPushCommand(binPath, api.env, api.requests);
      await verifySetStatusFileInput(binPath, api.env);
      await verifySetStatusStdinInput(binPath, api.env);
      await verifyJsonStdoutStderrSeparation(binPath, api.env);

      console.log("cli-core.DIST.1 verified with packed npm artifact under real Node.");
    } finally {
      await api.stop();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function assertRealNodeRuntime() {
  if (process.versions.bun || process.execPath.includes("bun-node-fallback-bin")) {
    throw new Error(
      "cli-core.DIST.1 verification requires a real Node runtime. In this devcontainer, `node` resolves to Bun's fallback. Run this script only after provisioning Node explicitly, such as with actions/setup-node.",
    );
  }
}

async function packArtifact(tempRoot) {
  const packDir = join(tempRoot, "pack");
  await mkdir(packDir, { recursive: true });
  await runCommand("npm", ["pack", "--pack-destination", packDir], {
    cwd: workspaceRoot,
  });
  return join(packDir, "acai.tgz");
}

async function installPackedArtifact(tarballPath, tempRoot) {
  const installRoot = join(tempRoot, "install");
  await mkdir(installRoot, { recursive: true });
  await writeFile(join(installRoot, "package.json"), '{"private":true}');
  await runCommand("npm", ["install", "--no-package-lock", tarballPath], {
    cwd: installRoot,
  });
  return installRoot;
}

// cli-core.HELP.1 / cli-core.HELP.3 / cli-core.HELP.4 / cli-core.UX.1 / cli-core.UX.2
async function verifyHelpOutput(binPath, env, requests) {
  const baselineRequests = requests.length;
  const topLevel = await runInstalledCli(binPath, [], { env });
  assert.equal(topLevel.exitCode, 0);
  assert.equal(topLevel.stderr, "");
  assert.match(topLevel.stdout, /Usage: acai/);

  const commandHelp = await runInstalledCli(binPath, ["push", "--help"], { env });
  assert.equal(commandHelp.exitCode, 0);
  assert.equal(commandHelp.stderr, "");
  assert.match(commandHelp.stdout, /Usage: acai push/);

  assert.equal(requests.length, baselineRequests);
}

// skill.MAIN.2 / skill.MAIN.3 / skill.WRITE.1 / skill.WRITE.2 / skill.SAFETY.1 / skill.SAFETY.3 / skill.UX.1 / skill.UX.2
async function verifySkillCommand(binPath, canonicalSkill, env, requests) {
  const workspace = await createWorkspace({}, "acai-npm-skill-");
  const installPath = join(workspace.root, ".agents", "skills", "acai", "SKILL.md");
  const baselineRequests = requests.length;

  try {
    const printResult = await runInstalledCli(binPath, ["skill"], {
      cwd: workspace.root,
      env,
    });
    assert.equal(printResult.exitCode, 0);
    assert.equal(printResult.stderr, "");
    assert.equal(printResult.stdout, canonicalSkill);

    const installResult = await runInstalledCli(binPath, ["skill", "--install"], {
      cwd: workspace.root,
      env,
    });
    assert.equal(installResult.exitCode, 0);
    assert.equal(installResult.stdout, "");
    assert.equal(installResult.stderr, "");
    assert.equal(await readFile(installPath, "utf8"), canonicalSkill);

    assert.equal(requests.length, baselineRequests);
  } finally {
    await workspace.cleanup();
  }
}

// push.MAIN.3 / push.MAIN.7 / push.MAIN.8 / push.SCAN.1 / push.SCAN.2 / push.SCAN.2-1 / push.SCAN.3 / push.UX.1
async function verifyPushCommand(binPath, env, requests) {
  const workspace = await createWorkspace(
    {
      "features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n",
      "src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n',
    },
    "acai-npm-push-",
  );
  const git = await createFakeGitContext({
    topLevel: workspace.root,
    fileCommits: { "features/alpha.feature.yaml": "a1" },
  });

  try {
    const result = await runInstalledCli(binPath, ["push", "--all"], {
      cwd: workspace.root,
      env: {
        ...env,
        PATH: `${git.binDir}:${process.env.PATH ?? ""}`,
      },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /product-a/);

    const pushRequest = requests.find((request) => request.path === "/push");
    assert.ok(pushRequest, "expected packaged push command to call /push");
    assert.equal(pushRequest.body.repo_uri, "github.com/my-org/my-repo");
    assert.equal(pushRequest.body.branch_name, "main");
    assert.equal(pushRequest.body.specs[0].feature_name, "alpha");
    assert.deepEqual(pushRequest.body.references.data["alpha.MAIN.1"], [
      { path: "src/alpha.ts:1", is_test: false },
    ]);
  } finally {
    await git.cleanup();
    await workspace.cleanup();
  }
}

// set-status.MAIN.2 / set-status.UX.2
async function verifySetStatusFileInput(binPath, env) {
  const workspace = await createWorkspace(
    {
      "states.json": '{"set-status.MAIN.1":{"status":"completed"}}',
    },
    "acai-npm-set-status-file-",
  );

  try {
    const result = await runInstalledCli(
      binPath,
      ["set-status", "@states.json", "--product", "example-product", "--impl", "main"],
      { cwd: workspace.root, env },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /STATES_WRITTEN/);
  } finally {
    await workspace.cleanup();
  }
}

// set-status.MAIN.3 / set-status.UX.2
async function verifySetStatusStdinInput(binPath, env) {
  const result = await runInstalledCli(
    binPath,
    ["set-status", "-", "--product", "example-product", "--impl", "main"],
    {
      env,
      input: '{"set-status.INPUT.1":{"status":null}}',
    },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /STATES_WRITTEN/);
}

// cli-core.OUTPUT.1 / cli-core.OUTPUT.2 / set-status.MAIN.6
async function verifyJsonStdoutStderrSeparation(binPath, env) {
  const result = await runInstalledCli(
    binPath,
    ["set-status", '{"set-status.MAIN.1":{"status":"completed"}}', "--product", "example-product", "--impl", "main", "--json"],
    { env },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /warning one/);
  assert.equal(JSON.parse(result.stdout).data.feature_name, "set-status");
}

async function runInstalledCli(binPath, args, options = {}) {
  return runCommand(binPath, args, options);
}

async function runCommand(command, args, options = {}) {
  const proc = spawn(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (options.input !== undefined) {
    proc.stdin.end(options.input);
  } else {
    proc.stdin.end();
  }

  let stdout = "";
  let stderr = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolvePromise, reject) => {
    proc.on("error", reject);
    proc.on("close", resolvePromise);
  });

  return { exitCode, stdout, stderr };
}

async function createWorkspace(files, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function createFakeGitContext(options = {}) {
  const binDir = await mkdtemp(join(tmpdir(), "acai-npm-git-"));
  const scriptPath = join(binDir, "git");
  const remote = options.remote ?? "git@github.com:my-org/my-repo.git";
  const branch = options.branch ?? "main";
  const topLevel = options.topLevel;
  const head = options.head ?? "c0ffee0000000000000000000000000000000000";
  const fileCommits = options.fileCommits ?? {};

  const fileCommitChecks = Object.entries(fileCommits)
    .map(
      ([path, commit]) => `  if [ "$path" = '${path.replace(/'/g, "'\\''")}' ]; then\n    printf '%s\\n' '${commit.replace(/'/g, "'\\''")}'\n    exit 0\n  fi\n`,
    )
    .join("");

  const script = `#!/bin/sh
cmd="$1 $2"
if [ "$cmd" = "remote get-url" ]; then
  printf '%s\\n' '${remote.replace(/'/g, "'\\''")}'
  exit 0
fi

if [ "$cmd" = "branch --show-current" ]; then
  printf '%s\\n' '${branch.replace(/'/g, "'\\''")}'
  exit 0
fi

if [ "$cmd" = "rev-parse HEAD" ]; then
  printf '%s\\n' '${head.replace(/'/g, "'\\''")}'
  exit 0
fi

if [ "$cmd" = "rev-parse --show-toplevel" ]; then
  ${topLevel ? `printf '%s\\n' '${topLevel.replace(/'/g, "'\\''")}'` : 'printf "%s\\n" "$PWD"'}
  exit 0
fi

if [ "$1 $2 $3 $4" = "log -1 --format=%H --" ]; then
  path="$5"
${fileCommitChecks}  printf '%s\\n' 'unexpected git log path' >&2
  exit 1
fi

printf '%s\\n' 'unexpected git invocation' >&2
exit 1
`;

  await writeFile(scriptPath, script);
  await chmod(scriptPath, 0o755);

  return {
    binDir,
    cleanup: async () => {
      await rm(binDir, { recursive: true, force: true });
    },
  };
}

async function createMockApiServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const bodyText = await readRequestBody(req);
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    requests.push({ method: req.method, path: req.url, body });

    if (req.method === "POST" && req.url === "/push") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: {
            product_name: body?.product_name ?? "product-a",
            implementation_name: "main",
            specs_created: 1,
            specs_updated: 0,
            warnings: [],
          },
        }),
      );
      return;
    }

    if (req.method === "PATCH" && req.url === "/feature-states") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: {
            product_name: body?.product_name ?? "example-product",
            implementation_name: body?.implementation_name ?? "main",
            feature_name: body?.feature_name ?? "set-status",
            states_written: Object.keys(body?.states ?? {}).length,
            warnings: ["warning one"],
          },
        }),
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: { detail: "not found" } }));
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock API server.");
  }

  return {
    requests,
    env: {
      ACAI_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      ACAI_API_TOKEN: "secret",
    },
    stop: async () => {
      await new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
    },
  };
}

async function readRequestBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}
