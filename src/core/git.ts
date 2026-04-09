import { runtimeError } from "./errors.ts";

export interface GitContext {
	repoUri: string;
	branchName: string;
}

export interface GitPushContext extends GitContext {
	commitHash: string;
}

// push.MAIN.8 / push.SCAN.3
export async function readGitRepoRoot(
	options: { cwd?: string; runner?: GitCommandRunner } = {},
): Promise<string> {
	const cwd = options.cwd ?? process.cwd();
	const runner = options.runner ?? defaultGitRunner;
	return runGit(runner, cwd, ["rev-parse", "--show-toplevel"]);
}

export interface GitCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface GitCommandRunner {
	run(args: string[], cwd: string): Promise<GitCommandResult>;
}

const defaultGitRunner: GitCommandRunner = {
	async run(args, cwd) {
		const proc = Bun.spawn({
			cmd: ["git", ...args],
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		return { exitCode, stdout, stderr };
	},
};

// cli-core.TARGETING.2 / cli-core.ERRORS.2
export async function readGitContext(
	options: { cwd?: string; runner?: GitCommandRunner } = {},
): Promise<GitContext> {
	const cwd = options.cwd ?? process.cwd();
	const runner = options.runner ?? defaultGitRunner;

	try {
		const [remote, branch] = await Promise.all([
			runGit(runner, cwd, ["remote", "get-url", "origin"]),
			runGit(runner, cwd, ["branch", "--show-current"]),
		]);

		const repoUri = normalizeRepoUri(remote);
		if (!repoUri || !branch || branch === "HEAD") {
			throw runtimeError("Git context could not be determined.");
		}

		return { repoUri, branchName: branch };
	} catch (error) {
		if (error instanceof Error && error.name === "CliError") {
			throw error;
		}
		throw runtimeError(
			"Git context could not be determined.",
			undefined,
			error,
		);
	}
}

// push.MAIN.7 / push.SCAN.3 / push.SAFETY.2
export async function readGitPushContext(
	options: { cwd?: string; runner?: GitCommandRunner } = {},
): Promise<GitPushContext> {
	const cwd = options.cwd ?? process.cwd();
	const runner = options.runner ?? defaultGitRunner;

	const [context, commitHash] = await Promise.all([
		readGitContext({ cwd, runner }),
		readGitCommitHash({ cwd, runner }),
	]);

	return { ...context, commitHash };
}

// push.SCAN.3 / push.SAFETY.2
export async function readGitCommitHash(
	options: { cwd?: string; runner?: GitCommandRunner } = {},
): Promise<string> {
	const cwd = options.cwd ?? process.cwd();
	const runner = options.runner ?? defaultGitRunner;
	return runGit(runner, cwd, ["rev-parse", "HEAD"]);
}

// push.SCAN.3 / push.SAFETY.2
export async function readGitFileLastSeenCommit(
	filePath: string,
	options: {
		cwd?: string;
		runner?: GitCommandRunner;
	} = {},
): Promise<string> {
	const cwd = options.cwd ?? process.cwd();
	const runner = options.runner ?? defaultGitRunner;
	return runGit(runner, cwd, ["log", "-1", "--format=%H", "--", filePath]);
}

export function normalizeRepoUri(remote: string): string | null {
	const trimmed = remote.trim().replace(/\.git$/, "");
	if (!trimmed) return null;

	const scpMatch = trimmed.match(/^[^@\s]+@([^:\s]+):(.+)$/);
	if (scpMatch) {
		return formatRepoUri(scpMatch[1]!, scpMatch[2]!);
	}

	if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
		try {
			const url = new URL(trimmed);
			const pathname = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
			if (!url.hostname || !pathname) return null;
			return formatRepoUri(url.hostname, pathname);
		} catch {
			return null;
		}
	}

	if (/^[^/\s]+\/[^/\s]+\/.+/.test(trimmed)) {
		return trimmed.replace(/^\/+/, "");
	}

	return null;
}

async function runGit(
	runner: GitCommandRunner,
	cwd: string,
	args: string[],
): Promise<string> {
	const result = await runner.run(args, cwd);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	}

	return result.stdout.trim();
}

function formatRepoUri(host: string, pathname: string): string {
	return `${host}/${pathname.replace(/^\/+/, "")}`;
}
