import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const FULL_ACID_PATTERN = /\b[a-z0-9-]+\.[A-Z0-9-]+\.[0-9]+(?:-[0-9]+)?\b/g;

describe("ACID reference hygiene", () => {
	test("source files avoid long runs of ACIDs on one line", async () => {
		const offenders: string[] = [];

		for await (const relativePath of new Bun.Glob("src/**/*.ts").scan({
			cwd: new URL("..", import.meta.url).pathname,
		})) {
			const absolutePath = new URL(`../${relativePath}`, import.meta.url);
			const content = await readFile(absolutePath, "utf8");

			for (const [index, line] of content.split("\n").entries()) {
				const matches = line.match(FULL_ACID_PATTERN) ?? [];
				if (matches.length >= 4) {
					offenders.push(`${relativePath}:${index + 1}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
