export interface SpawnedCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCliSubprocessOptions {
  cwd?: string;
  input?: string;
}

export async function runCliSubprocess(
  args: string[],
  env: Record<string, string> = {},
  options: RunCliSubprocessOptions = {},
): Promise<SpawnedCliResult> {
  const workspaceRoot = import.meta.dir + "/../..";
  const proc = Bun.spawn({
    cmd: ["bun", workspaceRoot + "/src/index.ts", ...args],
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
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
