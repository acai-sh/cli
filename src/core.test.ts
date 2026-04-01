import { describe, expect, mock, test } from "bun:test";
import { createApiClient } from "./core/api.ts";
import { resolveApiConfig } from "./core/config.ts";
import { writeJsonResult, writeTextResult } from "./core/output.ts";
import { normalizeRepoUri, readGitContext } from "./core/git.ts";
import { parseWorkArgs, runWorkCommand } from "./core/work.ts";
import { buildImplementationFeaturesResponse, buildImplementationsResponse } from "../test/support/fixtures.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";

describe("cli-core.CONFIG.1 cli-core.AUTH.2", () => {
  test("resolves API base URL and bearer token from env", () => {
    const config = resolveApiConfig({ ACAI_API_BASE_URL: "https://api.example.test", ACAI_API_TOKEN: "secret" });
    expect(config).toEqual({ baseUrl: "https://api.example.test", token: "secret" });
  });

  test("cli-core.CONFIG.2 fails when API configuration is missing", () => {
    expect(() => resolveApiConfig({})).toThrow("Missing API base URL configuration.");
  });
});

describe("cli-core.AUTH.1 cli-core.HTTP.1 cli-core.HTTP.2 cli-core.HTTP.3 cli-core.ERRORS.1", () => {
  test("applies bearer auth on outgoing API requests", async () => {
    const server = createMockApiServer((request) => {
      expect(request.headers.get("authorization")).toBe("Bearer secret");
      expect(new URL(request.url).searchParams.get("product_name")).toBe("example-product");
      return Response.json(buildImplementationsResponse());
    });

    try {
      const client = createApiClient({ baseUrl: server.url.toString(), token: "secret" });

      await expect(client.listImplementations({ productName: "example-product" })).resolves.toMatchObject({
        data: { product_name: "example-product" },
      });
    } finally {
      server.stop();
    }
  });

  test("normalizes network failures", async () => {
    const get = mock(async () => {
      throw new Error("network down");
    });

    const client = createApiClient(
      { baseUrl: "https://api.example.test", token: "secret" },
      { client: { GET: get } as never },
    );

    await expect(client.listImplementationFeatures({ productName: "example-product", implementationName: "main" })).rejects.toThrow("API request failed.");
  });

  test("surfaces API detail messages", async () => {
    const get = mock(async () => ({
      data: undefined,
      error: { errors: { detail: "detail from api" } },
      response: { status: 422 },
    }));

    const client = createApiClient(
      { baseUrl: "https://api.example.test", token: "secret" },
      { client: { GET: get } as never },
    );

    await expect(client.listImplementations({ productName: "example-product" })).rejects.toThrow("detail from api");
  });
});

describe("cli-core.OUTPUT.1 cli-core.OUTPUT.2", () => {
  test("routes json payload to stdout and diagnostics to stderr", async () => {
    const stdout = { write: mock(() => {}) };
    const stderr = { write: mock(() => {}) };

    await writeJsonResult({ stdout, stderr }, { ok: true }, ["warn"]);

    expect(stderr.write).toHaveBeenCalledWith("warn\n");
    expect(stdout.write).toHaveBeenCalledWith("{\"ok\":true}\n");
  });

  test("routes text payload to stdout and diagnostics to stderr", async () => {
    const stdout = { write: mock(() => {}) };
    const stderr = { write: mock(() => {}) };

    await writeTextResult({ stdout, stderr }, ["line one", "line two"], ["diag"]);

    expect(stderr.write).toHaveBeenCalledWith("diag\n");
    expect(stdout.write).toHaveBeenCalledWith("line one\n");
    expect(stdout.write).toHaveBeenCalledWith("line two\n");
  });
});

describe("cli-core.TARGETING.1 cli-core.TARGETING.2 cli-core.TARGETING.3 cli-core.TARGETING.4 cli-core.TARGETING.5 cli-core.ERRORS.2", () => {
  test("cli-core.TARGETING.1 parses direct work flags and repeated filters", () => {
    const parsed = parseWorkArgs([
      "work",
      "--product",
      "example-product",
      "--impl",
      "main",
      "--status",
      "todo",
      "--status",
      "doing",
      "--changed-since-commit",
      "abc123",
      "--json",
    ]);

    expect(parsed.workArgs).toEqual({
      productName: "example-product",
      implementationName: "main",
      statuses: ["todo", "doing"],
      changedSinceCommit: "abc123",
      json: true,
    });
  });

  test("cli-core.TARGETING.1 rejects missing values when the next token is another flag", () => {
    expect(() => parseWorkArgs(["work", "--product", "--json"])).toThrow("Missing value for --product.");
    expect(() => parseWorkArgs(["work", "--product", "example-product", "--impl", "--json"])).toThrow("Missing value for --impl.");
    expect(() => parseWorkArgs(["work", "--product", "example-product", "--status", "--json"])).toThrow("Missing value for --status.");
    expect(() => parseWorkArgs(["work", "--product", "example-product", "--changed-since-commit", "--json"])).toThrow("Missing value for --changed-since-commit.");
  });

  test("cli-core.TARGETING.2 and cli-core.TARGETING.3 normalize git remote context", async () => {
    const context = await readGitContext({
      runner: {
        async run(args) {
          if (args.join(" ") === "remote get-url origin") {
            return { exitCode: 0, stdout: "git@github.com:my-org/my-repo.git\n", stderr: "" };
          }

          if (args.join(" ") === "branch --show-current") {
            return { exitCode: 0, stdout: "main\n", stderr: "" };
          }

          return { exitCode: 1, stdout: "", stderr: "unexpected" };
        },
      },
    });

    expect(context).toEqual({ repoUri: "github.com/my-org/my-repo", branchName: "main" });
    expect(normalizeRepoUri("https://github.com/my-org/my-repo.git")).toBe("github.com/my-org/my-repo");
  });

  test("cli-core.TARGETING.4 and cli-core.TARGETING.5 resolve branch matches and fail on ambiguity", async () => {
    const apiClient = {
      listImplementations: mock(async () => buildImplementationsResponse({ data: { implementations: [{ implementation_id: "impl-1", implementation_name: "main" }] } })),
      listImplementationFeatures: mock(async () => buildImplementationFeaturesResponse()),
    };

    const result = await runWorkCommand(
      apiClient as never,
      { productName: "example-product", statuses: [], json: false },
      {
        readGitContext: async () => ({ repoUri: "github.com/my-org/my-repo", branchName: "main" }),
      },
    );

    expect(result.stdoutLines).toEqual(["example-feature 1/3 refs_count=2"]);
    expect(apiClient.listImplementations).toHaveBeenCalledWith({
      productName: "example-product",
      repoUri: "github.com/my-org/my-repo",
      branchName: "main",
    });

    const ambiguousClient = {
      listImplementations: mock(async () => buildImplementationsResponse({ data: { implementations: [
        { implementation_id: "impl-1", implementation_name: "main" },
        { implementation_id: "impl-2", implementation_name: "preview" },
      ] } })),
      listImplementationFeatures: mock(async () => buildImplementationFeaturesResponse()),
    };

    await expect(
      runWorkCommand(
        ambiguousClient as never,
        { productName: "example-product", statuses: [], json: false },
        { readGitContext: async () => ({ repoUri: "github.com/my-org/my-repo", branchName: "main" }) },
      ),
    ).rejects.toThrow("Multiple implementations matched the current repo, branch, and product: main, preview");
  });

  test("cli-core.ERRORS.2 reports missing git context", async () => {
    await expect(
      readGitContext({
        runner: {
          async run() {
            return { exitCode: 1, stdout: "", stderr: "git failure" };
          },
        },
      }),
    ).rejects.toThrow("Git context could not be determined.");
  });
});

describe("work.MAIN.1 work.MAIN.3 work.MAIN.4 work.MAIN.5 work.MAIN.6 work.MAIN.7 work.MAIN.8 work.API.1 work.API.2 work.UX.1 work.UX.2 work.UX.3 work.UX.4 work.UX.5", () => {
  test("formats the text worklist in API order and keeps counts visible", async () => {
    const result = await runWorkCommand(
      {
        listImplementations: mock(async () => buildImplementationsResponse()),
        listImplementationFeatures: mock(async () => buildImplementationFeaturesResponse()),
      } as never,
      { productName: "example-product", implementationName: "main", statuses: ["todo", "doing"], changedSinceCommit: "abc123", json: false },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdoutLines: ["example-feature 1/3 refs_count=2"],
    });
  });

  test("work.MAIN.6 and work.UX.5 return the full JSON payload", async () => {
    const payload = buildImplementationFeaturesResponse();

    const result = await runWorkCommand(
      {
        listImplementations: mock(async () => buildImplementationsResponse()),
        listImplementationFeatures: mock(async () => payload),
      } as never,
      { productName: "example-product", implementationName: "main", statuses: [], json: true },
    );

    expect(result).toEqual({ exitCode: 0, jsonPayload: payload });
  });

  test("work.MAIN.7 and work.MAIN.8 forward repeated statuses and changed-since filters", async () => {
    const listImplementationFeatures = mock(async () => buildImplementationFeaturesResponse());
    const apiClient = {
      listImplementations: mock(async () => buildImplementationsResponse()),
      listImplementationFeatures,
    };

    await runWorkCommand(
      apiClient as never,
      {
        productName: "example-product",
        implementationName: "main",
        statuses: ["todo", "doing"],
        changedSinceCommit: "abc123",
        json: false,
      },
    );

    expect(listImplementationFeatures).toHaveBeenCalledWith({
      productName: "example-product",
      implementationName: "main",
      statuses: ["todo", "doing"],
      changedSinceCommit: "abc123",
    });
  });
});
