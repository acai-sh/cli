import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRuntime } from "./runtime.ts";

describe("cli-core.DIST.1 cli-core.UX.1", () => {
	test("defaultRuntime reads text files with node-compatible APIs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "acai-runtime-"));
		const filePath = join(dir, "sample.txt");
		await writeFile(filePath, "runtime file contents");

		await expect(defaultRuntime.readTextFile(filePath)).resolves.toBe(
			"runtime file contents",
		);
	});

	test("defaultRuntime captures stdout stderr and exit code from subprocesses", async () => {
		const result = await defaultRuntime.runCommand(process.execPath, [
			"-e",
			'process.stdout.write("out"); process.stderr.write("err"); process.exit(3);',
		]);

		expect(result).toEqual({
			exitCode: 3,
			stdout: "out",
			stderr: "err",
		});
	});
});
