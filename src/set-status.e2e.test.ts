import { describe, expect, test } from "bun:test";
import { buildFeatureStatesResponse, buildImplementationsResponse } from "../test/support/fixtures.ts";
import { createFakeGitContext } from "../test/support/fake-git.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { runCliSubprocess } from "../test/support/cli.ts";
import { apiEnv, createTempWorkspace, expectUsageError } from "../test/support/e2e.ts";

const VALID_SET_STATUS_JSON = '{"set-status.MAIN.1":{"status":"completed"}}';

describe("set-status command", () => {
	test("set-status.API.1 writes inline JSON input for explicit --product and --impl", async () => {
		const server = createMockApiServer(async (request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				expect(await request.json()).toEqual({
					product_name: "example-product",
					implementation_name: "main",
					feature_name: "set-status",
					states: { "set-status.MAIN.1": { status: "completed", comment: "done" } },
				});
				return Response.json(buildFeatureStatesResponse({ data: { warnings: ["careful"] } }));
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
				apiEnv(server),
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
				expect(result.stdout).toContain("PRODUCT");
				expect(result.stdout).toContain("set-status");
				expect(result.stdout).toContain("WARNINGS");
				expect(result.stdout).toContain("careful");
			} finally {
			server.stop();
		}
	});

	test("set-status.MAIN.2 reads @file input", async () => {
		const workspace = await createTempWorkspace({ "states.json": VALID_SET_STATUS_JSON }, "acai-set-status-file-");
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
				["set-status", "@states.json", "--product", "example-product", "--impl", "main"],
				apiEnv(server),
				{ cwd: workspace.root },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("STATES_WRITTEN");
			expect(result.stdout).toContain("set-status");
		} finally {
			server.stop();
			await workspace.cleanup();
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
				return Response.json(buildFeatureStatesResponse({ data: { states_written: 1 } }));
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["set-status", "-", "--product", "example-product", "--impl", "main"],
				apiEnv(server),
				{ input: '{"set-status.INPUT.1":{"status":null}}' },
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("STATES_WRITTEN");
			expect(result.stdout).toContain("  1");
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
				return Response.json(buildFeatureStatesResponse({ data: { implementation_name: "preview" } }));
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["set-status", VALID_SET_STATUS_JSON, "--impl", "example-product/preview"],
				apiEnv(server),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("preview");
			expect(result.stdout).toContain("set-status");
		} finally {
			server.stop();
		}
	});

	test("cli-core.TARGETING.2 cli-core.TARGETING.3 resolve git-derived implementations when --impl is omitted", async () => {
		const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
		const server = createMockApiServer(async (request) => {
			const url = new URL(request.url);
			if (url.pathname === "/implementations") {
				return Response.json(buildImplementationsResponse());
			}
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				expect(await request.json()).toMatchObject({ implementation_name: "main" });
				return Response.json(buildFeatureStatesResponse());
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["set-status", VALID_SET_STATUS_JSON, "--product", "example-product"],
				apiEnv(server, git.env),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("main");
			expect(result.stdout).toContain("set-status");
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
			"Multiple implementations matched",
		],
		[
			"set-status.SAFETY.2",
			[],
			"No implementation matched the current repo, branch, and filters. This branch may not be tracked yet. Try `acai push` from this branch, or pass `--product` and `--impl` for a known implementation.",
		],
	] as const) {
		test(`${acid} fails for unsupported git-derived target resolution`, async () => {
			const git = await createFakeGitContext({ remote: "git@github.com:my-org/my-repo.git", branch: "main" });
			const server = createMockApiServer((request) => {
				const url = new URL(request.url);
				if (url.pathname === "/implementations") {
					return Response.json(buildImplementationsResponse({ data: { implementations } }));
				}
				return new Response("not found", { status: 404 });
			});

			try {
				const result = await runCliSubprocess(
					["set-status", VALID_SET_STATUS_JSON, "--product", "example-product"],
					apiEnv(server, git.env),
				);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(message);
			} finally {
				server.stop();
				await git.cleanup();
			}
		});
	}

	test("set-status.MAIN.6 keeps --json payload on stdout and warnings on stderr", async () => {
		const server = createMockApiServer((request) => {
			const url = new URL(request.url);
			if (request.method === "PATCH" && url.pathname === "/feature-states") {
				return Response.json(buildFeatureStatesResponse({ data: { warnings: ["warning one"] } }));
			}
			return new Response("not found", { status: 404 });
		});

		try {
			const result = await runCliSubprocess(
				["set-status", VALID_SET_STATUS_JSON, "--product", "example-product", "--impl", "main", "--json"],
				apiEnv(server),
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
		const result = await runCliSubprocess(["set-status", VALID_SET_STATUS_JSON, "--product", "example-product", "--unknown-option"]);
		expectUsageError(result, "Usage: acai set-status", "unknown option");
	});

	test("set-status.INPUT.5 rejects invalid payloads before any API call", async () => {
		const server = createMockApiServer(() => new Response("unexpected", { status: 500 }));
		try {
			for (const [payload, message] of [
				["{", "Invalid JSON payload."],
				['{"not-an-acid":{"status":"completed"}}', "Malformed ACID: not-an-acid"],
				['{"set-status.MAIN.1":{"status":"completed"},"feature.MAIN.1":{"status":"accepted"}}', "All ACIDs in one payload must share the same feature prefix."],
				['{"set-status.MAIN.1":{"status":"todo"}}', "Invalid status for set-status.MAIN.1: todo"],
			] as const) {
				const result = await runCliSubprocess(
					["set-status", payload, "--product", "example-product", "--impl", "main"],
					apiEnv(server),
				);
				expectUsageError(result, "Usage: acai set-status", message);
			}
			expect(server.requests).toHaveLength(0);
		} finally {
			server.stop();
		}
	});

	for (const [acid, detail, status] of [
		["cli-core.HTTP.2", "unauthorized", 401],
		["cli-core.HTTP.3", "validation failed", 422],
		["cli-core.HTTP.3", "not found", 404],
	] as const) {
		test(`${acid} surfaces set-status API failure: ${detail}`, async () => {
			const server = createMockApiServer((request) => {
				const url = new URL(request.url);
				if (request.method === "PATCH" && url.pathname === "/feature-states") {
					return Response.json({ errors: { detail } }, { status });
				}
				return new Response("not found", { status: 404 });
			});

			try {
				const result = await runCliSubprocess(
					["set-status", VALID_SET_STATUS_JSON, "--product", "example-product", "--impl", "main"],
					apiEnv(server),
				);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(detail);
			} finally {
				server.stop();
			}
		});
	}

	test("cli-core.HTTP.1 surfaces set-status network failures", async () => {
		const result = await runCliSubprocess(
			["set-status", VALID_SET_STATUS_JSON, "--product", "example-product", "--impl", "main"],
			{ ACAI_API_BASE_URL: "http://127.0.0.1:65535", ACAI_API_TOKEN: "secret" },
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("API request failed.");
	});
});
