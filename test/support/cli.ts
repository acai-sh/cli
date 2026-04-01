export interface SpawnedCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCliSubprocess(args: string[], env: Record<string, string> = {}): Promise<SpawnedCliResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: import.meta.dir + "/../..",
    env: {
      ...process.env,
      ...env,
    },
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
