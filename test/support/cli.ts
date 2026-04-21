export interface SpawnedCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCliSubprocessOptions {
  cwd?: string;
  input?: string;
}

export interface CliCommand {
  command: string;
  args: string[];
}

export async function runSubprocess(
  cli: CliCommand,
  env: Record<string, string> = {},
  options: RunCliSubprocessOptions = {},
): Promise<SpawnedCliResult> {
  const proc = Bun.spawn({
    cmd: [cli.command, ...cli.args],
    cwd: options.cwd,
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

export async function runCliSubprocess(
  args: string[],
  env: Record<string, string> = {},
  options: RunCliSubprocessOptions = {},
): Promise<SpawnedCliResult> {
  const workspaceRoot = import.meta.dir + "/../..";
  return runSubprocess(
    { command: "bun", args: [workspaceRoot + "/src/index.ts", ...args] },
    env,
    { ...options, cwd: options.cwd ?? workspaceRoot },
  );
}
