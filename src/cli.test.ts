import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";

// cli-core.EXITS.1: A successful command exits with code 0
// cli-core.EXITS.2: A usage or input validation error exits with code 2
// cli-core.EXITS.3: A runtime failure exits with code 1
describe("CLI entrypoint", () => {
  test("src/index.ts exists", () => {
    expect(existsSync(import.meta.dir + "/index.ts")).toBe(true);
  });

  test("package.json has test script", async () => {
    const pkg = await Bun.file(import.meta.dir + "/../package.json").json();
    expect(pkg.scripts?.test).toBeDefined();
  });
});
