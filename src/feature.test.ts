import { describe, expect, mock, test } from "bun:test";
import {
	buildFeatureContextResponse,
	buildImplementationsResponse,
} from "../test/support/fixtures.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { createApiClient } from "./core/api.ts";
import {
	formatFeatureContext,
	normalizeFeatureOptions,
	runFeatureCommand,
} from "./core/feature.ts";
import {
	resolveImplementationName,
	resolveImplementationTarget,
} from "./core/targeting.ts";

describe("feature option normalization", () => {
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
			implementationFilter: undefined,
			statuses: ["completed", "incomplete"],
			includeRefs: true,
			json: true,
		});
	});

	test("feature.MAIN.2-1 feature.MAIN.3 resolves product from a namespaced implementation selector", () => {
		expect(
			normalizeFeatureOptions("feature", {
				impl: "example-product/main",
			}),
		).toEqual({
			featureName: "feature",
			productName: "example-product",
			implementationName: "main",
			implementationFilter: undefined,
			statuses: [],
			includeRefs: false,
			json: false,
		});
	});

	test("feature.MAIN.2-1 allows omitted --product so feature can use branch discovery", () => {
		expect(
			normalizeFeatureOptions("feature", {}),
		).toEqual({
			featureName: "feature",
			productName: undefined,
			implementationName: undefined,
			implementationFilter: undefined,
			statuses: [],
			includeRefs: false,
			json: false,
		});
	});

	test("feature.MAIN.2-1 feature.MAIN.3 treats omitted-product --impl as a discovery filter", () => {
		expect(
			normalizeFeatureOptions("feature", {
				impl: "main",
			}),
		).toEqual({
			featureName: "feature",
			productName: undefined,
			implementationName: undefined,
			implementationFilter: "main",
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

	test("feature.MAIN.1 and feature.MAIN.5 reject missing values", () => {
		expect(() =>
			normalizeFeatureOptions("-bad", { product: "example-product" }),
		).toThrow("Missing value for <feature-name>.");
		expect(() =>
			normalizeFeatureOptions("feature", { product: "-bad" }),
		).toThrow("Missing value for --product.");
		expect(() =>
			normalizeFeatureOptions("feature", {
				product: "example-product",
				impl: "-bad",
			}),
		).toThrow("Missing value for --impl.");
		expect(() =>
			normalizeFeatureOptions("feature", {
				product: "example-product",
				status: ["-bad"],
			}),
		).toThrow("Missing value for --status.");
	});
});

describe("implementation targeting", () => {
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

	test("feature.MAIN.2-1 cli-core.TARGETING.2 cli-core.TARGETING.3 resolve one git-derived implementation context with feature filtering", async () => {
		const apiClient = {
			listImplementations: mock(async () =>
				buildImplementationsResponse({
					data: {
						implementations: [
							{
								implementation_id: "impl-1",
								implementation_name: "main",
								product_name: "example-product",
							},
						],
					},
				}),
			),
		};

		await expect(
			resolveImplementationTarget(
				apiClient as never,
				{ featureName: "feature" },
				{
					readGitContext: async () => ({
						repoUri: "github.com/my-org/my-repo",
						branchName: "main",
					}),
				},
			),
		).resolves.toEqual({
			productName: "example-product",
			implementationName: "main",
		});
		expect(apiClient.listImplementations).toHaveBeenCalledWith({
			productName: undefined,
			repoUri: "github.com/my-org/my-repo",
			branchName: "main",
			featureName: "feature",
		});
	});

	test("feature.MAIN.2-1 cli-core.TARGETING.3 filters branch discovery by an omitted-product --impl value", async () => {
		const apiClient = {
			listImplementations: mock(async () =>
				buildImplementationsResponse({
					data: {
						implementations: [
							{
								implementation_id: "impl-1",
								implementation_name: "main",
								product_name: "product-a",
							},
							{
								implementation_id: "impl-2",
								implementation_name: "preview",
								product_name: "product-b",
							},
						],
					},
				}),
			),
		};

		await expect(
			resolveImplementationTarget(
				apiClient as never,
				{ featureName: "feature", implementationFilter: "main" },
				{
					readGitContext: async () => ({
						repoUri: "github.com/my-org/my-repo",
						branchName: "main",
					}),
				},
			),
		).resolves.toEqual({
			productName: "product-a",
			implementationName: "main",
		});
	});

	test("cli-core.TARGETING.4 feature.MAIN.2-2 rejects ambiguous git-derived implementations with qualified selectors", async () => {
		const apiClient = {
			listImplementations: mock(async () =>
				buildImplementationsResponse({
					data: {
						implementations: [
							{
								implementation_id: "impl-1",
								implementation_name: "main",
								product_name: "product-b",
							},
							{
								implementation_id: "impl-2",
								implementation_name: "main",
								product_name: "product-a",
							},
						],
					},
				}),
			),
		};

		await expect(
			resolveImplementationName(apiClient as never, {}, {
				readGitContext: async () => ({
					repoUri: "github.com/my-org/my-repo",
					branchName: "main",
				}),
			}),
		).rejects.toThrow(
			"Multiple implementations matched the current repo, branch, and filters: product-a/main, product-b/main",
		);
	});

	test("cli-core.TARGETING.5 feature.MAIN.2-2 rejects when no git-derived implementation matches the filters", async () => {
		const apiClient = {
			listImplementations: mock(async () =>
				buildImplementationsResponse({ data: { implementations: [] } }),
			),
		};

		await expect(
			resolveImplementationName(apiClient as never, { featureName: "feature" }, {
				readGitContext: async () => ({
					repoUri: "github.com/my-org/my-repo",
					branchName: "main",
				}),
			}),
		).rejects.toThrow(
			"No implementation matched the current repo, branch, and filters. This branch may not be tracked yet or no tracked implementation on this branch includes feature `feature`. Try `acai push` from this branch, or pass `--product` and `--impl` for a known implementation.",
		);
	});

	test("cli-core.ERRORS.2 surfaces missing git context", async () => {
		const apiClient = {
			listImplementations: mock(async () => buildImplementationsResponse()),
		};

		await expect(
			resolveImplementationName(apiClient as never, { productName: "example-product" }, {
				readGitContext: async () => {
					throw new Error("git missing");
				},
			}),
		).rejects.toThrow("git missing");
	});
});

describe("feature API and formatting", () => {
	test("feature.API.1 requests GET /feature-context and forwards filters", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			expect(url.pathname).toBe("/feature-context");
			expect(url.searchParams.get("product_name")).toBe("example-product");
			expect(url.searchParams.get("feature_name")).toBe("feature");
			expect(url.searchParams.get("implementation_name")).toBe("main");
			expect(url.searchParams.get("include_refs")).toBe("true");
			expect(url.searchParams.getAll("statuses")).toEqual([
				"completed",
				"incomplete",
			]);
			return Response.json(buildFeatureContextResponse());
		});

		try {
			const client = createApiClient({
				baseUrl: server.url.toString(),
				token: "secret",
			});
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
			"TARGET: example-product/main",
			"FEATURE: feature",
			"TOTAL: 2",
			"STATUS: incomplete:1,completed:1",
			"",
			"ACID            STATUS      REFS  TESTS  REQUIREMENT",
			"--------------  ----------  ----  -----  -----------",
			"feature.MAIN.2  incomplete  0     0      second     ",
			"feature.MAIN.1  completed   1     1      first      ",
			"",
			"REFS",
			"ACID            TYPE  REPO                       BRANCH  PATH               ",
			"--------------  ----  -------------------------  ------  -------------------",
			"feature.MAIN.1  test  github.com/my-org/my-repo  main    src/feature.test.ts",
			"",
			"WARNINGS",
			"warning one",
		]);
	});

	test("feature.UX.2 only performs targeting reads and feature-context reads", async () => {
		const getFeatureContext = mock(async () => buildFeatureContextResponse());
		const setFeatureStates = mock(async () => {
			throw new Error("should not be called");
		});
		const push = mock(async () => {
			throw new Error("should not be called");
		});

		await runFeatureCommand(
			{
				listImplementations: mock(async () => {
					throw new Error("should not be called");
				}),
				getFeatureContext,
				setFeatureStates,
				push,
			} as never,
			{
				featureName: "feature",
				productName: "example-product",
				implementationName: "main",
				implementationFilter: undefined,
				statuses: [],
				includeRefs: false,
				json: false,
			},
		);

		expect(getFeatureContext).toHaveBeenCalledTimes(1);
		expect(setFeatureStates).not.toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
	});

		test("feature.MAIN.6 cli-core.OUTPUT.1 and cli-core.OUTPUT.2 keep the full json payload on stdout and warnings on stderr", async () => {
		const payload = buildFeatureContextResponse({
			data: { warnings: ["warning one"] },
		});
		const result = await runFeatureCommand(
			{
				listImplementations: mock(async () => buildImplementationsResponse()),
				getFeatureContext: mock(async () => payload),
			} as never,
			{
				featureName: "feature",
				productName: "example-product",
				implementationName: "main",
				implementationFilter: undefined,
				statuses: [],
				includeRefs: false,
				json: true,
			},
		);

		expect(result).toEqual({
			exitCode: 0,
			jsonPayload: payload,
			stderrLines: ["warning one"],
		});
	});
});
