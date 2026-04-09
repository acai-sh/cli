import { describe, expect, test } from "bun:test";
import {
	buildImplementationFeatureEntry,
	buildImplementationFeaturesResponse,
	buildImplementationsResponse,
} from "../test/support/fixtures.ts";
import { createFakeGitContext } from "../test/support/fake-git.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { runCliSubprocess } from "../test/support/cli.ts";
import { apiEnv, expectUsageError } from "../test/support/e2e.ts";

describe("features command", () => {
	test("features.API.1 features.UX.1 prints text output for a direct target", async () => {
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
				[
					"features",
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
				],
				apiEnv(server),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			const lines = result.stdout.trim().split("\n");
			expect(lines[0]).toContain("FEATURE");
			expect(lines[0]).toContain("DONE");
			expect(lines[0]).toContain("LAST_SEEN");
			expect(result.stdout).toContain("feature-a");
			expect(result.stdout).toContain("2/4");
			expect(result.stdout).toContain("feature-b");
			expect(result.stdout).toContain("1/2");
		} finally {
			server.stop();
		}
	});

	test("cli-core.TARGETING.2 cli-core.TARGETING.3 resolve exactly one implementation from git context", async () => {
		const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementations") {
				expect(url.searchParams.get("product_name")).toBe("example-product");
				expect(url.searchParams.get("repo_uri")).toBe("github.com/my-org/my-repo");
				expect(url.searchParams.get("branch_name")).toBe("main");
				return Response.json(buildImplementationsResponse());
			}
			if (url.pathname === "/implementation-features") {
				expect(url.searchParams.get("implementation_name")).toBe("main");
				return Response.json(
					buildImplementationFeaturesResponse({
						data: { features: [buildImplementationFeatureEntry({ feature_name: "feature-a", completed_count: 3, total_count: 5, refs_count: 2 })] },
					}),
				);
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(["features", "--product", "example-product"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(result.stdout).toContain("FEATURE");
			expect(result.stdout).toContain("feature-a");
			expect(result.stdout).toContain("3/5");
			expect(result.stdout).toContain("abc123");
		} finally {
			server.stop();
			await git.cleanup();
		}
	});

	for (const [acid, implementations, message] of [
		[
			"cli-core.TARGETING.4",
			[
				{ implementation_id: "impl-1", implementation_name: "main" },
				{ implementation_id: "impl-2", implementation_name: "preview" },
			],
			"Multiple implementations matched the current repo, branch, and product",
		],
		[
			"cli-core.TARGETING.5",
			[],
			"No implementation matched the current repo, branch, and product. This branch may not have been pushed yet. Try: acai push --all",
		],
	] as const) {
		test(`${acid} exits non-zero for unsupported branch targeting`, async () => {
			const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
			const server = createMockApiServer((request) => {
				const url = new URL(request.url);
				if (url.pathname === "/implementations") {
					return Response.json(buildImplementationsResponse({ data: { implementations } }));
				}
				return new Response("not found", { status: 404 });
			});

			try {
				const result = await runCliSubprocess(["features", "--product", "example-product"], apiEnv(server, git.env));
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(message);
			} finally {
				server.stop();
				await git.cleanup();
			}
		});
	}

	test("cli-core.ERRORS.2 exits non-zero when git context cannot be determined", async () => {
		const git = await createFakeGitContext({ remoteExitCode: 1 });
		const result = await runCliSubprocess(["features", "--product", "example-product"], {
			...git.env,
			ACAI_API_BASE_URL: "https://api.example.test",
			ACAI_API_TOKEN: "secret",
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Git context could not be determined.");
		await git.cleanup();
	});

	test("cli-core.CONFIG.2 exits with usage errors when the API token is missing", async () => {
		const result = await runCliSubprocess(["features", "--product", "example-product", "--impl", "main"], { ACAI_API_TOKEN: "" });
		expectUsageError(result, "Usage: acai features", "Missing API bearer token configuration.");
	});

	test("cli-core.EXITS.2 requires a product selector", async () => {
		const result = await runCliSubprocess(["features", "--impl", "main"], {
			ACAI_API_BASE_URL: "https://api.example.test",
			ACAI_API_TOKEN: "secret",
		});
		expectUsageError(result, "Usage: acai features", "required option '--product <name>' not specified");
	});

	test("cli-core.TARGETING.1 still reports a missing product selector when API env is absent", async () => {
		const result = await runCliSubprocess(["features", "--impl", "main"]);
		expectUsageError(result, "Usage: acai features", "required option '--product <name>' not specified");
	});

	test("cli-core.ERRORS.3 exits non-zero for unknown commands", async () => {
		const result = await runCliSubprocess(["bogus"]);
		expectUsageError(result, "Usage: acai", "unknown command");
	});

	test("cli-core.ERRORS.4 exits non-zero for unknown features options", async () => {
		const result = await runCliSubprocess(["features", "--product", "example-product", "--unknown-option"]);
		expectUsageError(result, "Usage: acai features", "unknown option");
	});

	for (const [acid, detail, status] of [
		["cli-core.HTTP.2", "unauthorized", 401],
		["cli-core.HTTP.3", "validation failed", 422],
		["cli-core.HTTP.3", "not found", 404],
	] as const) {
		test(`${acid} surfaces features API failure: ${detail}`, async () => {
			const server = createMockApiServer((request) => {
				const url = new URL(request.url);
				if (url.pathname === "/implementation-features") {
					return Response.json({ errors: { detail } }, { status });
				}
				return new Response("not found", { status: 404 });
			});

			try {
				const result = await runCliSubprocess(["features", "--product", "example-product", "--impl", "main"], apiEnv(server));
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(detail);
			} finally {
				server.stop();
			}
		});
	}

	test("cli-core.HTTP.1 handles network failures", async () => {
		const result = await runCliSubprocess(["features", "--product", "example-product", "--impl", "main"], {
			ACAI_API_BASE_URL: "http://127.0.0.1:65535",
			ACAI_API_TOKEN: "secret",
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("API request failed.");
	});

	test("features.MAIN.6 features.UX.5 keep json payload on stdout", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementation-features") {
				return Response.json(buildImplementationFeaturesResponse({ data: { features: [buildImplementationFeatureEntry({ feature_name: "feature-a" })] } }));
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(["features", "--product", "example-product", "--impl", "main", "--json"], apiEnv(server));
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(JSON.parse(result.stdout).data.features[0].feature_name).toBe("feature-a");
		} finally {
			server.stop();
		}
	});

	test("features.UX.4 exits successfully when no features are returned", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementation-features") {
				return Response.json(buildImplementationFeaturesResponse({ data: { features: [] } }));
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(["features", "--product", "example-product", "--impl", "main"], apiEnv(server));
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("No features were returned.");
		} finally {
			server.stop();
		}
	});

	test("cli-core.EXITS.2 rejects missing values followed by another flag", async () => {
		const result = await runCliSubprocess([
			"features",
			"--product",
			"example-product",
			"--changed-since-commit",
			"--json",
		], {
			ACAI_API_BASE_URL: "https://api.example.test",
			ACAI_API_TOKEN: "secret",
		});
		expectUsageError(result, "Usage: acai features", "Missing value for --changed-since-commit.");
	});
});
