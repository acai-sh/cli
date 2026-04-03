import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImplementationFeatureEntry, buildImplementationFeaturesResponse, buildImplementationsResponse } from "../test/support/fixtures.ts";
import { createFakeGitContext } from "../test/support/fake-git.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { runCliSubprocess } from "../test/support/cli.ts";

async function createPushRepo(files: Record<string, string>): Promise<{ root: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "acai-push-e2e-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("cli-core.HELP.1 cli-core.HELP.2 cli-core.HELP.4 cli-core.HELP.5", () => {
  test("acai prints top-level help when invoked without a subcommand", async () => {
    const result = await runCliSubprocess([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout).toContain("Usage: acai");
    expect(result.stdout).toContain("work");
  });

  test("acai --help and acai -h produce the same top-level help", async () => {
    const help = await runCliSubprocess(["--help"]);
    const shortHelp = await runCliSubprocess(["-h"]);

    expect(help.exitCode).toBe(0);
    expect(shortHelp.exitCode).toBe(0);
    expect(help.stdout).toBe(shortHelp.stdout);
    expect(help.stderr.trim()).toBe("");
    expect(shortHelp.stderr.trim()).toBe("");
  });

  test("acai work --help and acai work -h produce the same command help", async () => {
    const help = await runCliSubprocess(["work", "--help"]);
    const shortHelp = await runCliSubprocess(["work", "-h"]);

    expect(help.exitCode).toBe(0);
    expect(shortHelp.exitCode).toBe(0);
    expect(help.stdout).toBe(shortHelp.stdout);
    expect(help.stdout).toContain("Usage: acai work --product <name> [options]");
    expect(help.stdout).toContain("product name (required)");
    expect(help.stderr.trim()).toBe("");
    expect(shortHelp.stderr.trim()).toBe("");
  });
});

describe("cli-core.EXITS.1 cli-core.EXITS.2 cli-core.EXITS.3 cli-core.UX.1 cli-core.UX.2", () => {
  test("work.MAIN.1 work.MAIN.3 work.MAIN.4 work.MAIN.5 work.MAIN.7 work.MAIN.8 work.API.1 work.UX.1 prints text output for a direct target", async () => {
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);

      if (url.pathname === "/implementation-features") {
        expect(url.searchParams.get("product_name")).toBe("example-product");
        expect(url.searchParams.get("implementation_name")).toBe("main");
        expect(url.searchParams.getAll("statuses")).toEqual(["todo", "doing"]);
        expect(url.searchParams.get("changed_since_commit")).toBe("abc123");

        return Response.json(
          buildImplementationFeaturesResponse({
            data: {
              features: [
                buildImplementationFeatureEntry({ feature_name: "feature-a", completed_count: 2, total_count: 4, refs_count: 3 }),
                buildImplementationFeatureEntry({ feature_name: "feature-b", completed_count: 1, total_count: 2, refs_count: 1 }),
              ],
            },
          }),
        );
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product", "--impl", "main", "--status", "todo", "--status", "doing", "--changed-since-commit", "abc123"],
        {
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout.trim().split("\n")).toEqual([
        "feature-a 2/4 refs_count=3",
        "feature-b 1/2 refs_count=1",
      ]);
    } finally {
      server.stop();
    }
  });

  test("work.MAIN.2 work.MAIN.3 work.API.1 work.API.2 resolves exactly one implementation from git context", async () => {
    const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);

      if (url.pathname === "/implementations") {
        expect(url.searchParams.get("product_name")).toBe("example-product");
        expect(url.searchParams.get("repo_uri")).toBe("github.com/my-org/my-repo");
        expect(url.searchParams.get("branch_name")).toBe("main");

        return Response.json(
          buildImplementationsResponse({
            data: {
              implementations: [{ implementation_id: "impl-1", implementation_name: "main" }],
            },
          }),
        );
      }

      if (url.pathname === "/implementation-features") {
        expect(url.searchParams.get("implementation_name")).toBe("main");

        return Response.json(
          buildImplementationFeaturesResponse({
            data: {
              features: [buildImplementationFeatureEntry({ feature_name: "feature-a", completed_count: 3, total_count: 5, refs_count: 2 })],
            },
          }),
        );
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout.trim()).toBe("feature-a 3/5 refs_count=2");
    } finally {
      server.stop();
      await git.cleanup();
    }
  });

  test("cli-core.TARGETING.4 exits non-zero when branch targeting is ambiguous", async () => {
    const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/implementations") {
        return Response.json(
          buildImplementationsResponse({
            data: {
              implementations: [
                { implementation_id: "impl-1", implementation_name: "main" },
                { implementation_id: "impl-2", implementation_name: "preview" },
              ],
            },
          }),
        );
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Multiple implementations matched the current repo, branch, and product");
      expect(result.stderr).toContain("main, preview");
    } finally {
      server.stop();
      await git.cleanup();
    }
  });

  test("cli-core.TARGETING.5 exits non-zero when no branch target matches", async () => {
    const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/implementations") {
        return Response.json(buildImplementationsResponse({ data: { implementations: [] } }));
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No implementation matched the current repo, branch, and product.");
    } finally {
      server.stop();
      await git.cleanup();
    }
  });

  test("cli-core.ERRORS.2 exits non-zero when git context cannot be determined", async () => {
    const git = await createFakeGitContext({ remoteExitCode: 1 });
    const result = await runCliSubprocess(
      ["work", "--product", "example-product"],
      {
        ...git.env,
        ACAI_API_BASE_URL: "https://api.example.test",
        ACAI_API_TOKEN: "secret",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Git context could not be determined.");
    await git.cleanup();
  });

  test("cli-core.CONFIG.2 exits with usage errors when the API token is missing", async () => {
    const result = await runCliSubprocess(
      ["work", "--product", "example-product", "--impl", "main"],
      { ACAI_API_TOKEN: "" },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing API bearer token configuration.");
    expect(result.stderr).toContain("Usage: acai work");
  });

  test("work.MAIN.2 and cli-core.EXITS.2 require a product selector", async () => {
    const result = await runCliSubprocess(["work", "--impl", "main"], {
      ACAI_API_BASE_URL: "https://api.example.test",
      ACAI_API_TOKEN: "secret",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("required option '--product <name>' not specified");
    expect(result.stderr).toContain("Usage: acai work");
  });

  test("cli-core.TARGETING.1 still reports a missing product selector when API env is absent", async () => {
    const result = await runCliSubprocess(["work", "--impl", "main"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("required option '--product <name>' not specified");
    expect(result.stderr).toContain("Usage: acai work");
  });

  test("cli-core.ERRORS.3 exits non-zero for unknown commands", async () => {
    const result = await runCliSubprocess(["bogus"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown command");
    expect(result.stderr).toContain("Usage: acai");
  });

  test("cli-core.ERRORS.4 exits non-zero for unknown work options", async () => {
    const result = await runCliSubprocess(["work", "--product", "example-product", "--unknown-option"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown option");
    expect(result.stderr).toContain("Usage: acai work");
  });

  test("cli-core.HTTP.2 surfaces API auth failures", async () => {
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/implementation-features") {
        return Response.json({ errors: { detail: "unauthorized" } }, { status: 401 });
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product", "--impl", "main"],
        {
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unauthorized");
    } finally {
      server.stop();
    }
  });

  test("cli-core.HTTP.3 surfaces API validation failures", async () => {
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/implementation-features") {
        return Response.json({ errors: { detail: "validation failed" } }, { status: 422 });
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product", "--impl", "main"],
        {
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("validation failed");
    } finally {
      server.stop();
    }
  });

  test("cli-core.HTTP.3 surfaces API not found failures", async () => {
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/implementation-features") {
        return Response.json({ errors: { detail: "not found" } }, { status: 404 });
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product", "--impl", "main"],
        {
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not found");
    } finally {
      server.stop();
    }
  });

  test("cli-core.HTTP.1 handles network failures", async () => {
    const result = await runCliSubprocess(["work", "--product", "example-product", "--impl", "main"], {
      ACAI_API_BASE_URL: "http://127.0.0.1:65535",
      ACAI_API_TOKEN: "secret",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("API request failed.");
  });

  test("cli-core.OUTPUT.1 cli-core.OUTPUT.2 keeps json payload on stdout", async () => {
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/implementation-features") {
        return Response.json(
          buildImplementationFeaturesResponse({
            data: {
              features: [buildImplementationFeatureEntry({ feature_name: "feature-a" })],
            },
          }),
        );
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product", "--impl", "main", "--json"],
        {
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(JSON.parse(result.stdout).data.features[0].feature_name).toBe("feature-a");
    } finally {
      server.stop();
    }
  });

  test("work.UX.4 exits successfully when no features are returned", async () => {
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/implementation-features") {
        return Response.json(buildImplementationFeaturesResponse({ data: { features: [] } }));
      }

      return new Response("not found", { status: 404 });
    });

    try {
      const result = await runCliSubprocess(
        ["work", "--product", "example-product", "--impl", "main"],
        {
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("No features were returned.");
    } finally {
      server.stop();
    }
  });

  test("push.MAIN.1 push.MAIN.2 push.MAIN.3 push.MAIN.7 push.MAIN.8 push.SCAN.1 push.SCAN.2 push.SCAN.3 push.SCAN.4 push.API.1 push.OUTPUT.1 push.OUTPUT.2 push.OUTPUT.3 push.OUTPUT.4 push.SAFETY.1 push.SAFETY.2 push.SAFETY.3 push.UX.1 push.UX.2 prints one block per product for a full repo push", async () => {
    const repo = await createPushRepo({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "features/beta.feature.yaml": `feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n`,
      "src/alpha.ts": `const alpha = "alpha.MAIN.1";\n`,
      "src/beta.ts": `const beta = "beta.MAIN.1";\n`,
    });
    const git = await createFakeGitContext({
      remote: "git@github.com:my-org/my-repo.git",
      branch: "main",
      topLevel: repo.root,
      head: "c0ffee0000000000000000000000000000000000",
      fileCommits: {
        "features/alpha.feature.yaml": "a1",
        "features/beta.feature.yaml": "b1",
      },
    });
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/push");
      return request.clone().json().then((body) => {
        const payload = body as { product_name?: string };
        return Response.json({
          data: {
            product_name: payload.product_name,
            implementation_name: payload.product_name === "product-b" ? "preview" : "main",
            specs_created: 1,
            specs_updated: 0,
            warnings: payload.product_name === "product-a" ? ["alpha warning"] : [],
          },
        });
      });
    });

    try {
      const result = await runCliSubprocess(
        ["push", "--all"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout).toContain("Product: product-a");
      expect(result.stdout).toContain("Implementation: main");
      expect(result.stdout).toContain("Warning: alpha warning");
      expect(result.stdout).toContain("Product: product-b");
      expect(result.stdout).toContain("Implementation: preview");
    } finally {
      server.stop();
      await git.cleanup();
      await repo.cleanup();
    }
  });

  test("push.MAIN.2 push.API.3 push.UX.3 filters the scan to named features", async () => {
    const repo = await createPushRepo({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "features/beta.feature.yaml": `feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n`,
      "src/alpha.ts": `const alpha = "alpha.MAIN.1";\n`,
      "src/beta.ts": `const beta = "beta.MAIN.1";\n`,
    });
    const git = await createFakeGitContext({
      remote: "git@github.com:my-org/my-repo.git",
      branch: "main",
      topLevel: repo.root,
      head: "c0ffee0000000000000000000000000000000000",
      fileCommits: {
        "features/alpha.feature.yaml": "a1",
        "features/beta.feature.yaml": "b1",
      },
    });
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      if (url.pathname !== "/push") {
        return new Response("not found", { status: 404 });
      }

      return request.clone().json().then((body) => {
        const payload = body as { product_name?: string };
        if (payload.product_name !== "product-a") {
          return Response.json({ errors: { detail: "unexpected product" } }, { status: 422 });
        }

        return Response.json({
          data: {
            product_name: "product-a",
            implementation_name: "main",
            specs_created: 1,
            specs_updated: 0,
            warnings: [],
          },
        });
      });
    });

    try {
      const result = await runCliSubprocess(
        ["push", "alpha"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Product: product-a");
      expect(result.stdout).not.toContain("product-b");
      expect(server.requests).toHaveLength(1);
    } finally {
      server.stop();
      await git.cleanup();
      await repo.cleanup();
    }
  });

  test("push.MAIN.5 push.MAIN.6 push.API.2 push.SAFETY.5 splits namespaced target and parent selectors by product", async () => {
    const repo = await createPushRepo({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "features/beta.feature.yaml": `feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n`,
      "src/alpha.ts": `const alpha = "alpha.MAIN.1";\n`,
      "src/beta.ts": `const beta = "beta.MAIN.1";\n`,
    });
    const git = await createFakeGitContext({
      remote: "git@github.com:my-org/my-repo.git",
      branch: "main",
      topLevel: repo.root,
      head: "c0ffee0000000000000000000000000000000000",
      fileCommits: {
        "features/alpha.feature.yaml": "a1",
        "features/beta.feature.yaml": "b1",
      },
    });
    const requests: any[] = [];
    const server = createMockApiServer(async (request) => {
      requests.push(await request.clone().json());
      return Response.json({
        data: {
          product_name: requests[requests.length - 1].product_name,
          implementation_name: requests[requests.length - 1].target_impl_name ?? requests[requests.length - 1].parent_impl_name ?? "main",
          specs_created: 1,
          specs_updated: 0,
          warnings: [],
        },
      });
    });

    try {
      const result = await runCliSubprocess(
        ["push", "--target", "product-a/child", "--parent", "product-b/base"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(2);
      const productA = requests.find((entry) => entry.product_name === "product-a");
      const productB = requests.find((entry) => entry.product_name === "product-b");
      expect(productA?.target_impl_name).toBe("child");
      expect(productA?.parent_impl_name).toBeUndefined();
      expect(productB?.target_impl_name).toBeUndefined();
      expect(productB?.parent_impl_name).toBe("base");
    } finally {
      server.stop();
      await git.cleanup();
      await repo.cleanup();
    }
  });

  test("push.API.6 push.SAFETY.4 pushes refs-only payloads without --product", async () => {
    const repo = await createPushRepo({
      "src/alpha.ts": `const alpha = "alpha.MAIN.1";\n`,
    });
    const git = await createFakeGitContext({
      remote: "git@github.com:my-org/my-repo.git",
      branch: "main",
      topLevel: repo.root,
      head: "c0ffee0000000000000000000000000000000000",
    });

    const requests: any[] = [];
    const server = createMockApiServer(async (request) => {
      requests.push(await request.clone().json());
      return Response.json({
        data: {
          implementation_name: null,
          product_name: null,
          specs_created: 0,
          specs_updated: 0,
          warnings: [],
        },
      });
    });

    try {
      const result = await runCliSubprocess(
        ["push"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.product_name).toBeUndefined();
      expect(requests[0]?.references).toEqual({
        data: {
          "alpha.MAIN.1": [{ path: "src/alpha.ts:1", is_test: false }],
        },
        override: false,
      });
    } finally {
      server.stop();
      await git.cleanup();
      await repo.cleanup();
    }
  });

  test("push.API.4 push.SAFETY.3 exits non-zero when one product fails and another succeeds", async () => {
    const repo = await createPushRepo({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "features/beta.feature.yaml": `feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n`,
      "src/alpha.ts": `const alpha = "alpha.MAIN.1";\n`,
      "src/beta.ts": `const beta = "beta.MAIN.1";\n`,
    });
    const git = await createFakeGitContext({
      remote: "git@github.com:my-org/my-repo.git",
      branch: "main",
      topLevel: repo.root,
      head: "c0ffee0000000000000000000000000000000000",
      fileCommits: {
        "features/alpha.feature.yaml": "a1",
        "features/beta.feature.yaml": "b1",
      },
    });
    const server = createMockApiServer((request) => {
      return request.clone().json().then((body) => {
        const payload = body as { product_name?: string };
        return payload.product_name === "product-a"
          ? Response.json({
              data: {
                product_name: "product-a",
                implementation_name: "main",
                specs_created: 1,
                specs_updated: 0,
                warnings: [],
              },
            })
          : Response.json({ errors: { detail: "beta failed" } }, { status: 422 });
      });
    });

    try {
      const result = await runCliSubprocess(
        ["push"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Product: product-a");
      expect(result.stdout).toContain("Product: product-b");
      expect(result.stdout).toContain("Error: beta failed");
    } finally {
      server.stop();
      await git.cleanup();
      await repo.cleanup();
    }
  });

  test("push.OUTPUT.5 cli-core.OUTPUT.1 cli-core.OUTPUT.2 emits JSON payloads on stdout", async () => {
    const repo = await createPushRepo({
      "features/alpha.feature.yaml": `feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n`,
      "src/alpha.ts": `const alpha = "alpha.MAIN.1";\n`,
    });
    const git = await createFakeGitContext({
      remote: "git@github.com:my-org/my-repo.git",
      branch: "main",
      topLevel: repo.root,
      head: "c0ffee0000000000000000000000000000000000",
      fileCommits: {
        "features/alpha.feature.yaml": "a1",
      },
    });
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/push");
      return Response.json({
        data: {
          product_name: "product-a",
          implementation_name: "main",
          specs_created: 1,
          specs_updated: 0,
          warnings: ["json warning"],
        },
      });
    });

    try {
      const result = await runCliSubprocess(
        ["push", "--json"],
        {
          ...git.env,
          ACAI_API_BASE_URL: server.url.toString(),
          ACAI_API_TOKEN: "secret",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain("\"results\"");
      expect(JSON.parse(result.stdout).results[0].warnings).toEqual(["json warning"]);
      expect(result.stderr).toContain("Warning for product-a: json warning");
    } finally {
      server.stop();
      await git.cleanup();
      await repo.cleanup();
    }
  });

  test("cli-core.EXITS.2 rejects missing values followed by another flag", async () => {
    const result = await runCliSubprocess(["work", "--product", "example-product", "--changed-since-commit", "--json"], {
      ACAI_API_BASE_URL: "https://api.example.test",
      ACAI_API_TOKEN: "secret",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing value for --changed-since-commit.");
    expect(result.stderr).toContain("Usage: acai work");
  });
});
