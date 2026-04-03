import { describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPushPayloads, normalizePushOptions, parseFeatureDocument, planPush, runPushCommand, scanPushRepo, scanPushReferences, type PushScanResult } from "./push.ts";

async function createRepoFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "acai-push-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return root;
}

function createGitRunner(outputs: Record<string, string>): { run(args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> } {
  return {
    async run(args) {
      const key = args.join(" ");
      const value = outputs[key];
      if (value === undefined) {
        return { exitCode: 1, stdout: "", stderr: `unexpected git call: ${key}` };
      }

      return { exitCode: 0, stdout: `${value}\n`, stderr: "" };
    },
  };
}

describe("push.SCAN.1 push.SCAN.5 push.SCAN.5-1", () => {
  test("parseFeatureDocument flattens requirements, notes, and deprecation precedence", () => {
    const parsed = parseFeatureDocument(
      `feature:\n  name: alpha\n  product: product-a\n  version: 1.2.3\n  description: Alpha\ncomponents:\n  MAIN:\n    requirements:\n      1: First requirement\n      1-note: Component note\n      2:\n        requirement: Second requirement\n        replaced_by:\n          - alpha.MAIN.1\n  AUTH:\n    deprecated: true\n    requirements:\n      1:\n        requirement: Inherited deprecation\n        deprecated: false\nconstraints:\n  SAFETY:\n    requirements:\n      1:\n        requirement: Safety requirement\n`,
      "features/alpha.feature.yaml",
    );

    expect(parsed.spec.feature).toEqual({
      name: "alpha",
      product: "product-a",
      version: "1.2.3",
      description: "Alpha",
    });
    expect(parsed.spec.meta.path).toBe("features/alpha.feature.yaml");
    expect(parsed.spec.requirements).toEqual({
      "alpha.AUTH.1": { requirement: "Inherited deprecation", deprecated: false },
      "alpha.MAIN.1": { requirement: "First requirement", deprecated: false, note: "Component note" },
      "alpha.MAIN.2": { requirement: "Second requirement", deprecated: false, replaced_by: ["alpha.MAIN.1"] },
      "alpha.SAFETY.1": { requirement: "Safety requirement", deprecated: false },
    });
  });
});

describe("push.SCAN.2 push.SCAN.2-1 push.SCAN.4 push.SAFETY.1 push.UX.2", () => {
  test("scanPushReferences extracts full ACIDs, records first-match lines, filters feature names, and skips state files", async () => {
    const root = await createRepoFixture({
      "src/app.ts": `const spec = "alpha.MAIN.1";\nconst duplicate = "alpha.MAIN.1";\nconst other = "beta.MAIN.1";\n`,
      "test/app.test.ts": `expect("alpha.MAIN.1").toBeTruthy();\n`,
      "states/ignored.ts": `const ignored = "alpha.MAIN.1";\n`,
    });

    const filePaths = ["src/app.ts", "states/ignored.ts", "test/app.test.ts"];
    const references = await scanPushReferences(root, filePaths, new Set(["alpha"]));

    expect(references).toEqual([
      { featureName: "alpha", acid: "alpha.MAIN.1", path: "src/app.ts:1", isTest: false },
      { featureName: "alpha", acid: "alpha.MAIN.1", path: "test/app.test.ts:1", isTest: true },
    ]);
  });
});

describe("push.MAIN.9 push.API.2 push.API.3 push.API.6 push.SAFETY.4 push.SAFETY.5 push.UX.2 push.UX.3", () => {
  const scan: PushScanResult = {
    specs: [
      {
        featureName: "shared",
        productName: "product-a",
        path: "features/shared-a.feature.yaml",
        lastSeenCommit: "a1",
        spec: {
          feature: { name: "shared", product: "product-a", version: "1.0.0" },
          meta: { last_seen_commit: "a1", path: "features/shared-a.feature.yaml" },
          requirements: { "shared.MAIN.1": { requirement: "Spec A", deprecated: false } },
        },
      },
      {
        featureName: "shared",
        productName: "product-b",
        path: "features/shared-b.feature.yaml",
        lastSeenCommit: "b1",
        spec: {
          feature: { name: "shared", product: "product-b", version: "1.0.0" },
          meta: { last_seen_commit: "b1", path: "features/shared-b.feature.yaml" },
          requirements: { "shared.MAIN.1": { requirement: "Spec B", deprecated: false } },
        },
      },
      {
        featureName: "alpha",
        productName: "product-a",
        path: "features/alpha.feature.yaml",
        lastSeenCommit: "a2",
        spec: {
          feature: { name: "alpha", product: "product-a", version: "1.0.0" },
          meta: { last_seen_commit: "a2", path: "features/alpha.feature.yaml" },
          requirements: { "alpha.MAIN.1": { requirement: "Alpha spec", deprecated: false } },
        },
      },
    ],
    references: [
      { featureName: "shared", acid: "shared.MAIN.1", path: "src/shared.ts:1", isTest: false },
      { featureName: "alpha", acid: "alpha.MAIN.1", path: "test/alpha.test.ts:1", isTest: true },
      { featureName: "gamma", acid: "gamma.MAIN.1", path: "src/gamma.ts:1", isTest: false },
    ],
  };

  test("buildPushPayloads groups one payload per product, splits scoped target selectors, and preserves deterministic ordering", () => {
    const payloads = buildPushPayloads(scan, {
      repoUri: "github.com/my-org/my-repo",
      branchName: "main",
      commitHash: "c1",
      product: "product-gamma",
      target: "product-gamma/child",
      parent: "product-gamma/base",
      featureNames: ["shared", "alpha", "gamma"],
    });

    expect(payloads).toEqual([
      {
        branch_name: "main",
        commit_hash: "c1",
        repo_uri: "github.com/my-org/my-repo",
        product_name: "product-a",
        specs: [
          {
            feature: { name: "alpha", product: "product-a", version: "1.0.0" },
            meta: { last_seen_commit: "a2", path: "features/alpha.feature.yaml" },
            requirements: { "alpha.MAIN.1": { requirement: "Alpha spec", deprecated: false } },
          },
          {
            feature: { name: "shared", product: "product-a", version: "1.0.0" },
            meta: { last_seen_commit: "a1", path: "features/shared-a.feature.yaml" },
            requirements: { "shared.MAIN.1": { requirement: "Spec A", deprecated: false } },
          },
        ],
        references: {
          data: {
            "alpha.MAIN.1": [{ path: "test/alpha.test.ts:1", is_test: true }],
            "shared.MAIN.1": [{ path: "src/shared.ts:1", is_test: false }],
          },
          override: false,
        },
      },
      {
        branch_name: "main",
        commit_hash: "c1",
        repo_uri: "github.com/my-org/my-repo",
        product_name: "product-b",
        specs: [
          {
            feature: { name: "shared", product: "product-b", version: "1.0.0" },
            meta: { last_seen_commit: "b1", path: "features/shared-b.feature.yaml" },
            requirements: { "shared.MAIN.1": { requirement: "Spec B", deprecated: false } },
          },
        ],
        references: {
          data: {
            "shared.MAIN.1": [{ path: "src/shared.ts:1", is_test: false }],
          },
          override: false,
        },
      },
      {
        branch_name: "main",
        commit_hash: "c1",
        repo_uri: "github.com/my-org/my-repo",
        product_name: "product-gamma",
        references: {
          data: {
            "gamma.MAIN.1": [{ path: "src/gamma.ts:1", is_test: false }],
          },
          override: false,
        },
        target_impl_name: "child",
        parent_impl_name: "base",
      },
    ]);
  });

  test("push.API.6 push.SAFETY.4 buildPushPayloads keeps refs-only pushes unscoped when no product is provided", () => {
    expect(
      buildPushPayloads(
        {
          specs: [],
          references: [{ featureName: "gamma", acid: "gamma.MAIN.1", path: "src/gamma.ts:1", isTest: false }],
        },
        { repoUri: "github.com/my-org/my-repo", branchName: "main", commitHash: "c1" },
      ),
    ).toEqual([
      {
        branch_name: "main",
        commit_hash: "c1",
        repo_uri: "github.com/my-org/my-repo",
        references: {
          data: {
            "gamma.MAIN.1": [{ path: "src/gamma.ts:1", is_test: false }],
          },
          override: false,
        },
      },
    ]);
  });

  test("push.API.6 buildPushPayloads keeps unmatched refs alongside matched product payloads", () => {
    expect(
      buildPushPayloads(
        {
          specs: [scan.specs[2]!],
          references: [
            { featureName: "alpha", acid: "alpha.MAIN.1", path: "src/alpha.ts:1", isTest: false },
            { featureName: "gamma", acid: "gamma.MAIN.1", path: "src/gamma.ts:1", isTest: false },
          ],
        },
        { repoUri: "github.com/my-org/my-repo", branchName: "main", commitHash: "c1" },
      ),
    ).toEqual([
      {
        branch_name: "main",
        commit_hash: "c1",
        repo_uri: "github.com/my-org/my-repo",
        references: {
          data: {
            "gamma.MAIN.1": [{ path: "src/gamma.ts:1", is_test: false }],
          },
          override: false,
        },
      },
      {
        branch_name: "main",
        commit_hash: "c1",
        repo_uri: "github.com/my-org/my-repo",
        product_name: "product-a",
        specs: [
          {
            feature: { name: "alpha", product: "product-a", version: "1.0.0" },
            meta: { last_seen_commit: "a2", path: "features/alpha.feature.yaml" },
            requirements: { "alpha.MAIN.1": { requirement: "Alpha spec", deprecated: false } },
          },
        ],
        references: {
          data: {
            "alpha.MAIN.1": [{ path: "src/alpha.ts:1", is_test: false }],
          },
          override: false,
        },
      },
    ]);
  });

  test("push.API.5 push.SAFETY.5 buildPushPayloads rejects refs-only child selectors unless target and parent are both provided", () => {
    expect(() =>
      buildPushPayloads(
        {
          specs: [],
          references: [{ featureName: "gamma", acid: "gamma.MAIN.1", path: "src/gamma.ts:1", isTest: false }],
        },
        {
          repoUri: "github.com/my-org/my-repo",
          branchName: "main",
          commitHash: "c1",
          product: "product-gamma",
          parent: "product-gamma/base",
        },
      ),
    ).toThrow("Refs-only pushes require --product, --target, and --parent together.");
  });
});

describe("push.MAIN.7 push.MAIN.8 push.SCAN.3 push.SAFETY.2", () => {
  test("planPush collects git metadata and per-file last seen commits from the repo root", async () => {
    const root = await createRepoFixture({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\n  version: 1.0.0\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "src/alpha.ts": `const ref = "alpha.MAIN.1";\n`,
    });

    const runner = createGitRunner({
      "rev-parse --show-toplevel": root,
      "remote get-url origin": "git@github.com:my-org/my-repo.git",
      "branch --show-current": "main",
      "rev-parse HEAD": "c0ffee0000000000000000000000000000000000",
      "log -1 --format=%H -- features/alpha.feature.yaml": "a1b2c3d4e5f6789012345678901234567890abcd",
    });

    const plan = await planPush({ cwd: root, runner: runner as never });

    expect(plan).toEqual({
      repoUri: "github.com/my-org/my-repo",
      branchName: "main",
      commitHash: "c0ffee0000000000000000000000000000000000",
      payloads: [
        {
          branch_name: "main",
          commit_hash: "c0ffee0000000000000000000000000000000000",
          repo_uri: "github.com/my-org/my-repo",
          product_name: "product-a",
          specs: [
            {
              feature: { name: "alpha", product: "product-a", version: "1.0.0" },
              meta: {
                last_seen_commit: "a1b2c3d4e5f6789012345678901234567890abcd",
                path: "features/alpha.feature.yaml",
              },
              requirements: { "alpha.MAIN.1": { requirement: "Alpha requirement", deprecated: false } },
            },
          ],
          references: {
            data: {
              "alpha.MAIN.1": [{ path: "src/alpha.ts:1", is_test: false }],
            },
            override: false,
          },
        },
      ],
    });
  });

  test("push.MAIN.8 push.SCAN.3 planPush discovers the repo root from a nested cwd and keeps repo-relative paths", async () => {
    const root = await createRepoFixture({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\n  version: 1.0.0\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "src/alpha.ts": `const ref = "alpha.MAIN.1";\n`,
    });
    const nestedCwd = join(root, "packages/app");
    await mkdir(nestedCwd, { recursive: true });

    const runner = createGitRunner({
      "rev-parse --show-toplevel": root,
      "remote get-url origin": "git@github.com:my-org/my-repo.git",
      "branch --show-current": "main",
      "rev-parse HEAD": "c0ffee0000000000000000000000000000000000",
      "log -1 --format=%H -- features/alpha.feature.yaml": "a1b2c3d4e5f6789012345678901234567890abcd",
    });

    const plan = await planPush({ cwd: nestedCwd, runner: runner as never });

    expect(plan.payloads).toEqual([
      {
        branch_name: "main",
        commit_hash: "c0ffee0000000000000000000000000000000000",
        repo_uri: "github.com/my-org/my-repo",
        product_name: "product-a",
        specs: [
          {
            feature: { name: "alpha", product: "product-a", version: "1.0.0" },
            meta: {
              last_seen_commit: "a1b2c3d4e5f6789012345678901234567890abcd",
              path: "features/alpha.feature.yaml",
            },
            requirements: { "alpha.MAIN.1": { requirement: "Alpha requirement", deprecated: false } },
          },
        ],
        references: {
          data: {
            "alpha.MAIN.1": [{ path: "src/alpha.ts:1", is_test: false }],
          },
          override: false,
        },
      },
    ]);
  });

  test("scanPushRepo respects feature-name filters for both specs and refs", async () => {
    const root = await createRepoFixture({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "features/beta.feature.yaml": `feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n`,
      "src/alpha.ts": `const ref = "alpha.MAIN.1";\n`,
      "src/beta.ts": `const ref = "beta.MAIN.1";\n`,
    });

    const runner = createGitRunner({
      "rev-parse --show-toplevel": root,
      "log -1 --format=%H -- features/alpha.feature.yaml": "a1",
      "log -1 --format=%H -- features/beta.feature.yaml": "b1",
    });

    const scan = await scanPushRepo({ cwd: root, runner: runner as never, featureNames: ["alpha"] });

    expect(scan.specs.map((entry) => entry.featureName)).toEqual(["alpha"]);
    expect(scan.references.map((entry) => entry.featureName)).toEqual(["alpha"]);
  });
});

describe("push.MAIN.2 push.MAIN.3 push.MAIN.4 push.MAIN.5 push.MAIN.6 push.UX.1", () => {
  test("normalizePushOptions validates push selectors and preserves the json flag", () => {
    expect(
      normalizePushOptions({
        featureNames: ["alpha", "beta"],
        all: true,
        product: "product-a",
        target: "product-a/impl",
        parent: "product-a/base",
        json: true,
      }),
    ).toEqual({
      featureNames: ["alpha", "beta"],
      all: true,
      product: "product-a",
      target: "product-a/impl",
      parent: "product-a/base",
      json: true,
    });

    expect(() => normalizePushOptions({ product: "-oops" })).toThrow("Missing value for --product.");
    expect(() => normalizePushOptions({ target: "-oops" })).toThrow("Missing value for --target.");
    expect(() => normalizePushOptions({ parent: "-oops" })).toThrow("Missing value for --parent.");
  });
});

describe("push.API.1 push.API.4 push.OUTPUT.1 push.OUTPUT.2 push.OUTPUT.3 push.OUTPUT.3-1 push.OUTPUT.4 push.OUTPUT.5 push.SAFETY.3", () => {
  test("runPushCommand keeps failures isolated, formats product blocks, and returns a machine payload", async () => {
    const root = await createRepoFixture({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "features/beta.feature.yaml": `feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n`,
      "src/alpha.ts": `const ref = "alpha.MAIN.1";\n`,
      "src/beta.ts": `const ref = "beta.MAIN.1";\n`,
    });

    const runner = createGitRunner({
      "rev-parse --show-toplevel": root,
      "remote get-url origin": "git@github.com:my-org/my-repo.git",
      "branch --show-current": "main",
      "rev-parse HEAD": "c0ffee0000000000000000000000000000000000",
      "log -1 --format=%H -- features/alpha.feature.yaml": "a1",
      "log -1 --format=%H -- features/beta.feature.yaml": "b1",
    });

    const apiClient = {
      push: mock(async (payload) => {
        if (payload.product_name === "product-a") {
          return {
            data: {
              product_name: "product-a",
              implementation_name: "main",
              specs_created: 1,
              specs_updated: 0,
              warnings: ["alpha warning"],
            },
          };
        }

        throw new Error("beta failed");
      }),
    };

    const textResult = await runPushCommand(apiClient as never, {
      featureNames: [],
      all: true,
      json: false,
    }, { cwd: root, runner: runner as never });

    expect(textResult.exitCode).toBe(1);
    expect(textResult.stdoutLines).toEqual([
      "Product: product-a",
      "Implementation: main",
      "Specs created: 1",
      "Specs updated: 0",
      "Refs pushed: 1",
      "Warning: alpha warning",
      "",
      "Product: product-b",
      "Error: beta failed",
    ]);

    const jsonResult = await runPushCommand(apiClient as never, {
      featureNames: [],
      all: true,
      json: true,
    }, { cwd: root, runner: runner as never });

    expect(jsonResult.exitCode).toBe(1);
    expect(jsonResult.jsonPayload).toEqual({
      repoUri: "github.com/my-org/my-repo",
      branchName: "main",
      commitHash: "c0ffee0000000000000000000000000000000000",
      results: [
        {
          productName: "product-a",
          implementationName: "main",
          specsCreated: 1,
          specsUpdated: 0,
          refsPushed: 1,
          warnings: ["alpha warning"],
        },
      ],
      failures: [{ productName: "product-b", error: "beta failed" }],
    });
    expect(jsonResult.stderrLines).toEqual([
      "Push failed for product-b: beta failed",
      "Warning for product-a: alpha warning",
    ]);
  });

  test("push.API.1 runPushCommand sends push payloads sequentially", async () => {
    const plan = {
      repoUri: "github.com/my-org/my-repo",
      branchName: "main",
      commitHash: "c0ffee0000000000000000000000000000000000",
      payloads: [
        {
          branch_name: "main",
          commit_hash: "c0ffee0000000000000000000000000000000000",
          repo_uri: "github.com/my-org/my-repo",
          references: {
            data: {
              "gamma.MAIN.1": [{ path: "src/gamma.ts:1", is_test: false }],
            },
            override: false,
          },
        },
        {
          branch_name: "main",
          commit_hash: "c0ffee0000000000000000000000000000000000",
          repo_uri: "github.com/my-org/my-repo",
          product_name: "cli",
          specs: [
            {
              feature: { name: "push", product: "cli", version: "1.0.0" },
              meta: { last_seen_commit: "a1", path: "features/cli/push.feature.yaml" },
              requirements: { "push.MAIN.1": { requirement: "Exposes `acai push`", deprecated: false } },
            },
          ],
        },
      ],
    };

    let inFlight = 0;
    const callOrder: string[] = [];
    const apiClient = {
      push: mock(async (payload) => {
        if (inFlight > 0) {
          throw new Error("push requests overlapped");
        }

        inFlight += 1;
        callOrder.push(`start:${payload.product_name ?? "unscoped"}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push(`end:${payload.product_name ?? "unscoped"}`);
        inFlight -= 1;

        return {
          data: {
            product_name: payload.product_name ?? null,
            implementation_name: payload.product_name ? "feat/push-cli" : null,
            specs_created: payload.specs?.length ?? 0,
            specs_updated: 0,
            warnings: [],
          },
        };
      }),
    };

    const result = await runPushCommand(
      apiClient as never,
      { featureNames: [], all: true, json: false },
      {},
      plan as never,
    );

    expect(result.exitCode).toBe(0);
    expect(callOrder).toEqual([
      "start:unscoped",
      "end:unscoped",
      "start:cli",
      "end:cli",
    ]);
  });

  test("push.OUTPUT.1 runPushCommand combines multiple push responses for the same resolved product", async () => {
    const plan = {
      repoUri: "github.com/my-org/my-repo",
      branchName: "main",
      commitHash: "c0ffee0000000000000000000000000000000000",
      payloads: [
        {
          branch_name: "main",
          commit_hash: "c0ffee0000000000000000000000000000000000",
          repo_uri: "github.com/my-org/my-repo",
          references: {
            data: {
              "gamma.MAIN.1": [{ path: "src/gamma.ts:1", is_test: false }],
            },
            override: false,
          },
        },
        {
          branch_name: "main",
          commit_hash: "c0ffee0000000000000000000000000000000000",
          repo_uri: "github.com/my-org/my-repo",
          product_name: "cli",
          specs: [
            {
              feature: { name: "push", product: "cli", version: "1.0.0" },
              meta: { last_seen_commit: "a1", path: "features/cli/push.feature.yaml" },
              requirements: { "push.MAIN.1": { requirement: "Exposes `acai push`", deprecated: false } },
            },
          ],
        },
      ],
    };

    const apiClient = {
      push: mock(async (payload) => {
        if (payload.product_name) {
          return {
            data: {
              product_name: "cli",
              implementation_name: "feat/push-cli",
              specs_created: 5,
              specs_updated: 2,
              warnings: ["spec warning"],
            },
          };
        }

        return {
          data: {
            product_name: "cli",
            implementation_name: "feat/push-cli",
            specs_created: 0,
            specs_updated: 0,
            warnings: ["refs warning"],
          },
        };
      }),
    };

    const result = await runPushCommand(
      apiClient as never,
      { featureNames: [], all: true, json: true },
      {},
      plan as never,
    );

    expect(result.stdoutLines).toEqual([
      "Product: cli",
      "Implementation: feat/push-cli",
      "Specs created: 5",
      "Specs updated: 2",
      "Refs pushed: 1",
      "Warning: refs warning",
      "Warning: spec warning",
    ]);
    expect(result.jsonPayload).toEqual({
      repoUri: "github.com/my-org/my-repo",
      branchName: "main",
      commitHash: "c0ffee0000000000000000000000000000000000",
      results: [
        {
          productName: "cli",
          implementationName: "feat/push-cli",
          specsCreated: 5,
          specsUpdated: 2,
          refsPushed: 1,
          warnings: ["refs warning", "spec warning"],
        },
      ],
      failures: [],
    });
  });
});
