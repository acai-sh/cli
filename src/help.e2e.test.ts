import { describe, expect, test } from "bun:test";
import { runCliSubprocess } from "../test/support/cli.ts";

describe("CLI help output", () => {
	test("cli-core.HELP.1 prints top-level help when invoked without a subcommand", async () => {
		const result = await runCliSubprocess([]);

		expect(result.exitCode).toBe(0);
		expect(result.stderr.trim()).toBe("");
		expect(result.stdout).toContain("Usage: acai");
		expect(result.stdout).toContain("features");
	});

	test("cli-core.HELP.2 cli-core.HELP.5 keep top-level --help and -h in sync", async () => {
		const help = await runCliSubprocess(["--help"]);
		const shortHelp = await runCliSubprocess(["-h"]);

		expect(help.exitCode).toBe(0);
		expect(shortHelp.exitCode).toBe(0);
		expect(help.stdout).toBe(shortHelp.stdout);
		expect(help.stderr.trim()).toBe("");
		expect(shortHelp.stderr.trim()).toBe("");
	});

	test("cli-core.HELP.3 cli-core.HELP.5 keep features --help and -h in sync", async () => {
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

	test("cli-core.HELP.3 cli-core.HELP.5 keep feature --help and -h in sync", async () => {
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
});
