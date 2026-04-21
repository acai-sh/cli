import { describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getCanonicalSkillContent,
	installSkill,
	normalizeSkillOptions,
	resolveSkillInstallPath,
	runSkillCommand,
} from "./core/skill.ts";

async function runProcess(
	cmd: string[],
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn({
		cmd,
		cwd,
		env: process.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { exitCode, stdout, stderr };
}

describe("skill command output", () => {
	test("skill.MAIN.2 loads the canonical bundled skill markdown verbatim", async () => {
		const canonicalFile = await readFile(
			new URL("../.agents/skills/acai/SKILL.md", import.meta.url),
			"utf8",
		);

		expect(getCanonicalSkillContent()).toBe(canonicalFile);
	});

	test("skill.MAIN.3 skill.UX.1 returns raw skill markdown with no added framing", async () => {
		const result = await runSkillCommand({ install: false });

		expect(result).toEqual({
			exitCode: 0,
			stdoutText: getCanonicalSkillContent(),
		});
	});
});

describe("skill installation helpers", () => {
	test("skill.MAIN.4 normalizes the optional --install flag", () => {
		expect(normalizeSkillOptions()).toEqual({ install: false });
		expect(normalizeSkillOptions({ install: true })).toEqual({ install: true });
	});

	test("skill.WRITE.1 resolves the install path under the caller cwd", () => {
		expect(resolveSkillInstallPath("/tmp/example")).toBe(
			"/tmp/example/.agents/skills/acai/SKILL.md",
		);
	});

	test("skill.WRITE.1 skill.WRITE.3 installs and overwrites the canonical skill file", async () => {
		const root = await mkdtemp(join(tmpdir(), "acai-skill-unit-"));
		const destination = resolveSkillInstallPath(root);

		try {
			await mkdir(join(root, ".agents", "skills", "acai"), { recursive: true });
			await writeFile(destination, "old content");
			await installSkill(root);

			expect(await readFile(destination, "utf8")).toBe(
				getCanonicalSkillContent(),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("skill.WRITE.2 creates missing parent directories recursively", async () => {
		const createDirectory = mock(async () => undefined);
		const writeSkillFile = mock(async () => undefined);

		await installSkill("/workspace", {
			createDirectory: createDirectory as never,
			writeFile: writeSkillFile as never,
		});

		expect(createDirectory).toHaveBeenCalledWith(
			"/workspace/.agents/skills/acai",
			{ recursive: true },
		);
		expect(writeSkillFile).toHaveBeenCalledWith(
			"/workspace/.agents/skills/acai/SKILL.md",
			getCanonicalSkillContent(),
		);
	});

	test("skill.SAFETY.3 keeps installed bytes identical to printed bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "acai-skill-parity-"));
		const destination = resolveSkillInstallPath(root);

		try {
			const printResult = await runSkillCommand({ install: false });
			await runSkillCommand({ install: true }, { cwd: root });

			expect(printResult.stdoutText).toBe(await readFile(destination, "utf8"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("skill distribution packaging", () => {
	test("cli-core.DIST.1 bundles the canonical skill content into the node distribution", async () => {
		const workspaceRoot = new URL("..", import.meta.url).pathname;
		const outputRoot = await mkdtemp(join(tmpdir(), "acai-skill-dist-js-"));
		const bundlePath = join(outputRoot, "acai.js");

		try {
			const build = await runProcess(
				[
					"bun",
					"build",
					"./src/index.ts",
					"--target=node",
					"--outfile",
					bundlePath,
				],
				workspaceRoot,
			);

			expect(build.exitCode).toBe(0);

			const result = await runProcess(
				["node", bundlePath, "skill"],
				outputRoot,
			);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe(getCanonicalSkillContent());
			expect(result.stderr).toBe("");
		} finally {
			await rm(outputRoot, { recursive: true, force: true });
		}
	});

	test("cli-core.DIST.2 cli-core.DIST.3 compile a runnable binary that prints the canonical skill content", async () => {
		const workspaceRoot = new URL("..", import.meta.url).pathname;
		const outputRoot = await mkdtemp(join(tmpdir(), "acai-skill-dist-bin-"));
		const binaryPath = join(outputRoot, "acai");

		try {
			const build = await runProcess(
				[
					"bun",
					"build",
					"./src/index.ts",
					"--compile",
					"--outfile",
					binaryPath,
				],
				workspaceRoot,
			);

			expect(build.exitCode).toBe(0);

			const result = await runProcess([binaryPath, "skill"], outputRoot);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe(getCanonicalSkillContent());
			expect(result.stderr).toBe("");
		} finally {
			await rm(outputRoot, { recursive: true, force: true });
		}
	});
});
