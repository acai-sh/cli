import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export interface CommandExecutionResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface RuntimeCompat {
	getArgv(): string[];
	readTextFile(filePath: string): Promise<string>;
	readStdinText(): Promise<string>;
	runCommand(
		command: string,
		args: string[],
		options?: { cwd?: string },
	): Promise<CommandExecutionResult>;
}

const utf8Decoder = new TextDecoder();

export const defaultRuntime: RuntimeCompat = {
	getArgv() {
		return process.argv;
	},

	async readTextFile(filePath) {
		return readFile(filePath, "utf8");
	},

	async readStdinText() {
		return readStreamText(process.stdin);
	},

	async runCommand(command, args, options = {}) {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const exitCodePromise = new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => {
				resolve(code ?? (signal ? 1 : 0));
			});
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			readStreamText(child.stdout),
			readStreamText(child.stderr),
			exitCodePromise,
		]);

		return { exitCode, stdout, stderr };
	},
};

async function readStreamText(
	stream: NodeJS.ReadableStream | null | undefined,
): Promise<string> {
	if (!stream) return "";

	if ("setEncoding" in stream && typeof stream.setEncoding === "function") {
		stream.setEncoding("utf8");
	}

	let text = "";
	for await (const chunk of stream as AsyncIterable<unknown>) {
		text += decodeTextChunk(chunk);
	}

	return text;
}

function decodeTextChunk(chunk: unknown): string {
	if (typeof chunk === "string") return chunk;
	if (chunk instanceof Uint8Array) return utf8Decoder.decode(chunk);
	return String(chunk);
}
