import { describe, expect, test } from "bun:test";
import {
	buildFeatureContextResponse,
	buildImplementationsResponse,
} from "../test/support/fixtures.ts";
import { createFakeGitContext } from "../test/support/fake-git.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { runCliSubprocess } from "../test/support/cli.ts";
import { apiEnv, expectUsageError } from "../test/support/e2e.ts";

describe("feature command", () => {
	test("feature.API.2 feature.API.3 feature.UX.1 prints text output for a direct target with refs, statuses, and warnings", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);

			if (url.pathname === "/feature-context") {
				expect(url.searchParams.get("product_name")).toBe("example-product");
				expect(url.searchParams.get("feature_name")).toBe("feature");
				expect(url.searchParams.get("implementation_name")).toBe("main");
				expect(url.searchParams.get("include_refs")).toBe("true");
				expect(url.searchParams.getAll("statuses")).toEqual([
					"completed",
					"incomplete",
				]);

				return Response.json(
					buildFeatureContextResponse({
						data: {
							acids: [
								{
									acid: "feature.MAIN.2",
									refs_count: 0,
									requirement: "requires product selector",
									state: { status: "incomplete" },
									test_refs_count: 0,
									refs: [],
								},
								{
									acid: "feature.API.3",
									refs_count: 1,
									requirement: "relays refs",
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
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				[
					"feature",
					"feature",
					"--product",
					"example-product",
					"--impl",
					"main",
					"--status",
					"completed",
					"--status",
					"incomplete",
					"--include-refs",
				],
				apiEnv(server),
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(result.stdout.trim().split("\n")).toEqual([
				"example-product/main feature=feature",
				"summary total_acids=2 status_counts=incomplete:1,completed:1",
				"feature.MAIN.2 status=incomplete refs=0 test_refs=0 requirement=requires product selector",
				"feature.API.3 status=completed refs=1 test_refs=1 requirement=relays refs",
				"  ref repo=github.com/my-org/my-repo branch=main path=src/feature.test.ts is_test=true",
				"warning: warning one",
			]);
		} finally {
			server.stop();
		}
	});

	test("cli-core.TARGETING.2 cli-core.TARGETING.3 resolve exactly one implementation from git context", async () => {
		const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementations") {
				return Response.json(buildImplementationsResponse());
			}
			if (url.pathname === "/feature-context") {
				expect(url.searchParams.get("implementation_name")).toBe("main");
				return Response.json(buildFeatureContextResponse());
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["feature", "feature", "--product", "example-product"],
				apiEnv(server, git.env),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(result.stdout).toContain("example-product/main feature=feature");
		} finally {
			server.stop();
			await git.cleanup();
		}
	});

	test("feature.MAIN.2 resolves product from --impl product/implementation without --product", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/feature-context") {
				expect(url.searchParams.get("product_name")).toBe("example-product");
				expect(url.searchParams.get("implementation_name")).toBe("preview");
				return Response.json(
					buildFeatureContextResponse({ data: { implementation_name: "preview" } }),
				);
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["feature", "feature", "--impl", "example-product/preview"],
				apiEnv(server),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(result.stdout).toContain("example-product/preview feature=feature");
		} finally {
			server.stop();
		}
	});

	test("feature.MAIN.6 cli-core.OUTPUT.1 cli-core.OUTPUT.2 keeps json payload on stdout and warnings on stderr", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/feature-context") {
				return Response.json(
					buildFeatureContextResponse({ data: { warnings: ["warning one"] } }),
				);
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["feature", "feature", "--product", "example-product", "--impl", "main", "--json"],
				apiEnv(server),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("warning one");
			expect(JSON.parse(result.stdout).data.feature_name).toBe("feature");
		} finally {
			server.stop();
		}
	});

	test("cli-core.ERRORS.4 reject unknown feature options", async () => {
		const result = await runCliSubprocess([
			"feature",
			"feature",
			"--product",
			"example-product",
			"--unknown-option",
		]);
		expectUsageError(result, "Usage: acai feature", "unknown option");
	});

	for (const [acid, detail, status] of [
		["cli-core.HTTP.2", "unauthorized", 401],
		["cli-core.HTTP.3", "validation failed", 422],
		["cli-core.HTTP.3", "not found", 404],
	] as const) {
		test(`${acid} surface feature API failure: ${detail}`, async () => {
			const server = createMockApiServer((request) => {
				const url = new URL(request.url);
				if (url.pathname === "/feature-context") {
					return Response.json({ errors: { detail } }, { status });
				}
				return new Response("not found", { status: 404 });
			});

			try {
				const result = await runCliSubprocess(
					["feature", "feature", "--product", "example-product", "--impl", "main"],
					apiEnv(server),
				);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(detail);
			} finally {
				server.stop();
			}
		});
	}

	test("cli-core.HTTP.1 surfaces feature network failures", async () => {
		const result = await runCliSubprocess(
			["feature", "feature", "--product", "example-product", "--impl", "main"],
			{ ACAI_API_BASE_URL: "http://127.0.0.1:65535", ACAI_API_TOKEN: "secret" },
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("API request failed.");
	});
});
