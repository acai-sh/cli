import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCanonicalSkillContent } from "./core/skill.ts";
import {
	buildFeatureContextResponse,
	buildFeatureStatesResponse,
	buildImplementationFeatureEntry,
	buildImplementationFeaturesResponse,
	buildImplementationsResponse,
} from "../test/support/fixtures.ts";
import { createFakeGitContext } from "../test/support/fake-git.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { runCliSubprocess } from "../test/support/cli.ts";

async function createPushRepo(
	files: Record<string, string>,
): Promise<{ root: string; cleanup(): Promise<void> }> {
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
		expect(result.stdout).toContain("features");
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

	test("acai features --help and acai features -h produce the same command help", async () => {
		const help = await runCliSubprocess(["features", "--help"]);
		const shortHelp = await runCliSubprocess(["features", "-h"]);

		expect(help.exitCode).toBe(0);
		expect(shortHelp.exitCode).toBe(0);
		expect(help.stdout).toBe(shortHelp.stdout);
		expect(help.stdout).toContain(
			"Usage: acai features --product <name> [options]",
		);
		expect(help.stdout).toContain("product name (required)");
		expect(help.stderr.trim()).toBe("");
		expect(shortHelp.stderr.trim()).toBe("");
	});

	test("feature.MAIN.1 cli-core.HELP.3 cli-core.HELP.5 keep feature --help and -h in sync", async () => {
		const help = await runCliSubprocess(["feature", "--help"]);
		const shortHelp = await runCliSubprocess(["feature", "-h"]);

		expect(help.exitCode).toBe(0);
		expect(shortHelp.exitCode).toBe(0);
		expect(help.stdout).toBe(shortHelp.stdout);
		expect(help.stdout).toContain(
			"Usage: acai feature <feature-name> [options]",
		);
		expect(help.stderr.trim()).toBe("");
	});

	test("skill.MAIN.1 cli-core.HELP.3 cli-core.HELP.4 cli-core.HELP.5 keep skill --help and -h in sync", async () => {
		const help = await runCliSubprocess(["skill", "--help"]);
		const shortHelp = await runCliSubprocess(["skill", "-h"]);

		expect(help.exitCode).toBe(0);
		expect(shortHelp.exitCode).toBe(0);
		expect(help.stdout).toBe(shortHelp.stdout);
		expect(help.stdout).toContain("Usage: acai skill [options]");
		expect(help.stderr.trim()).toBe("");
	});
});

describe("skill.MAIN.1 skill.MAIN.2 skill.MAIN.3 skill.MAIN.4 skill.WRITE.1 skill.WRITE.2 skill.WRITE.3 skill.SAFETY.1 skill.SAFETY.2 skill.SAFETY.3 skill.UX.1 skill.UX.2 cli-core.EXITS.1 cli-core.ERRORS.4 cli-core.UX.1 cli-core.UX.2", () => {
	test("skill.MAIN.2 skill.MAIN.3 skill.UX.1 prints the canonical skill markdown and nothing else", async () => {
		const root = await mkdtemp(join(tmpdir(), "acai-skill-print-"));

		try {
			const result = await runCliSubprocess(["skill"], {}, { cwd: root });

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe(getCanonicalSkillContent());
			expect(result.stderr).toBe("");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("skill.WRITE.1 skill.WRITE.2 skill.WRITE.3 skill.SAFETY.3 installs and overwrites the canonical skill file in an isolated workspace", async () => {
		const root = await mkdtemp(join(tmpdir(), "acai-skill-install-"));
		const destination = join(root, ".agents", "skills", "acai", "SKILL.md");

		try {
			await mkdir(join(root, ".agents", "skills", "acai"), {
				recursive: true,
			});
			await writeFile(destination, "stale content");

			const result = await runCliSubprocess(
				["skill", "--install"],
				{},
				{ cwd: root },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
			expect(await readFile(destination, "utf8")).toBe(
				getCanonicalSkillContent(),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("skill.SAFETY.1 skill.SAFETY.2 skill.SAFETY.3 cli-core.UX.1 cli-core.UX.2 works without ACAI_API_TOKEN in a temp workspace", async () => {
		const root = await mkdtemp(join(tmpdir(), "acai-skill-parity-e2e-"));
		const destination = join(root, ".agents", "skills", "acai", "SKILL.md");

		try {
			const printResult = await runCliSubprocess(["skill"], {}, { cwd: root });
			const installResult = await runCliSubprocess(
				["skill", "--install"],
				{},
				{ cwd: root },
			);

			expect(printResult.exitCode).toBe(0);
			expect(installResult.exitCode).toBe(0);
			expect(printResult.stdout).toBe(await readFile(destination, "utf8"));
			expect(printResult.stderr).toBe("");
			expect(installResult.stdout).toBe("");
			expect(installResult.stderr).toBe("");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("skill.MAIN.1 cli-core.ERRORS.4 returns exit code 2 for unknown skill options", async () => {
		const result = await runCliSubprocess(["skill", "--unknown-option"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown option");
		expect(result.stderr).toContain("Usage: acai skill");
	});
});

describe("feature.MAIN.1 feature.MAIN.2 feature.MAIN.3 feature.MAIN.4 feature.MAIN.5 feature.MAIN.6 feature.API.1 feature.API.2 feature.API.3 feature.UX.1 feature.UX.2", () => {
	test("feature.API.1 feature.API.2 feature.API.3 feature.UX.1 prints text output for a direct target with refs, statuses, and warnings", async () => {
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
								status_counts: {
									incomplete: 1,
									completed: 1,
								} as never,
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
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
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

	test("feature.MAIN.2 cli-core.TARGETING.2 cli-core.TARGETING.3 resolves exactly one implementation from git context", async () => {
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
		});
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);

			if (url.pathname === "/implementations") {
				return Response.json(
					buildImplementationsResponse({
						data: {
							implementations: [
								{
									implementation_id: "impl-1",
									implementation_name: "main",
								},
							],
						},
					}),
				);
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
				{
					...git.env,
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
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
					buildFeatureContextResponse({
						data: { implementation_name: "preview" },
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["feature", "feature", "--impl", "example-product/preview"],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(result.stdout).toContain(
				"example-product/preview feature=feature",
			);
		} finally {
			server.stop();
		}
	});

	test("feature.MAIN.6 cli-core.OUTPUT.1 cli-core.OUTPUT.2 keeps json payload on stdout and warnings on stderr", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/feature-context") {
				return Response.json(
					buildFeatureContextResponse({
						data: { warnings: ["warning one"] },
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
					"--json",
				],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("warning one");
			expect(JSON.parse(result.stdout).data.feature_name).toBe("feature");
		} finally {
			server.stop();
		}
	});

	test("feature.MAIN.2 and cli-core.ERRORS.4 reject unknown feature options", async () => {
		const result = await runCliSubprocess([
			"feature",
			"feature",
			"--product",
			"example-product",
			"--unknown-option",
		]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown option");
		expect(result.stderr).toContain("Usage: acai feature");
	});

	test("cli-core.HTTP.2 cli-core.HTTP.3 and cli-core.HTTP.1 surface feature API failures", async () => {
		const authServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/feature-context") {
				return Response.json(
					{ errors: { detail: "unauthorized" } },
					{ status: 401 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const authResult = await runCliSubprocess(
				[
					"feature",
					"feature",
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: authServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(authResult.exitCode).toBe(1);
			expect(authResult.stderr).toContain("unauthorized");
		} finally {
			authServer.stop();
		}

		const validationServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/feature-context") {
				return Response.json(
					{ errors: { detail: "validation failed" } },
					{ status: 422 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const validationResult = await runCliSubprocess(
				[
					"feature",
					"feature",
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: validationServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(validationResult.exitCode).toBe(1);
			expect(validationResult.stderr).toContain("validation failed");
		} finally {
			validationServer.stop();
		}

		const notFoundServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/feature-context") {
				return Response.json(
					{ errors: { detail: "not found" } },
					{ status: 404 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const notFoundResult = await runCliSubprocess(
				[
					"feature",
					"feature",
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: notFoundServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(notFoundResult.exitCode).toBe(1);
			expect(notFoundResult.stderr).toContain("not found");
		} finally {
			notFoundServer.stop();
		}

		const networkResult = await runCliSubprocess(
			["feature", "feature", "--product", "example-product", "--impl", "main"],
			{
				ACAI_API_BASE_URL: "http://127.0.0.1:65535",
				ACAI_API_TOKEN: "secret",
			},
		);

		expect(networkResult.exitCode).toBe(1);
		expect(networkResult.stderr).toContain("API request failed.");
	});
});

describe("set-status.MAIN.1 set-status.MAIN.2 set-status.MAIN.3 set-status.MAIN.4 set-status.MAIN.5 set-status.MAIN.6 set-status.API.1 set-status.API.2 set-status.API.3 set-status.UX.1 set-status.UX.2", () => {
	test("set-status.API.1 set-status.API.2 writes inline JSON input for explicit --product and --impl", async () => {
		const server = createMockApiServer(async (request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				expect(await request.json()).toEqual({
					product_name: "example-product",
					implementation_name: "main",
					feature_name: "set-status",
					states: {
						"set-status.MAIN.1": {
							status: "completed",
							comment: "done",
						},
					},
				});

				return Response.json(
					buildFeatureStatesResponse({
						data: { warnings: ["careful"] },
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed","comment":"done"}}',
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(result.stdout.trim().split("\n")).toEqual([
				"example-product/main feature=set-status",
				"states_written=2",
				"warning: careful",
			]);
		} finally {
			server.stop();
		}
	});

	test("set-status.MAIN.2 reads @file input", async () => {
		const repo = await createPushRepo({
			"states.json": '{"set-status.MAIN.1":{"status":"completed"}}',
		});
		const server = createMockApiServer(async (request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				expect(await request.json()).toMatchObject({
					feature_name: "set-status",
					states: { "set-status.MAIN.1": { status: "completed" } },
				});
				return Response.json(buildFeatureStatesResponse());
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				[
					"set-status",
					"@states.json",
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
				{ cwd: repo.root },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("states_written=2");
		} finally {
			server.stop();
			await repo.cleanup();
		}
	});

	test("set-status.MAIN.3 reads stdin input from -", async () => {
		const server = createMockApiServer(async (request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				expect(await request.json()).toMatchObject({
					feature_name: "set-status",
					states: { "set-status.INPUT.1": { status: null } },
				});
				return Response.json(
					buildFeatureStatesResponse({ data: { states_written: 1 } }),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["set-status", "-", "--product", "example-product", "--impl", "main"],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
				{ input: '{"set-status.INPUT.1":{"status":null}}' },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("states_written=1");
		} finally {
			server.stop();
		}
	});

	test("set-status.MAIN.4 resolves product from namespaced --impl without --product", async () => {
		const server = createMockApiServer(async (request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				expect(await request.json()).toMatchObject({
					product_name: "example-product",
					implementation_name: "preview",
				});
				return Response.json(
					buildFeatureStatesResponse({
						data: { implementation_name: "preview" },
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--impl",
					"example-product/preview",
				],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"example-product/preview feature=set-status",
			);
		} finally {
			server.stop();
		}
	});

	test("cli-core.TARGETING.2 cli-core.TARGETING.3 resolves git-derived implementations when --impl is omitted", async () => {
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
		});
		const server = createMockApiServer(async (request) => {
			const url = new URL(request.url);

			if (url.pathname === "/implementations") {
				return Response.json(
					buildImplementationsResponse({
						data: {
							implementations: [
								{
									implementation_id: "impl-1",
									implementation_name: "main",
								},
							],
						},
					}),
				);
			}

			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				expect(await request.json()).toMatchObject({
					implementation_name: "main",
				});
				return Response.json(buildFeatureStatesResponse());
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--product",
					"example-product",
				],
				{
					...git.env,
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"example-product/main feature=set-status",
			);
		} finally {
			server.stop();
			await git.cleanup();
		}
	});

	test("cli-core.TARGETING.4 cli-core.TARGETING.5 and set-status.SAFETY.2 fail on ambiguous or missing git-derived targets", async () => {
		const ambiguousGit = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
		});
		const ambiguousServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementations") {
				return Response.json(
					buildImplementationsResponse({
						data: {
							implementations: [
								{
									implementation_id: "impl-1",
									implementation_name: "main",
								},
								{
									implementation_id: "impl-2",
									implementation_name: "preview",
								},
							],
						},
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const ambiguousResult = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--product",
					"example-product",
				],
				{
					...ambiguousGit.env,
					ACAI_API_BASE_URL: ambiguousServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(ambiguousResult.exitCode).toBe(1);
			expect(ambiguousResult.stderr).toContain(
				"Multiple implementations matched",
			);
		} finally {
			ambiguousServer.stop();
			await ambiguousGit.cleanup();
		}

		const missingGit = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
		});
		const missingServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementations") {
				return Response.json(
					buildImplementationsResponse({
						data: { implementations: [] },
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const missingResult = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--product",
					"example-product",
				],
				{
					...missingGit.env,
					ACAI_API_BASE_URL: missingServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(missingResult.exitCode).toBe(1);
			expect(missingResult.stderr).toContain(
				"No implementation matched the current repo, branch, and product. This branch may not have been pushed yet. Try: acai push --all",
			);
		} finally {
			missingServer.stop();
			await missingGit.cleanup();
		}
	});

	test("set-status.MAIN.6 cli-core.OUTPUT.1 cli-core.OUTPUT.2 keeps --json payload on stdout and warnings on stderr", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				return Response.json(
					buildFeatureStatesResponse({
						data: { warnings: ["warning one"] },
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--product",
					"example-product",
					"--impl",
					"main",
					"--json",
				],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("warning one");
			expect(JSON.parse(result.stdout).data.feature_name).toBe("set-status");
		} finally {
			server.stop();
		}
	});

	test("cli-core.HELP.3 cli-core.HELP.5 keep set-status --help and -h in sync", async () => {
		const help = await runCliSubprocess(["set-status", "--help"]);
		const shortHelp = await runCliSubprocess(["set-status", "-h"]);

		expect(help.exitCode).toBe(0);
		expect(shortHelp.exitCode).toBe(0);
		expect(help.stdout).toBe(shortHelp.stdout);
		expect(help.stdout).toContain("Usage: acai set-status <json> [options]");
	});

	test("cli-core.ERRORS.4 rejects unknown set-status options", async () => {
		const result = await runCliSubprocess([
			"set-status",
			'{"set-status.MAIN.1":{"status":"completed"}}',
			"--product",
			"example-product",
			"--unknown-option",
		]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown option");
		expect(result.stderr).toContain("Usage: acai set-status");
	});

	test("cli-core.HTTP.1 cli-core.HTTP.2 cli-core.HTTP.3 and set-status.INPUT.5 surface API and input failures", async () => {
		const inputResult = await runCliSubprocess([
			"set-status",
			"{",
			"--product",
			"example-product",
			"--impl",
			"main",
		]);
		expect(inputResult.exitCode).toBe(2);
		expect(inputResult.stderr).toContain("Invalid JSON payload.");

		const authServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				return Response.json(
					{ errors: { detail: "unauthorized" } },
					{ status: 401 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const authResult = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: authServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);
			expect(authResult.exitCode).toBe(1);
			expect(authResult.stderr).toContain("unauthorized");
		} finally {
			authServer.stop();
		}

		const validationServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				return Response.json(
					{ errors: { detail: "validation failed" } },
					{ status: 422 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const validationResult = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: validationServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);
			expect(validationResult.exitCode).toBe(1);
			expect(validationResult.stderr).toContain("validation failed");
		} finally {
			validationServer.stop();
		}

		const notFoundServer = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				return Response.json(
					{ errors: { detail: "not found" } },
					{ status: 404 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const notFoundResult = await runCliSubprocess(
				[
					"set-status",
					'{"set-status.MAIN.1":{"status":"completed"}}',
					"--product",
					"example-product",
					"--impl",
					"main",
				],
				{
					ACAI_API_BASE_URL: notFoundServer.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);
			expect(notFoundResult.exitCode).toBe(1);
			expect(notFoundResult.stderr).toContain("not found");
		} finally {
			notFoundServer.stop();
		}

		const networkResult = await runCliSubprocess(
			[
				"set-status",
				'{"set-status.MAIN.1":{"status":"completed"}}',
				"--product",
				"example-product",
				"--impl",
				"main",
			],
			{
				ACAI_API_BASE_URL: "http://127.0.0.1:65535",
				ACAI_API_TOKEN: "secret",
			},
		);
		expect(networkResult.exitCode).toBe(1);
		expect(networkResult.stderr).toContain("API request failed.");
	});
});

describe("cli-core.EXITS.1 cli-core.EXITS.2 cli-core.EXITS.3 cli-core.UX.1 cli-core.UX.2", () => {
	test("features.MAIN.1 features.MAIN.3 features.MAIN.4 features.MAIN.5 features.MAIN.7 features.MAIN.8 features.API.1 features.UX.1 prints text output for a direct target", async () => {
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
								buildImplementationFeatureEntry({
									feature_name: "feature-a",
									completed_count: 2,
									total_count: 4,
									refs_count: 3,
								}),
								buildImplementationFeatureEntry({
									feature_name: "feature-b",
									completed_count: 1,
									total_count: 2,
									refs_count: 1,
								}),
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

	test("features.MAIN.2 features.MAIN.3 features.API.1 features.API.2 resolves exactly one implementation from git context", async () => {
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
		});
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);

			if (url.pathname === "/implementations") {
				expect(url.searchParams.get("product_name")).toBe("example-product");
				expect(url.searchParams.get("repo_uri")).toBe(
					"github.com/my-org/my-repo",
				);
				expect(url.searchParams.get("branch_name")).toBe("main");

				return Response.json(
					buildImplementationsResponse({
						data: {
							implementations: [
								{
									implementation_id: "impl-1",
									implementation_name: "main",
								},
							],
						},
					}),
				);
			}

			if (url.pathname === "/implementation-features") {
				expect(url.searchParams.get("implementation_name")).toBe("main");

				return Response.json(
					buildImplementationFeaturesResponse({
						data: {
							features: [
								buildImplementationFeatureEntry({
									feature_name: "feature-a",
									completed_count: 3,
									total_count: 5,
									refs_count: 2,
								}),
							],
						},
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["features", "--product", "example-product"],
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
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
		});
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementations") {
				return Response.json(
					buildImplementationsResponse({
						data: {
							implementations: [
								{
									implementation_id: "impl-1",
									implementation_name: "main",
								},
								{
									implementation_id: "impl-2",
									implementation_name: "preview",
								},
							],
						},
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["features", "--product", "example-product"],
				{
					...git.env,
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"Multiple implementations matched the current repo, branch, and product",
			);
			expect(result.stderr).toContain("main, preview");
		} finally {
			server.stop();
			await git.cleanup();
		}
	});

	test("cli-core.TARGETING.5 exits non-zero when no branch target matches", async () => {
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
		});
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementations") {
				return Response.json(
					buildImplementationsResponse({
						data: { implementations: [] },
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["features", "--product", "example-product"],
				{
					...git.env,
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"No implementation matched the current repo, branch, and product. This branch may not have been pushed yet. Try: acai push --all",
			);
		} finally {
			server.stop();
			await git.cleanup();
		}
	});

	test("cli-core.ERRORS.2 exits non-zero when git context cannot be determined", async () => {
		const git = await createFakeGitContext({ remoteExitCode: 1 });
		const result = await runCliSubprocess(
			["features", "--product", "example-product"],
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
			["features", "--product", "example-product", "--impl", "main"],
			{ ACAI_API_TOKEN: "" },
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("Missing API bearer token configuration.");
		expect(result.stderr).toContain("Usage: acai features");
	});

	test("features.MAIN.2 and cli-core.EXITS.2 require a product selector", async () => {
		const result = await runCliSubprocess(["features", "--impl", "main"], {
			ACAI_API_BASE_URL: "https://api.example.test",
			ACAI_API_TOKEN: "secret",
		});

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(
			"required option '--product <name>' not specified",
		);
		expect(result.stderr).toContain("Usage: acai features");
	});

	test("cli-core.TARGETING.1 still reports a missing product selector when API env is absent", async () => {
		const result = await runCliSubprocess(["features", "--impl", "main"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(
			"required option '--product <name>' not specified",
		);
		expect(result.stderr).toContain("Usage: acai features");
	});

	test("cli-core.ERRORS.3 exits non-zero for unknown commands", async () => {
		const result = await runCliSubprocess(["bogus"]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown command");
		expect(result.stderr).toContain("Usage: acai");
	});

	test("cli-core.ERRORS.4 exits non-zero for unknown work options", async () => {
		const result = await runCliSubprocess([
			"features",
			"--product",
			"example-product",
			"--unknown-option",
		]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("unknown option");
		expect(result.stderr).toContain("Usage: acai features");
	});

	test("cli-core.HTTP.2 surfaces API auth failures", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementation-features") {
				return Response.json(
					{ errors: { detail: "unauthorized" } },
					{ status: 401 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["features", "--product", "example-product", "--impl", "main"],
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
				return Response.json(
					{ errors: { detail: "validation failed" } },
					{ status: 422 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["features", "--product", "example-product", "--impl", "main"],
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
				return Response.json(
					{ errors: { detail: "not found" } },
					{ status: 404 },
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["features", "--product", "example-product", "--impl", "main"],
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
		const result = await runCliSubprocess(
			["features", "--product", "example-product", "--impl", "main"],
			{
				ACAI_API_BASE_URL: "http://127.0.0.1:65535",
				ACAI_API_TOKEN: "secret",
			},
		);

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
							features: [
								buildImplementationFeatureEntry({
									feature_name: "feature-a",
								}),
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
					"--json",
				],
				{
					ACAI_API_BASE_URL: server.url.toString(),
					ACAI_API_TOKEN: "secret",
				},
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(JSON.parse(result.stdout).data.features[0].feature_name).toBe(
				"feature-a",
			);
		} finally {
			server.stop();
		}
	});

	test("features.UX.4 exits successfully when no features are returned", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementation-features") {
				return Response.json(
					buildImplementationFeaturesResponse({
						data: { features: [] },
					}),
				);
			}

			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["features", "--product", "example-product", "--impl", "main"],
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
			return request
				.clone()
				.json()
				.then((body) => {
					const payload = body as { product_name?: string };
					return Response.json({
						data: {
							product_name: payload.product_name,
							implementation_name:
								payload.product_name === "product-b" ? "preview" : "main",
							specs_created: 1,
							specs_updated: 0,
							warnings:
								payload.product_name === "product-a" ? ["alpha warning"] : [],
						},
					});
				});
		});

		try {
			const result = await runCliSubprocess(["push", "--all"], {
				...git.env,
				ACAI_API_BASE_URL: server.url.toString(),
				ACAI_API_TOKEN: "secret",
			});

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

			return request
				.clone()
				.json()
				.then((body) => {
					const payload = body as { product_name?: string };
					if (payload.product_name !== "product-a") {
						return Response.json(
							{ errors: { detail: "unexpected product" } },
							{ status: 422 },
						);
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
			const result = await runCliSubprocess(["push", "alpha"], {
				...git.env,
				ACAI_API_BASE_URL: server.url.toString(),
				ACAI_API_TOKEN: "secret",
			});

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

	test("push.SCAN.3 push.SAFETY.2 uses HEAD for a new untracked spec with no file-specific history", async () => {
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
				"features/alpha.feature.yaml": "",
			},
		});

		const requests: any[] = [];
		const server = createMockApiServer(async (request) => {
			requests.push(await request.clone().json());
			return Response.json({
				data: {
					product_name: requests[requests.length - 1].product_name,
					implementation_name: "main",
					specs_created: 1,
					specs_updated: 0,
					warnings: [],
				},
			});
		});

		try {
			const result = await runCliSubprocess(["push", "--all"], {
				...git.env,
				ACAI_API_BASE_URL: server.url.toString(),
				ACAI_API_TOKEN: "secret",
			});

			expect(result.exitCode).toBe(0);
			expect(requests).toHaveLength(1);
			expect(requests[0]?.specs).toEqual([
				{
					feature: {
						name: "alpha",
						product: "product-a",
						version: "1.0.0",
					},
					meta: {
						last_seen_commit: "c0ffee0000000000000000000000000000000000",
						path: "features/alpha.feature.yaml",
					},
					requirements: {
						"alpha.MAIN.1": {
							requirement: "Alpha requirement",
							deprecated: false,
						},
					},
				},
			]);
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
					implementation_name:
						requests[requests.length - 1].target_impl_name ??
						requests[requests.length - 1].parent_impl_name ??
						"main",
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
			const productA = requests.find(
				(entry) => entry.product_name === "product-a",
			);
			const productB = requests.find(
				(entry) => entry.product_name === "product-b",
			);
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
			const result = await runCliSubprocess(["push"], {
				...git.env,
				ACAI_API_BASE_URL: server.url.toString(),
				ACAI_API_TOKEN: "secret",
			});

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
			return request
				.clone()
				.json()
				.then((body) => {
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
						: Response.json(
								{ errors: { detail: "beta failed" } },
								{ status: 422 },
							);
				});
		});

		try {
			const result = await runCliSubprocess(["push"], {
				...git.env,
				ACAI_API_BASE_URL: server.url.toString(),
				ACAI_API_TOKEN: "secret",
			});

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
			const result = await runCliSubprocess(["push", "--json"], {
				...git.env,
				ACAI_API_BASE_URL: server.url.toString(),
				ACAI_API_TOKEN: "secret",
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toContain('"results"');
			expect(JSON.parse(result.stdout).results[0].warnings).toEqual([
				"json warning",
			]);
			expect(result.stderr).toContain("Warning for product-a: json warning");
		} finally {
			server.stop();
			await git.cleanup();
			await repo.cleanup();
		}
	});

	test("cli-core.EXITS.2 rejects missing values followed by another flag", async () => {
		const result = await runCliSubprocess(
			[
				"features",
				"--product",
				"example-product",
				"--changed-since-commit",
				"--json",
			],
			{
				ACAI_API_BASE_URL: "https://api.example.test",
				ACAI_API_TOKEN: "secret",
			},
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(
			"Missing value for --changed-since-commit.",
		);
		expect(result.stderr).toContain("Usage: acai features");
	});
});
