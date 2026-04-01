import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeGitContext {
  binDir: string;
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

export async function createFakeGitContext(options: {
  remote?: string;
  branch?: string;
  remoteExitCode?: number;
  branchExitCode?: number;
}): Promise<FakeGitContext> {
  const binDir = await mkdtemp(join(tmpdir(), "acai-git-"));
  const scriptPath = join(binDir, "git");
  const remote = options.remote ?? "git@github.com:my-org/my-repo.git";
  const branch = options.branch ?? "main";
  const remoteExitCode = options.remoteExitCode ?? 0;
  const branchExitCode = options.branchExitCode ?? 0;

  const script = `#!/bin/sh
case "$1 $2" in
  "remote get-url")
    ${remoteExitCode === 0 ? `printf '%s\\n' '${remote.replace(/'/g, "'\\''")}'` : "printf '%s\\n' 'remote failure' >&2"}
    exit ${remoteExitCode}
    ;;
  "branch --show-current")
    ${branchExitCode === 0 ? `printf '%s\\n' '${branch.replace(/'/g, "'\\''")}'` : "printf '%s\\n' 'branch failure' >&2"}
    exit ${branchExitCode}
    ;;
esac
printf '%s\\n' 'unexpected git invocation' >&2
exit 1
`;

  await writeFile(scriptPath, script, { mode: 0o755 });
  await chmod(scriptPath, 0o755);

  return {
    binDir,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
    cleanup: async () => {
      await rm(binDir, { recursive: true, force: true });
    },
  };
}
