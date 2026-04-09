export type ExitCode = 0 | 1 | 2;

export class CliError extends Error {
	constructor(
		message: string,
		public readonly exitCode: ExitCode,
		public readonly kind: "usage" | "runtime",
		public readonly detail?: string,
		cause?: unknown,
	) {
		super(message, { cause });
		this.name = "CliError";
	}
}

export const usageError = (message: string, detail?: string) =>
	new CliError(message, 2, "usage", detail);

export const runtimeError = (
	message: string,
	detail?: string,
	cause?: unknown,
) => new CliError(message, 1, "runtime", detail, cause);
