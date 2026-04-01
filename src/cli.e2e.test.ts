import { describe, expect, test } from "bun:test";
import { buildImplementationFeatureEntry, buildImplementationFeaturesResponse, buildImplementationsResponse } from "../test/support/fixtures.ts";
import { createFakeGitContext } from "../test/support/fake-git.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { runCliSubprocess } from "../test/support/cli.ts";

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
    expect(help.stdout).toContain("Usage: acai work");
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

  test("cli-core.CONFIG.2 exits with usage errors when config is missing", async () => {
    const result = await runCliSubprocess(["work", "--product", "example-product", "--impl", "main"], {
      ACAI_API_TOKEN: "secret",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing API base URL configuration.");
    expect(result.stderr).toContain("Usage: acai work");
  });

  test("work.MAIN.2 and cli-core.EXITS.2 require a product selector", async () => {
    const result = await runCliSubprocess(["work", "--impl", "main"], {
      ACAI_API_BASE_URL: "https://api.example.test",
      ACAI_API_TOKEN: "secret",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing required --product value.");
    expect(result.stderr).toContain("Usage: acai work");
  });

  test("cli-core.TARGETING.1 still reports a missing product selector when API env is absent", async () => {
    const result = await runCliSubprocess(["work", "--impl", "main"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing required --product value.");
    expect(result.stderr).toContain("Usage: acai work");
  });

  test("cli-core.ERRORS.3 exits non-zero for unknown commands", async () => {
    const result = await runCliSubprocess(["bogus"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown command");
    expect(result.stderr).toContain("Usage: acai");
  });

  test("cli-core.ERRORS.4 exits non-zero for unknown work options", async () => {
    const result = await runCliSubprocess(["work", "--unknown-option"]);

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
