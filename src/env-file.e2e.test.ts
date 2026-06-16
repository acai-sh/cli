import { describe, expect, test } from "bun:test";
import { createTempWorkspace } from "../test/support/e2e.ts";

const workspaceRoot = import.meta.dir + "/..";

function stripEnv(keys: string[]): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined && !keys.includes(k)) {
			env[k] = v;
		}
	}
	return env;
}

async function runCliInDir(
	cwd: string,
	args: string[],
	env: Record<string, string>,
) {
	const proc = Bun.spawn(
		["bun", workspaceRoot + "/src/index.ts", ...args],
		{ cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout, stderr };
}

describe("env-file loading", () => {
	test("cli-core.AUTH.2 loads ACAI_API_TOKEN from .env when not set in the process environment", async () => {
		const workspace = await createTempWorkspace({
			".env": "ACAI_API_TOKEN=secret-from-dotenv\n",
		});

		try {
			const cleanEnv = stripEnv(["ACAI_API_TOKEN"]);
			const result = await runCliInDir(
				workspace.root,
				["features", "--impl", "product/impl"],
				cleanEnv,
			);

			expect(result.exitCode).not.toBe(2);
			expect(result.stderr).not.toContain(
				"Missing API bearer token configuration.",
			);
		} finally {
			await workspace.cleanup();
		}
	});

	test("cli-core.AUTH.2 explicit env var takes precedence over .env", async () => {
		const workspace = await createTempWorkspace({
			".env": "ACAI_API_TOKEN=from-dotenv\n",
		});

		try {
			const cleanEnv = stripEnv(["ACAI_API_TOKEN"]);
			cleanEnv["ACAI_API_TOKEN"] = "from-env";
			const result = await runCliInDir(
				workspace.root,
				["features", "--impl", "product/impl"],
				cleanEnv,
			);

			expect(result.exitCode).not.toBe(2);
			expect(result.stderr).not.toContain(
				"Missing API bearer token configuration.",
			);
		} finally {
			await workspace.cleanup();
		}
	});
});
