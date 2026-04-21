import { describe, expect, test } from "bun:test";
import { createFakeGitContext } from "../test/support/fake-git.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";
import { runCliSubprocess } from "../test/support/cli.ts";
import { apiEnv, createTempWorkspace } from "../test/support/e2e.ts";

describe("push command", () => {
	test("push.API.1 push.OUTPUT.3-1 prints one block per product for a full repo push", async () => {
		const workspace = await createTempWorkspace(
			{
				"features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n",
				"features/beta.feature.yaml": "feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n",
				"src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n',
				"src/beta.ts": 'const beta = "beta.MAIN.1";\n',
			},
			"acai-push-full-",
		);
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
			topLevel: workspace.root,
			head: "c0ffee0000000000000000000000000000000000",
			fileCommits: {
				"features/alpha.feature.yaml": "a1",
				"features/beta.feature.yaml": "b1",
			},
		});
		const server = createMockApiServer((request) =>
			request.clone().json().then((body) => {
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
			}),
		);

		try {
			const result = await runCliSubprocess(["push", "--all"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(result.stdout).toContain("REPO:");
			expect(result.stdout).toContain("PRODUCT");
			expect(result.stdout).toContain("product-a");
			expect(result.stdout).toContain("main");
			expect(result.stdout).toContain("preview");
			expect(result.stdout).toContain("WARNINGS");
			expect(result.stdout).toContain("alpha warning");
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});

	test("push.MAIN.2 push.API.3 push.UX.3 filters the scan to named features", async () => {
		const workspace = await createTempWorkspace(
			{
				"features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n",
				"features/beta.feature.yaml": "feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n",
				"src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n',
				"src/beta.ts": 'const beta = "beta.MAIN.1";\n',
			},
			"acai-push-filter-",
		);
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
			topLevel: workspace.root,
			head: "c0ffee0000000000000000000000000000000000",
			fileCommits: {
				"features/alpha.feature.yaml": "a1",
				"features/beta.feature.yaml": "b1",
			},
		});
		const server = createMockApiServer((request) =>
			request.clone().json().then((body) => {
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
			}),
		);

		try {
			const result = await runCliSubprocess(["push", "alpha"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("product-a");
			expect(result.stdout).not.toContain("product-b");
			expect(server.requests).toHaveLength(1);
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});

	test("push.SCAN.3 push.SAFETY.2 uses HEAD for a new untracked spec with no file-specific history", async () => {
		const workspace = await createTempWorkspace(
			{
				"features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n",
				"src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n',
			},
			"acai-push-head-",
		);
		const git = await createFakeGitContext({
			remote: "git@github.com:my-org/my-repo.git",
			branch: "main",
			topLevel: workspace.root,
			head: "c0ffee0000000000000000000000000000000000",
			fileCommits: { "features/alpha.feature.yaml": "" },
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
			const result = await runCliSubprocess(["push", "--all"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(0);
			expect(requests).toHaveLength(1);
			expect(requests[0]?.specs[0]?.meta?.last_seen_commit).toBe("c0ffee0000000000000000000000000000000000");
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});

	test("push.SCAN.5 push.SCAN.5-1 preserve component deprecation with requirement-level override in the push payload", async () => {
		const workspace = await createTempWorkspace(
			{
				"features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  AUTH:\n    deprecated: true\n    requirements:\n      1: inherited deprecation\n      2:\n        requirement: local override\n        deprecated: false\n",
			},
			"acai-push-deprecated-",
		);
		const git = await createFakeGitContext({
			topLevel: workspace.root,
			fileCommits: { "features/alpha.feature.yaml": "a1" },
		});
		const requests: any[] = [];
		const server = createMockApiServer(async (request) => {
			requests.push(await request.clone().json());
			return Response.json({ data: { product_name: "product-a", implementation_name: "main", specs_created: 1, specs_updated: 0, warnings: [] } });
		});

		try {
			const result = await runCliSubprocess(["push", "--all"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(0);
			expect(requests[0]?.specs[0]?.requirements).toEqual({
				"alpha.AUTH.1": { requirement: "inherited deprecation", deprecated: true },
				"alpha.AUTH.2": { requirement: "local override", deprecated: false },
			});
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});

	test("push.MAIN.5 push.API.2 splits namespaced target and parent selectors by product", async () => {
		const workspace = await createTempWorkspace(
			{
				"features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n",
				"features/beta.feature.yaml": "feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n",
				"src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n',
				"src/beta.ts": 'const beta = "beta.MAIN.1";\n',
			},
			"acai-push-scope-",
		);
		const git = await createFakeGitContext({
			topLevel: workspace.root,
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
			const result = await runCliSubprocess(["push", "--target", "product-a/child", "--parent", "product-b/base"], apiEnv(server, git.env));
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
			await workspace.cleanup();
		}
	});

	test("push.API.6 push.SAFETY.4 pushes refs-only payloads without --product", async () => {
		const workspace = await createTempWorkspace({ "src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n' }, "acai-push-refs-only-");
		const git = await createFakeGitContext({ topLevel: workspace.root });
		const requests: any[] = [];
		const server = createMockApiServer(async (request) => {
			requests.push(await request.clone().json());
			return Response.json({ data: { implementation_name: null, product_name: null, specs_created: 0, specs_updated: 0, warnings: [] } });
		});

		try {
			const result = await runCliSubprocess(["push"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("");
			expect(requests).toHaveLength(1);
			expect(requests[0]?.product_name).toBeUndefined();
			expect(requests[0]?.references).toEqual({ data: { "alpha.MAIN.1": [{ path: "src/alpha.ts:1", is_test: false }] }, override: false });
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});

	test("push.API.5 push.SAFETY.5 only sends refs-only child creation selectors when --product, --target, and --parent are all provided", async () => {
		const workspace = await createTempWorkspace({ "src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n' }, "acai-push-child-refs-");
		const git = await createFakeGitContext({ topLevel: workspace.root });
		const requests: any[] = [];
		const server = createMockApiServer(async (request) => {
			requests.push(await request.clone().json());
			return Response.json({ data: { product_name: requests[requests.length - 1].product_name ?? null, implementation_name: "child", specs_created: 0, specs_updated: 0, warnings: [] } });
		});

		try {
			const failingResult = await runCliSubprocess(["push", "--product", "product-a", "--target", "product-a/child"], apiEnv(server, git.env));
			expect(failingResult.exitCode).toBe(2);
			expect(failingResult.stderr).toContain("Refs-only pushes require --product, --target, and --parent together.");
			expect(requests).toHaveLength(0);

			const successResult = await runCliSubprocess(["push", "--product", "product-a", "--target", "product-a/child", "--parent", "product-a/base"], apiEnv(server, git.env));
			expect(successResult.exitCode).toBe(0);
			expect(requests).toHaveLength(1);
			expect(requests[0]?.product_name).toBe("product-a");
			expect(requests[0]?.target_impl_name).toBe("child");
			expect(requests[0]?.parent_impl_name).toBe("base");
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});

	test("push.API.4 push.SAFETY.3 exits non-zero when one product fails and another succeeds", async () => {
		const workspace = await createTempWorkspace(
			{
				"features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n",
				"features/beta.feature.yaml": "feature:\n  name: beta\n  product: product-b\ncomponents:\n  MAIN:\n    requirements:\n      1: Beta requirement\n",
				"src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n',
				"src/beta.ts": 'const beta = "beta.MAIN.1";\n',
			},
			"acai-push-partial-fail-",
		);
		const git = await createFakeGitContext({
			topLevel: workspace.root,
			fileCommits: {
				"features/alpha.feature.yaml": "a1",
				"features/beta.feature.yaml": "b1",
			},
		});
		const server = createMockApiServer((request) =>
			request.clone().json().then((body) => {
				const payload = body as { product_name?: string };
				return payload.product_name === "product-a"
					? Response.json({ data: { product_name: "product-a", implementation_name: "main", specs_created: 1, specs_updated: 0, warnings: [] } })
					: Response.json({ errors: { detail: "beta failed" } }, { status: 422 });
			}),
		);

		try {
			const result = await runCliSubprocess(["push"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(1);
			expect(result.stdout).toContain("product-a");
			expect(result.stdout).toContain("product-b");
			expect(result.stdout).toContain("failed");
			expect(result.stdout).toContain("beta failed");
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});

	test("push.OUTPUT.5 cli-core.OUTPUT.1 cli-core.OUTPUT.2 emits JSON payloads on stdout", async () => {
		const workspace = await createTempWorkspace(
			{
				"features/alpha.feature.yaml": "feature:\n  name: alpha\n  product: product-a\ncomponents:\n  MAIN:\n    requirements:\n      1: Alpha requirement\n",
				"src/alpha.ts": 'const alpha = "alpha.MAIN.1";\n',
			},
			"acai-push-json-",
		);
		const git = await createFakeGitContext({ topLevel: workspace.root, fileCommits: { "features/alpha.feature.yaml": "a1" } });
		const server = createMockApiServer(() =>
			Response.json({ data: { product_name: "product-a", implementation_name: "main", specs_created: 1, specs_updated: 0, warnings: ["json warning"] } }),
		);

		try {
			const result = await runCliSubprocess(["push", "--json"], apiEnv(server, git.env));
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout).results[0].warnings).toEqual(["json warning"]);
			expect(result.stderr).toContain("Warning for product-a: json warning");
		} finally {
			server.stop();
			await git.cleanup();
			await workspace.cleanup();
		}
	});
});
