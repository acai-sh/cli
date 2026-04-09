import type {
	FeatureStatesRequest,
	FeatureStatesResponse,
} from "../generated/types.ts";
import type { ApiClient } from "./api.ts";
import { usageError } from "./errors.ts";
import type { CommandResult } from "./output.ts";
import {
	normalizeOneImplementationTarget,
	resolveImplementationName,
	type OneImplementationResolverDependencies,
} from "./targeting.ts";

const VALID_STATUSES = new Set([
	"assigned",
	"blocked",
	"incomplete",
	"completed",
	"rejected",
	"accepted",
]);
const FULL_ACID_PATTERN =
	/^[A-Za-z0-9_-]+\.[A-Z][A-Z0-9_-]*\.[0-9]+(?:-[0-9]+)?$/;
type FeatureStateStatus = FeatureStatesRequest["states"][string]["status"];

export interface SetStatusArgs {
	source: string;
	productName: string;
	implementationName?: string;
	json: boolean;
}

export interface SetStatusCommandOptions {
	product?: string;
	impl?: string;
	json?: boolean;
}

export interface SetStatusDependencies
	extends OneImplementationResolverDependencies {
	readInput?: (source: string) => Promise<string>;
}

export interface ParsedFeatureStatesPayload {
	featureName: string;
	states: FeatureStatesRequest["states"];
}

// set-status.MAIN.1 / set-status.MAIN.4 / set-status.MAIN.5 / set-status.MAIN.6
export function normalizeSetStatusOptions(
	source: string,
	options: SetStatusCommandOptions,
): SetStatusArgs {
	if (!source || source.startsWith("--")) {
		throw usageError("Missing value for <json>.");
	}

	const target = normalizeOneImplementationTarget(options);
	return {
		source,
		productName: target.productName,
		implementationName: target.implementationName,
		json: options.json ?? false,
	};
}

// set-status.MAIN.2 / set-status.MAIN.3 / set-status.INPUT.5 / set-status.SAFETY.1 / set-status.UX.2
export async function readSetStatusInput(source: string): Promise<string> {
	if (source === "-") {
		return await Bun.stdin.text();
	}

	if (source.startsWith("@")) {
		const filePath = source.slice(1);
		if (!filePath) {
			throw usageError("Missing file path after @ input selector.");
		}

		try {
			return await Bun.file(filePath).text();
		} catch {
			throw usageError(`Unable to read input file: ${filePath}`);
		}
	}

	return source;
}

// set-status.INPUT.1 / set-status.INPUT.2 / set-status.INPUT.2-1 / set-status.INPUT.3 / set-status.INPUT.4 / set-status.INPUT.5 / set-status.SAFETY.3
export function parseFeatureStatesPayload(
	jsonText: string,
): ParsedFeatureStatesPayload {
	let parsed: unknown;

	try {
		parsed = JSON.parse(jsonText);
	} catch {
		throw usageError("Invalid JSON payload.");
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw usageError(
			"Status payload must be a JSON object keyed by full ACID.",
		);
	}

	const states = parsed as Record<string, unknown>;
	const acids = Object.keys(states);
	if (acids.length === 0) {
		throw usageError("Status payload must include at least one ACID state.");
	}

	let featureName: string | undefined;
	const normalizedStates: FeatureStatesRequest["states"] = {};

	for (const acid of acids) {
		if (!FULL_ACID_PATTERN.test(acid)) {
			throw usageError(`Malformed ACID: ${acid}`);
		}

		const acidFeatureName = acid.split(".", 1)[0]!;
		if (featureName && featureName !== acidFeatureName) {
			throw usageError(
				"All ACIDs in one payload must share the same feature prefix.",
			);
		}
		featureName = acidFeatureName;

		const stateValue = states[acid];
		if (
			!stateValue ||
			typeof stateValue !== "object" ||
			Array.isArray(stateValue)
		) {
			throw usageError(`State for ${acid} must be a JSON object.`);
		}

		const state = stateValue as Record<string, unknown>;
		if (!("status" in state)) {
			throw usageError(`State for ${acid} must include status.`);
		}

		const status = state.status as FeatureStateStatus | unknown;
		if (
			status !== null &&
			(typeof status !== "string" || !VALID_STATUSES.has(status))
		) {
			throw usageError(`Invalid status for ${acid}: ${String(status)}`);
		}

		if (state.comment !== undefined && typeof state.comment !== "string") {
			throw usageError(`Comment for ${acid} must be a string.`);
		}

		normalizedStates[acid] = {
			status: status as FeatureStateStatus,
			...(state.comment === undefined ? {} : { comment: state.comment }),
		};
	}

	return { featureName: featureName!, states: normalizedStates };
}

// set-status.API.1 / set-status.API.2 / set-status.API.3 / set-status.UX.1 / set-status.UX.2 / cli-core.OUTPUT.1 / cli-core.OUTPUT.2
export async function runSetStatusCommand(
	apiClient: ApiClient,
	args: SetStatusArgs,
	dependencies: SetStatusDependencies = {},
): Promise<CommandResult> {
	const readInput = dependencies.readInput ?? readSetStatusInput;
	const payload = parseFeatureStatesPayload(await readInput(args.source));

	const implementationName = await resolveImplementationName(
		apiClient,
		{
			productName: args.productName,
			implementationName: args.implementationName,
		},
		dependencies,
	);

	const response = await apiClient.setFeatureStates({
		product_name: args.productName,
		feature_name: payload.featureName,
		implementation_name: implementationName,
		states: payload.states,
	});

	if (args.json) {
		return {
			exitCode: 0,
			jsonPayload: response,
			stderrLines: response.data.warnings,
		};
	}

	return {
		exitCode: 0,
		stdoutLines: formatSetStatusText(response),
	};
}

export function formatSetStatusText(response: FeatureStatesResponse): string[] {
	const { data } = response;
	const lines = [
		`${data.product_name}/${data.implementation_name} feature=${data.feature_name}`,
		`states_written=${data.states_written}`,
	];

	for (const warning of data.warnings) {
		lines.push(`warning: ${warning}`);
	}

	return lines;
}
