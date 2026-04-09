import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCanonicalSkillContent } from "./core/skill.ts";
import { runCliSubprocess } from "../test/support/cli.ts";
import {
	createTempWorkspace,
	expectUsageError,
} from "../test/support/e2e.ts";

describe("skill command", () => {
	test("skill.MAIN.2 skill.MAIN.3 skill.UX.1 prints the canonical skill markdown and nothing else", async () => {
		const workspace = await createTempWorkspace({}, "acai-skill-print-");

		try {
			const result = await runCliSubprocess(["skill"], {}, { cwd: workspace.root });

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe(getCanonicalSkillContent());
			expect(result.stderr).toBe("");
		} finally {
			await workspace.cleanup();
		}
	});

	test("skill.WRITE.1 skill.WRITE.3 installs and overwrites the canonical skill file in an isolated workspace", async () => {
		const workspace = await createTempWorkspace({}, "acai-skill-install-");
		const destination = join(workspace.root, ".agents", "skills", "acai", "SKILL.md");

		try {
			await mkdir(join(workspace.root, ".agents", "skills", "acai"), {
				recursive: true,
			});
			await writeFile(destination, "stale content");

			const result = await runCliSubprocess(["skill", "--install"], {}, { cwd: workspace.root });

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
			expect(await readFile(destination, "utf8")).toBe(getCanonicalSkillContent());
		} finally {
			await workspace.cleanup();
		}
	});

	test("skill.WRITE.2 installs into a clean workspace without precreating parent directories", async () => {
		const workspace = await createTempWorkspace({}, "acai-skill-clean-");
		const destination = join(workspace.root, ".agents", "skills", "acai", "SKILL.md");

		try {
			const result = await runCliSubprocess(["skill", "--install"], {}, { cwd: workspace.root });

			expect(result.exitCode).toBe(0);
			expect(await readFile(destination, "utf8")).toBe(getCanonicalSkillContent());
		} finally {
			await workspace.cleanup();
		}
	});

	test("skill.SAFETY.1 skill.SAFETY.3 works without ACAI_API_TOKEN in a temp workspace", async () => {
		const workspace = await createTempWorkspace({}, "acai-skill-parity-e2e-");
		const destination = join(workspace.root, ".agents", "skills", "acai", "SKILL.md");

		try {
			const printResult = await runCliSubprocess(["skill"], {}, { cwd: workspace.root });
			const installResult = await runCliSubprocess(["skill", "--install"], {}, { cwd: workspace.root });

			expect(printResult.exitCode).toBe(0);
			expect(installResult.exitCode).toBe(0);
			expect(printResult.stdout).toBe(await readFile(destination, "utf8"));
			expect(printResult.stderr).toBe("");
			expect(installResult.stdout).toBe("");
			expect(installResult.stderr).toBe("");
		} finally {
			await workspace.cleanup();
		}
	});

	test("cli-core.ERRORS.4 returns exit code 2 for unknown skill options", async () => {
		const result = await runCliSubprocess(["skill", "--unknown-option"]);
		expectUsageError(result, "Usage: acai skill", "unknown option");
	});

	test("cli-core.HELP.3 cli-core.HELP.5 keep skill --help and -h in sync", async () => {
		const help = await runCliSubprocess(["skill", "--help"]);
		const shortHelp = await runCliSubprocess(["skill", "-h"]);

		expect(help.exitCode).toBe(0);
		expect(shortHelp.exitCode).toBe(0);
		expect(help.stdout).toBe(shortHelp.stdout);
		expect(help.stdout).toContain("Usage: acai skill [options]");
		expect(help.stderr.trim()).toBe("");
		expect(shortHelp.stderr.trim()).toBe("");
	});
});
