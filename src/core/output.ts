import type { ExitCode } from "./errors.ts";

export interface WriteStreamLike {
	write(text: string): void | Promise<void>;
}

export interface OutputPorts {
	stdout: WriteStreamLike;
	stderr: WriteStreamLike;
}

export const defaultOutputPorts = (): OutputPorts => ({
	stdout: {
		write: (text) => {
			process.stdout.write(text);
		},
	},
	stderr: {
		write: (text) => {
			process.stderr.write(text);
		},
	},
});

export async function writeLine(
	stream: WriteStreamLike,
	line: string,
): Promise<void> {
	await stream.write(`${line}\n`);
}

// cli-core.OUTPUT.1 / cli-core.OUTPUT.2
export async function writeJsonResult(
	ports: OutputPorts,
	payload: unknown,
	diagnostics: string[] = [],
): Promise<void> {
	for (const diagnostic of diagnostics) {
		await writeLine(ports.stderr, diagnostic);
	}

	await writeLine(ports.stdout, JSON.stringify(payload));
}

export async function writeTextResult(
	ports: OutputPorts,
	lines: string[],
	diagnostics: string[] = [],
): Promise<void> {
	for (const diagnostic of diagnostics) {
		await writeLine(ports.stderr, diagnostic);
	}

	for (const line of lines) {
		await writeLine(ports.stdout, line);
	}
}

export async function writeRawTextResult(
	ports: OutputPorts,
	text: string,
	diagnostics: string[] = [],
): Promise<void> {
	for (const diagnostic of diagnostics) {
		await writeLine(ports.stderr, diagnostic);
	}

	await ports.stdout.write(text);
}

// cli-core.OUTPUT.1 / cli-core.OUTPUT.2
export async function writeCommandResult(
	ports: OutputPorts,
	result: CommandResult,
): Promise<void> {
	if (result.jsonPayload !== undefined) {
		await writeJsonResult(ports, result.jsonPayload, result.stderrLines);
		return;
	}

	if (result.stdoutText !== undefined) {
		await writeRawTextResult(ports, result.stdoutText, result.stderrLines);
		return;
	}

	await writeTextResult(ports, result.stdoutLines ?? [], result.stderrLines);
}

export interface CommandResult {
	exitCode: ExitCode;
	stdoutText?: string;
	stdoutLines?: string[];
	jsonPayload?: unknown;
	stderrLines?: string[];
}

export function formatTextTable(
	headers: string[],
	rows: Array<Array<string | number | boolean | null | undefined>>,
): string[] {
	if (headers.length === 0) return [];

	const normalizedRows = rows.map((row) =>
		headers.map((_, index) => formatTableCell(row[index])),
	);
	const widths = headers.map((header, index) =>
		Math.max(
			header.length,
			...normalizedRows.map((row) => row[index]?.length ?? 0),
		),
	);

	return [
		formatTableRow(headers, widths),
		formatTableRow(widths.map((width) => "-".repeat(width)), widths),
		...normalizedRows.map((row) => formatTableRow(row, widths)),
	];
}

function formatTableCell(
	value: string | number | boolean | null | undefined,
): string {
	if (value === null || value === undefined || value === "") return "-";
	return String(value);
}

function formatTableRow(cells: string[], widths: number[]): string {
	return cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
}
