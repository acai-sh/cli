import type { ApiClient } from "./api.ts";
import { usageError } from "./errors.ts";
import type { CommandResult } from "./output.ts";
import {
	resolveImplementationName,
	type OneImplementationResolverDependencies,
} from "./targeting.ts";

export interface FeaturesArgs {
	productName: string;
	implementationName?: string;
	statuses: string[];
	changedSinceCommit?: string;
	json: boolean;
}

export interface FeaturesCommandOptions {
	product: string;
	impl?: string;
	status?: string[];
	changedSinceCommit?: string;
	json?: boolean;
}

export type FeaturesTargetResolverDependencies =
	OneImplementationResolverDependencies;

// features.MAIN.1 / cli-core.TARGETING.1
export function normalizeFeaturesOptions(
	options: FeaturesCommandOptions,
): FeaturesArgs {
	if (options.product.startsWith("-")) {
		throw usageError("Missing value for --product.");
	}

	if (options.impl?.startsWith("-")) {
		throw usageError("Missing value for --impl.");
	}

	if (options.changedSinceCommit?.startsWith("-")) {
		throw usageError("Missing value for --changed-since-commit.");
	}

	const statuses = options.status ?? [];
	for (const status of statuses) {
		if (status.startsWith("-")) {
			throw usageError("Missing value for --status.");
		}
	}

	return {
		productName: options.product,
		implementationName: options.impl,
		statuses,
		changedSinceCommit: options.changedSinceCommit,
		json: options.json ?? false,
	};
}

export async function runFeaturesCommand(
	apiClient: ApiClient,
	args: FeaturesArgs,
	dependencies: FeaturesTargetResolverDependencies = {},
): Promise<CommandResult> {
	const implementationName = await resolveImplementationName(
		apiClient,
		{
			productName: args.productName,
			implementationName: args.implementationName,
		},
		dependencies,
	);

	const response = await apiClient.listImplementationFeatures({
		productName: args.productName,
		implementationName,
		statuses: args.statuses.length > 0 ? args.statuses : undefined,
		changedSinceCommit: args.changedSinceCommit,
	});

	const features = response.data.features;
	if (args.json) {
		return { exitCode: 0, jsonPayload: response };
	}

	if (features.length === 0) {
		return {
			exitCode: 0,
			stdoutLines: ["No features were returned."],
		};
	}

	return {
		exitCode: 0,
		stdoutLines: features.map(
			(feature) =>
				`${feature.feature_name} ${feature.completed_count}/${feature.total_count} refs_count=${feature.refs_count}`,
		),
	};
}
