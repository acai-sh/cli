import { describe, expect, mock, test } from "bun:test";
import { buildFeatureContextResponse, buildImplementationsResponse } from "../test/support/fixtures.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { createApiClient } from "./core/api.ts";
import { formatFeatureContext, normalizeFeatureOptions, runFeatureCommand } from "./core/feature.ts";
import { resolveImplementationName } from "./core/targeting.ts";

describe("feature.MAIN.1 feature.MAIN.2 feature.MAIN.3 feature.MAIN.4 feature.MAIN.5 feature.MAIN.6", () => {
  test("feature.MAIN.2 and feature.MAIN.3 normalize direct selectors", () => {
    expect(
      normalizeFeatureOptions("feature", {
        product: "example-product",
        impl: "main",
        status: ["completed", "incomplete"],
        includeRefs: true,
        json: true,
      }),
    ).toEqual({
      featureName: "feature",
      productName: "example-product",
      implementationName: "main",
      statuses: ["completed", "incomplete"],
      includeRefs: true,
      json: true,
    });
  });

  test("feature.MAIN.2 resolves product from a namespaced implementation selector", () => {
    expect(
      normalizeFeatureOptions("feature", {
        impl: "example-product/main",
      }),
    ).toEqual({
      featureName: "feature",
      productName: "example-product",
      implementationName: "main",
      statuses: [],
      includeRefs: false,
      json: false,
    });
  });

  test("feature.MAIN.2 rejects conflicting explicit and namespaced product selectors", () => {
    expect(() =>
      normalizeFeatureOptions("feature", {
        product: "example-product",
        impl: "other-product/main",
      }),
    ).toThrow("Conflicting product selectors");
  });

  test("feature.MAIN.2 rejects missing product selection", () => {
    expect(() =>
      normalizeFeatureOptions("feature", {
        impl: "main",
      }),
    ).toThrow("Missing product selector");
  });

  test("feature.MAIN.1 and feature.MAIN.5 reject missing values", () => {
    expect(() => normalizeFeatureOptions("-bad", { product: "example-product" })).toThrow(
      "Missing value for <feature-name>.",
    );
    expect(() => normalizeFeatureOptions("feature", { product: "-bad" })).toThrow(
      "Missing value for --product.",
    );
    expect(() => normalizeFeatureOptions("feature", { product: "example-product", impl: "-bad" })).toThrow(
      "Missing value for --impl.",
    );
    expect(() =>
      normalizeFeatureOptions("feature", {
        product: "example-product",
        status: ["-bad"],
      }),
    ).toThrow("Missing value for --status.");
  });
});

describe("cli-core.TARGETING.1 cli-core.TARGETING.2 cli-core.TARGETING.3 cli-core.TARGETING.4 cli-core.TARGETING.5 cli-core.ERRORS.2", () => {
  test("cli-core.TARGETING.1 uses an explicit implementation directly", async () => {
    const apiClient = {
      listImplementations: mock(async () => {
        throw new Error("should not be called");
      }),
    };

    await expect(
      resolveImplementationName(apiClient as never, {
        productName: "example-product",
        implementationName: "main",
      }),
    ).resolves.toBe("main");
    expect(apiClient.listImplementations).not.toHaveBeenCalled();
  });

  test("cli-core.TARGETING.2 and cli-core.TARGETING.3 resolve one git-derived implementation", async () => {
    const apiClient = {
      listImplementations: mock(async () =>
        buildImplementationsResponse({
          data: {
            implementations: [{ implementation_id: "impl-1", implementation_name: "main" }],
          },
        })),
    };

    await expect(
      resolveImplementationName(
        apiClient as never,
        { productName: "example-product" },
        {
          readGitContext: async () => ({ repoUri: "github.com/my-org/my-repo", branchName: "main" }),
        },
      ),
    ).resolves.toBe("main");
  });

  test("cli-core.TARGETING.4 rejects ambiguous git-derived implementations", async () => {
    const apiClient = {
      listImplementations: mock(async () =>
        buildImplementationsResponse({
          data: {
            implementations: [
              { implementation_id: "impl-1", implementation_name: "main" },
              { implementation_id: "impl-2", implementation_name: "preview" },
            ],
          },
        })),
    };

    await expect(
      resolveImplementationName(
        apiClient as never,
        { productName: "example-product" },
        {
          readGitContext: async () => ({ repoUri: "github.com/my-org/my-repo", branchName: "main" }),
        },
      ),
    ).rejects.toThrow("Multiple implementations matched the current repo, branch, and product: main, preview");
  });

  test("cli-core.TARGETING.5 rejects when no git-derived implementation matches", async () => {
    const apiClient = {
      listImplementations: mock(async () => buildImplementationsResponse({ data: { implementations: [] } })),
    };

    await expect(
      resolveImplementationName(
        apiClient as never,
        { productName: "example-product" },
        {
          readGitContext: async () => ({ repoUri: "github.com/my-org/my-repo", branchName: "main" }),
        },
      ),
    ).rejects.toThrow("No implementation matched the current repo, branch, and product. This branch may not have been pushed yet. Try: acai push --all");
  });

  test("cli-core.ERRORS.2 surfaces missing git context", async () => {
    const apiClient = {
      listImplementations: mock(async () => buildImplementationsResponse()),
    };

    await expect(
      resolveImplementationName(
        apiClient as never,
        { productName: "example-product" },
        {
          readGitContext: async () => {
            throw new Error("git missing");
          },
        },
      ),
    ).rejects.toThrow("git missing");
  });
});

describe("feature.API.1 feature.API.2 feature.API.3 feature.UX.1 feature.UX.2 cli-core.OUTPUT.1 cli-core.OUTPUT.2", () => {
  test("feature.API.1 requests GET /feature-context and forwards filters", async () => {
    const server = createMockApiServer((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/feature-context");
      expect(url.searchParams.get("product_name")).toBe("example-product");
      expect(url.searchParams.get("feature_name")).toBe("feature");
      expect(url.searchParams.get("implementation_name")).toBe("main");
      expect(url.searchParams.get("include_refs")).toBe("true");
      expect(url.searchParams.getAll("statuses")).toEqual(["completed", "incomplete"]);
      return Response.json(buildFeatureContextResponse());
    });

    try {
      const client = createApiClient({ baseUrl: server.url.toString(), token: "secret" });
      await expect(
        client.getFeatureContext({
          productName: "example-product",
          featureName: "feature",
          implementationName: "main",
          includeRefs: true,
          statuses: ["completed", "incomplete"],
        }),
      ).resolves.toEqual(buildFeatureContextResponse());
    } finally {
      server.stop();
    }
  });

  test("feature.API.2 feature.API.3 and feature.UX.1 format summary, acids, refs, and warnings in API order", () => {
    const payload = buildFeatureContextResponse({
      data: {
        acids: [
          {
            acid: "feature.MAIN.2",
            refs_count: 0,
            requirement: "second",
            state: { status: "incomplete" },
            test_refs_count: 0,
            refs: [],
          },
          {
            acid: "feature.MAIN.1",
            refs_count: 1,
            requirement: "first",
            state: { status: "completed" },
            test_refs_count: 1,
            refs: [
              {
                branch_name: "main",
                is_test: true,
                path: "src/feature.test.ts",
                repo_uri: "github.com/my-org/my-repo",
              },
            ],
          },
        ],
        summary: {
          total_acids: 2,
          status_counts: { incomplete: 1, completed: 1 } as never,
        },
        warnings: ["warning one"],
      },
    });

    expect(formatFeatureContext(payload, true)).toEqual([
      "example-product/main feature=feature",
      "summary total_acids=2 status_counts=incomplete:1,completed:1",
      "feature.MAIN.2 status=incomplete refs=0 test_refs=0 requirement=second",
      "feature.MAIN.1 status=completed refs=1 test_refs=1 requirement=first",
      "  ref repo=github.com/my-org/my-repo branch=main path=src/feature.test.ts is_test=true",
      "warning: warning one",
    ]);
  });

  test("feature.MAIN.6 cli-core.OUTPUT.1 and cli-core.OUTPUT.2 keep the full json payload on stdout and warnings on stderr", async () => {
    const payload = buildFeatureContextResponse({ data: { warnings: ["warning one"] } });
    const result = await runFeatureCommand(
      {
        listImplementations: mock(async () => buildImplementationsResponse()),
        getFeatureContext: mock(async () => payload),
      } as never,
      {
        featureName: "feature",
        productName: "example-product",
        implementationName: "main",
        statuses: [],
        includeRefs: false,
        json: true,
      },
    );

    expect(result).toEqual({ exitCode: 0, jsonPayload: payload, stderrLines: ["warning one"] });
  });
});
