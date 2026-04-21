import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeGitContext {
  binDir: string;
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

export async function createFakeGitContext(options: {
  remote?: string;
  branch?: string;
  remoteExitCode?: number;
  branchExitCode?: number;
  topLevel?: string;
  head?: string;
  fileCommits?: Record<string, string>;
}): Promise<FakeGitContext> {
  const binDir = await mkdtemp(join(tmpdir(), "acai-git-"));
  const scriptPath = join(binDir, "git");
  const remote = options.remote ?? "git@github.com:my-org/my-repo.git";
  const branch = options.branch ?? "main";
  const remoteExitCode = options.remoteExitCode ?? 0;
  const branchExitCode = options.branchExitCode ?? 0;
  const topLevel = options.topLevel;
  const head = options.head ?? "c0ffee0000000000000000000000000000000000";
  const fileCommits = options.fileCommits ?? {};

  const fileCommitChecks = Object.entries(fileCommits)
    .map(
      ([path, commit]) => `  if [ "$path" = '${path.replace(/'/g, "'\\''")}' ]; then
    printf '%s\\n' '${commit.replace(/'/g, "'\\''")}'
    exit 0
  fi
`,
    )
    .join("");

  const script = `#!/bin/sh
cmd="$1 $2"
if [ "$cmd" = "remote get-url" ]; then
  ${remoteExitCode === 0 ? `printf '%s\\n' '${remote.replace(/'/g, "'\\''")}'` : "printf '%s\\n' 'remote failure' >&2"}
  exit ${remoteExitCode}
fi

if [ "$cmd" = "branch --show-current" ]; then
  ${branchExitCode === 0 ? `printf '%s\\n' '${branch.replace(/'/g, "'\\''")}'` : "printf '%s\\n' 'branch failure' >&2"}
  exit ${branchExitCode}
fi

if [ "$cmd" = "rev-parse HEAD" ]; then
  printf '%s\\n' '${head.replace(/'/g, "'\\''")}'
  exit 0
fi

if [ "$cmd" = "rev-parse --show-toplevel" ]; then
  ${topLevel ? `printf '%s\\n' '${topLevel.replace(/'/g, "'\\''")}'` : "printf '%s\\n' \"$PWD\""}
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

  await writeFile(scriptPath, script, { mode: 0o755 });
  await chmod(scriptPath, 0o755);

  return {
    binDir,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
    cleanup: async () => {
      await rm(binDir, { recursive: true, force: true });
    },
  };
}
