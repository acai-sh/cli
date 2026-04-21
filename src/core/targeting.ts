import type { ApiClient } from "./api.ts";
import { readGitContext } from "./git.ts";
import { runtimeError, usageError } from "./errors.ts";

export interface OneImplementationTarget {
	productName?: string;
	implementationName?: string;
	implementationFilter?: string;
	featureName?: string;
}

export interface OneImplementationOptions {
	product?: string;
	impl?: string;
}

export interface OneImplementationResolverDependencies {
	readGitContext?: typeof readGitContext;
}

export interface NormalizeOneImplementationTargetOptions {
	requireProduct?: boolean;
}

export interface ResolvedImplementationTarget {
	productName: string;
	implementationName: string;
}

// feature.MAIN.2 / feature.MAIN.3
export function normalizeOneImplementationTarget(
	options: OneImplementationOptions,
	normalizeOptions: NormalizeOneImplementationTargetOptions = {},
): OneImplementationTarget {
	const requireProduct = normalizeOptions.requireProduct ?? true;

	if (options.product?.startsWith("-")) {
		throw usageError("Missing value for --product.");
	}

	if (options.impl?.startsWith("-")) {
		throw usageError("Missing value for --impl.");
	}

	const scopedTarget = parseScopedImplementationSelector(options.impl);

	if (
		options.product &&
		scopedTarget &&
		options.product !== scopedTarget.productName
	) {
		throw usageError(
			`Conflicting product selectors: --product ${options.product} does not match --impl ${options.impl}.`,
		);
	}

	const productName = options.product ?? scopedTarget?.productName;
	if (requireProduct && !productName) {
		throw usageError(
			"Missing product selector. Provide --product or use --impl <product/implementation>.",
		);
	}

	const implementationName =
		scopedTarget?.implementationName ?? (productName ? options.impl : undefined);
	const implementationFilter =
		productName || scopedTarget ? undefined : options.impl;

	return {
		productName,
		implementationName,
		implementationFilter,
	};
}

export function parseScopedImplementationSelector(
	selector?: string,
): { productName: string; implementationName: string } | undefined {
	if (!selector) {
		return undefined;
	}

	const slashIndex = selector.indexOf("/");
	if (slashIndex <= 0 || slashIndex === selector.length - 1) {
		return undefined;
	}

	const productName = selector.slice(0, slashIndex);
	const implementationName = selector.slice(slashIndex + 1);
	if (!productName || !implementationName || implementationName.includes("/")) {
		return undefined;
	}

	return { productName, implementationName };
}

// cli-core.TARGETING.1
export async function resolveImplementationTarget(
	apiClient: ApiClient,
	target: OneImplementationTarget,
	dependencies: OneImplementationResolverDependencies = {},
): Promise<ResolvedImplementationTarget> {
	if (target.productName && target.implementationName) {
		return {
			productName: target.productName,
			implementationName: target.implementationName,
		};
	}

	const contextReader = dependencies.readGitContext ?? readGitContext;
	const gitContext = await contextReader();
	const response = await apiClient.listImplementations({
		productName: target.productName,
		repoUri: gitContext.repoUri,
		branchName: gitContext.branchName,
		featureName: target.featureName,
	});

	// cli-core.TARGETING.3 / cli-core.TARGETING.4 / cli-core.TARGETING.5
	const implementations = response.data.implementations
		.map((entry) => ({
			productName: entry.product_name ?? response.data.product_name,
			implementationName: entry.implementation_name,
		}))
		.filter(
			(entry): entry is ResolvedImplementationTarget =>
				typeof entry.productName === "string" &&
				entry.productName.length > 0 &&
				(target.implementationFilter === undefined ||
					entry.implementationName === target.implementationFilter),
		);

	if (implementations.length === 1) {
		return implementations[0]!;
	}

	if (implementations.length === 0) {
		const featureHint =
			target.featureName === undefined
				? ""
				: ` or no tracked implementation on this branch includes feature \`${target.featureName}\``;
		throw runtimeError(
			`No implementation matched the current repo, branch, and filters. This branch may not be tracked yet${featureHint}. Try \`acai push\` from this branch, or pass \`--product\` and \`--impl\` for a known implementation.`,
		);
	}

	const candidates = implementations
		.map((entry) => `${entry.productName}/${entry.implementationName}`)
		.sort((left, right) => left.localeCompare(right));

	throw runtimeError(
		`Multiple implementations matched the current repo, branch, and filters: ${candidates.join(", ")}`,
	);
}

// cli-core.TARGETING.1
export async function resolveImplementationName(
	apiClient: ApiClient,
	target: OneImplementationTarget,
	dependencies: OneImplementationResolverDependencies = {},
): Promise<string> {
	return (
		await resolveImplementationTarget(apiClient, target, dependencies)
	).implementationName;
}
