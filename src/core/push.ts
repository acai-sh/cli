import { load as loadYaml } from "js-yaml";
import type { ApiClient } from "./api.ts";
import type { components } from "../generated/types.ts";
import { runtimeError, usageError } from "./errors.ts";
import type { CommandResult } from "./output.ts";
import {
	readGitCommitHash,
	readGitFileLastSeenCommit,
	readGitPushContext,
	readGitRepoRoot,
	type GitCommandRunner,
	type GitPushContext,
} from "./git.ts";

export type PushRequest = components["schemas"]["PushRequest"];
export type PushSpec = NonNullable<PushRequest["specs"]>[number];
export type PushReference = NonNullable<
	PushRequest["references"]
>["data"][string][number];

export interface PushCommandOptions {
	cwd?: string;
	runner?: GitCommandRunner;
	featureNames?: string[];
	all?: boolean;
	product?: string;
	target?: string;
	parent?: string;
	json?: boolean;
}

export interface NormalizedPushOptions {
	featureNames: string[];
	all: boolean;
	product?: string;
	target?: string;
	parent?: string;
	json: boolean;
}

export interface DiscoveredPushSpec {
	featureName: string;
	productName: string;
	path: string;
	lastSeenCommit: string;
	spec: PushSpec;
}

export interface DiscoveredPushReference {
	featureName: string;
	acid: string;
	path: string;
	isTest: boolean;
}

export interface PushScanResult {
	specs: DiscoveredPushSpec[];
	references: DiscoveredPushReference[];
}

export interface PushPlan extends GitPushContext {
	payloads: PushRequest[];
}

export interface PushSuccessSummary {
	productName: string;
	implementationName?: string | null;
	specsCreated: number;
	specsUpdated: number;
	refsPushed: number;
	warnings: string[];
}

export interface PushFailureSummary {
	productName: string;
	error: string;
}

export interface PushCommandPayload {
	repoUri: string;
	branchName: string;
	commitHash: string;
	results: PushSuccessSummary[];
	failures: PushFailureSummary[];
}

interface ParsedFeatureDocument {
	spec: PushSpec;
}

interface ProductBucket {
	specs: PushSpec[];
	references: Map<string, PushReference[]>;
}

interface AggregatedPushFailure {
	productName: string;
	errors: string[];
}

const FEATURE_SPEC_SUFFIX = ".feature.yaml";
const FEATURE_SPEC_PREFIX = "features/";
const UNSCOPED_REFS_BUCKET = "";
const IGNORED_REF_DIRS = new Set([
	".git",
	"node_modules",
	"coverage",
	"dist",
	"tmp",
	".agents",
	"states",
]);
const TEST_PATH_SEGMENTS = new Set(["test", "tests", "__tests__"]);
const REF_SCAN_EXCLUDED_SUFFIXES = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".ico",
	".pdf",
	".zip",
	".gz",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".wasm",
	".bin",
]);
const FULL_ACID_PATTERN =
	/\b([A-Za-z0-9_-]+\.[A-Z][A-Z0-9_-]*\.[0-9]+(?:-[0-9]+)?)\b/g;

// push.MAIN.7 / push.MAIN.8 / push.SCAN.3 / push.SAFETY.2
export async function planPush(
	options: PushCommandOptions = {},
): Promise<PushPlan> {
	const cwd = options.cwd ?? process.cwd();
	const runner = options.runner;
	const repoRoot = await readGitRepoRoot({ cwd, runner });
	const [gitContext, scan] = await Promise.all([
		readGitPushContext({ cwd: repoRoot, runner }),
		scanPushRepo({
			cwd: repoRoot,
			runner,
			featureNames: options.featureNames,
			repoRoot,
		}),
	]);

	const payloads = buildPushPayloads(scan, {
		...gitContext,
		featureNames: options.featureNames,
		product: options.product,
		target: options.target,
		parent: options.parent,
	});

	return { ...gitContext, payloads };
}

// push.SCAN.1 / push.SCAN.3 / push.SCAN.5 / push.SCAN.5-1 / push.MAIN.8
export async function scanPushRepo(
	options: {
		cwd?: string;
		runner?: GitCommandRunner;
		featureNames?: string[];
		repoRoot?: string;
	} = {},
): Promise<PushScanResult> {
	const cwd = options.cwd ?? process.cwd();
	const runner = options.runner;
	const featureFilter = normalizeFeatureFilter(options.featureNames);
	const repoRoot = options.repoRoot ?? (await readGitRepoRoot({ cwd, runner }));
	const filePaths = await listRepoFiles(repoRoot);

	const specs: DiscoveredPushSpec[] = [];
	for (const relativePath of filePaths) {
		if (!isFeatureSpecPath(relativePath)) continue;

		const spec = await parseFeatureSpecFile(repoRoot, relativePath, runner);
		if (
			featureFilter !== undefined &&
			!featureFilter.has(spec.spec.feature.name)
		)
			continue;

		specs.push(spec);
	}

	const references = await scanPushReferences(
		repoRoot,
		filePaths,
		featureFilter,
	);
	return { specs, references };
}

// push.SCAN.1 / push.SCAN.5 / push.SCAN.5-1
export async function parseFeatureSpecFile(
	cwd: string,
	relativePath: string,
	runner?: GitCommandRunner,
): Promise<DiscoveredPushSpec> {
	const absolutePath = joinPath(cwd, relativePath);
	const raw = await Bun.file(absolutePath).text();
	const parsed = parseFeatureDocument(raw, relativePath);
	const lastSeenCommit = await resolveSpecLastSeenCommit(
		cwd,
		relativePath,
		runner,
	);
	parsed.spec.meta.last_seen_commit = lastSeenCommit;

	return {
		featureName: parsed.spec.feature.name,
		productName: parsed.spec.feature.product,
		path: relativePath,
		lastSeenCommit,
		spec: parsed.spec,
	};
}

async function resolveSpecLastSeenCommit(
	cwd: string,
	relativePath: string,
	runner?: GitCommandRunner,
): Promise<string> {
	const lastSeenCommit = await readGitFileLastSeenCommit(relativePath, {
		cwd,
		runner,
	});
	if (lastSeenCommit) return lastSeenCommit;

	return readGitCommitHash({ cwd, runner });
}

// push.SCAN.2 / push.SCAN.4 / push.UX.2
export async function scanPushReferences(
	cwd: string,
	filePaths: string[],
	featureFilter?: Set<string>,
): Promise<DiscoveredPushReference[]> {
	const references: DiscoveredPushReference[] = [];

	for (const relativePath of filePaths) {
		if (!shouldScanForReferences(relativePath)) continue;

		const absolutePath = joinPath(cwd, relativePath);
		const text = await Bun.file(absolutePath).text();
		const seen = new Set<string>();

		for (const match of text.matchAll(FULL_ACID_PATTERN)) {
			const acid = match[1];
			if (!acid || seen.has(acid)) continue;

			const featureName = acid.split(".", 1)[0] ?? "";
			if (!featureName) continue;
			if (featureFilter !== undefined && !featureFilter.has(featureName))
				continue;

			seen.add(acid);
			references.push({
				featureName,
				acid,
				path: `${relativePath}:${getLineNumberForMatch(text, match.index)}`,
				isTest: isTestPath(relativePath),
			});
		}
	}

	references.sort((left, right) => compareReferenceEntries(left, right));
	return references;
}

function getLineNumberForMatch(
	text: string,
	index: number | undefined,
): number {
	if (index === undefined || index <= 0) return 1;

	let line = 1;
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (text[cursor] === "\n") line += 1;
	}

	return line;
}

// push.MAIN.2 / push.MAIN.3 / push.MAIN.4 / push.MAIN.5 / push.MAIN.6 / push.UX.1
export function normalizePushOptions(
	options: PushCommandOptions,
): NormalizedPushOptions {
	if (options.product?.startsWith("-")) {
		throw usageError("Missing value for --product.");
	}

	if (options.target?.startsWith("-")) {
		throw usageError("Missing value for --target.");
	}

	if (options.parent?.startsWith("-")) {
		throw usageError("Missing value for --parent.");
	}

	const featureNames = options.featureNames ?? [];
	for (const featureName of featureNames) {
		if (featureName.startsWith("-")) {
			throw usageError("Missing value for a push feature name.");
		}
	}

	return {
		featureNames,
		all: options.all ?? false,
		product: options.product,
		target: options.target,
		parent: options.parent,
		json: options.json ?? false,
	};
}

// push.API.1 / push.API.4 / push.OUTPUT.1 / push.OUTPUT.2 / push.OUTPUT.3 / push.OUTPUT.4 / push.OUTPUT.5 / push.SAFETY.3
export async function runPushCommand(
	apiClient: ApiClient,
	options: NormalizedPushOptions,
	dependencies: {
		cwd?: string;
		runner?: GitCommandRunner;
	} = {},
	plan?: PushPlan,
): Promise<CommandResult> {
	const resolvedPlan =
		plan ??
		(await planPush({
			cwd: dependencies.cwd,
			runner: dependencies.runner,
			featureNames: options.all ? undefined : options.featureNames,
			product: options.product,
			target: options.target,
			parent: options.parent,
		}));

	const settledResults: PromiseSettledResult<
		Awaited<ReturnType<ApiClient["push"]>>
	>[] = [];
	for (const payload of resolvedPlan.payloads) {
		try {
			const data = await apiClient.push(payload);
			settledResults.push({ status: "fulfilled", value: data });
		} catch (error) {
			settledResults.push({ status: "rejected", reason: error });
		}
	}

	const successes: PushSuccessSummary[] = [];
	const failures: PushFailureSummary[] = [];

	settledResults.forEach((result, index) => {
		const payloadForIndex = resolvedPlan.payloads[index]!;

		if (result.status === "fulfilled") {
			const data = result.value.data;
			successes.push({
				productName:
					data.product_name ??
					payloadForIndex.product_name ??
					"unknown-product",
				implementationName: data.implementation_name ?? null,
				specsCreated: data.specs_created ?? 0,
				specsUpdated: data.specs_updated ?? 0,
				refsPushed: countPayloadReferences(payloadForIndex),
				warnings: data.warnings ?? [],
			});
			return;
		}

		failures.push({
			productName: payloadForIndex.product_name ?? "unknown-product",
			error:
				result.reason instanceof Error
					? result.reason.message
					: "Push request failed.",
		});
	});

	const payload: PushCommandPayload = {
		repoUri: resolvedPlan.repoUri,
		branchName: resolvedPlan.branchName,
		commitHash: resolvedPlan.commitHash,
		results: aggregatePushSuccesses(successes),
		failures: aggregatePushFailures(failures),
	};

	const textLines = formatPushTextResult(payload);
	const diagnostics = failures.map(
		(failure) => `Push failed for ${failure.productName}: ${failure.error}`,
	);

	return {
		exitCode: failures.length > 0 ? 1 : 0,
		stdoutLines: textLines,
		stderrLines: options.json
			? diagnostics.concat(
					payload.results.flatMap((result) =>
						result.warnings.map(
							(warning) => `Warning for ${result.productName}: ${warning}`,
						),
					),
				)
			: [],
		jsonPayload: options.json ? payload : undefined,
	};
}

function formatPushTextResult(payload: PushCommandPayload): string[] {
	const lines: string[] = [];

	for (const result of payload.results) {
		lines.push(`Product: ${result.productName}`);
		if (result.implementationName) {
			lines.push(`Implementation: ${result.implementationName}`);
		}
		lines.push(`Specs created: ${result.specsCreated}`);
		lines.push(`Specs updated: ${result.specsUpdated}`);
		lines.push(`Refs pushed: ${result.refsPushed}`);
		for (const warning of result.warnings) {
			lines.push(`Warning: ${warning}`);
		}
		lines.push("");
	}

	for (const failure of payload.failures) {
		lines.push(`Product: ${failure.productName}`);
		lines.push(`Error: ${failure.error}`);
		lines.push("");
	}

	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	return lines;
}

function aggregatePushSuccesses(
	successes: PushSuccessSummary[],
): PushSuccessSummary[] {
	const merged = new Map<string, PushSuccessSummary>();

	for (const success of successes) {
		const existing = merged.get(success.productName);
		if (!existing) {
			merged.set(success.productName, {
				...success,
				warnings: [...success.warnings],
			});
			continue;
		}

		existing.implementationName =
			existing.implementationName ?? success.implementationName;
		existing.specsCreated += success.specsCreated;
		existing.specsUpdated += success.specsUpdated;
		existing.refsPushed += success.refsPushed;

		for (const warning of success.warnings) {
			if (!existing.warnings.includes(warning)) {
				existing.warnings.push(warning);
			}
		}
	}

	return [...merged.values()].sort((left, right) =>
		left.productName.localeCompare(right.productName),
	);
}

function countPayloadReferences(payload: PushRequest): number {
	if (!payload.references?.data) return 0;
	return Object.values(payload.references.data).reduce(
		(total, refs) => total + refs.length,
		0,
	);
}

function aggregatePushFailures(
	failures: PushFailureSummary[],
): PushFailureSummary[] {
	const merged = new Map<string, AggregatedPushFailure>();

	for (const failure of failures) {
		const existing = merged.get(failure.productName);
		if (!existing) {
			merged.set(failure.productName, {
				productName: failure.productName,
				errors: [failure.error],
			});
			continue;
		}

		if (!existing.errors.includes(failure.error)) {
			existing.errors.push(failure.error);
		}
	}

	return [...merged.values()]
		.sort((left, right) => left.productName.localeCompare(right.productName))
		.map((failure) => ({
			productName: failure.productName,
			error: failure.errors.join("; "),
		}));
}

// push.SCAN.1 / push.SCAN.2 / push.SCAN.5 / push.SCAN.5-1
export function parseFeatureDocument(
	raw: string,
	relativePath: string,
): ParsedFeatureDocument {
	const document = loadYaml(raw);
	if (!document || typeof document !== "object") {
		throw runtimeError(`Invalid feature spec: ${relativePath}`);
	}

	const root = document as Record<string, unknown>;
	const feature = asRecord(
		root.feature,
		`Invalid feature spec: ${relativePath}`,
	);
	const featureName = asString(
		feature.name,
		`Invalid feature spec: ${relativePath}`,
	);
	const productName = asString(
		feature.product,
		`Invalid feature spec: ${relativePath}`,
	);

	const spec: PushSpec = {
		feature: {
			name: featureName,
			product: productName,
			version:
				typeof feature.version === "string" && feature.version.trim()
					? feature.version
					: "1.0.0",
			...(typeof feature.description === "string"
				? { description: feature.description }
				: {}),
			...(Array.isArray(feature.prerequisites)
				? {
						prerequisites: feature.prerequisites.map((value) =>
							asString(value, `Invalid feature spec: ${relativePath}`),
						),
					}
				: {}),
		},
		meta: {
			last_seen_commit: "",
			path: relativePath,
		},
		requirements: {},
	};

	const requirements = new Map<string, PushSpec["requirements"][string]>();
	for (const sectionName of ["components", "constraints"]) {
		const section = root[sectionName];
		if (!section || typeof section !== "object") continue;

		for (const [componentName, componentValue] of Object.entries(
			section as Record<string, unknown>,
		)) {
			const component = asRecord(
				componentValue,
				`Invalid feature spec: ${relativePath}`,
			);
			const requirementValues = asRecord(
				component.requirements,
				`Invalid feature spec: ${relativePath}`,
			);
			const componentDeprecated = component.deprecated === true;
			const notes = collectNotes(requirementValues);

			for (const [requirementId, requirementValue] of Object.entries(
				requirementValues,
			)) {
				if (requirementId.endsWith("-note")) continue;

				const requirement = asRequirementDefinition(
					requirementValue,
					`Invalid feature spec: ${relativePath}`,
				);
				const acid = `${featureName}.${componentName}.${requirementId}`;
				const entry: PushSpec["requirements"][string] = {
					requirement: requirement.requirement,
					deprecated: requirement.deprecated ?? componentDeprecated,
					...((requirement.note ?? notes.get(requirementId))
						? { note: requirement.note ?? notes.get(requirementId) }
						: {}),
					...(requirement.replaced_by
						? { replaced_by: requirement.replaced_by }
						: {}),
				};

				requirements.set(acid, entry);
			}
		}
	}

	const sortedRequirements = [...requirements.entries()].sort(
		([left], [right]) => left.localeCompare(right),
	);
	spec.requirements = Object.fromEntries(sortedRequirements);

	return { spec };
}

// push.MAIN.9 / push.API.2 / push.API.3 / push.SAFETY.2 / push.SAFETY.4 / push.SAFETY.5 / push.UX.2
export function buildPushPayloads(
	scan: PushScanResult,
	options: GitPushContext & {
		featureNames?: string[];
		product?: string;
		target?: string;
		parent?: string;
	},
): PushRequest[] {
	const featureFilter = normalizeFeatureFilter(options.featureNames);
	const specs = featureFilter
		? scan.specs.filter((entry) => featureFilter.has(entry.featureName))
		: [...scan.specs];
	const references = featureFilter
		? scan.references.filter((entry) => featureFilter.has(entry.featureName))
		: [...scan.references];

	const featureToProducts = new Map<string, Set<string>>();
	for (const spec of specs) {
		const products =
			featureToProducts.get(spec.featureName) ?? new Set<string>();
		products.add(spec.productName);
		featureToProducts.set(spec.featureName, products);
	}

	const buckets = new Map<string, ProductBucket>();
	const ensureBucket = (productName: string): ProductBucket => {
		const existing = buckets.get(productName);
		if (existing) return existing;
		const created: ProductBucket = { specs: [], references: new Map() };
		buckets.set(productName, created);
		return created;
	};

	for (const spec of specs) {
		ensureBucket(spec.productName).specs.push(spec.spec);
	}

	const explicitProduct = options.product?.trim() || undefined;
	if (explicitProduct) ensureBucket(explicitProduct);

	for (const reference of references) {
		const matchedProducts = featureToProducts.get(reference.featureName);
		if (matchedProducts && matchedProducts.size > 0) {
			for (const productName of matchedProducts) {
				pushReferenceToBucket(ensureBucket(productName), reference);
			}
			continue;
		}

		if (!explicitProduct) {
			pushReferenceToBucket(ensureBucket(UNSCOPED_REFS_BUCKET), reference);
			continue;
		}

		pushReferenceToBucket(ensureBucket(explicitProduct), reference);
	}

	for (const [productName, bucket] of buckets) {
		if (bucket.specs.length > 0 || bucket.references.size === 0) continue;

		if (!productName) continue;

		const scopedTarget = resolveScopedSelector(options.target, productName);
		const scopedParent = resolveScopedSelector(options.parent, productName);
		if ((scopedTarget && !scopedParent) || (!scopedTarget && scopedParent)) {
			throw usageError(
				"Refs-only pushes require --product, --target, and --parent together.",
			);
		}
	}

	const payloads: PushRequest[] = [];
	for (const productName of [...buckets.keys()].sort((left, right) =>
		left.localeCompare(right),
	)) {
		const bucket = buckets.get(productName);
		if (!bucket) continue;

		if (bucket.specs.length === 0 && bucket.references.size === 0) continue;

		const payload: PushRequest = {
			branch_name: options.branchName,
			commit_hash: options.commitHash,
			repo_uri: options.repoUri,
			...(productName ? { product_name: productName } : {}),
			...(bucket.specs.length > 0 ? { specs: sortSpecs(bucket.specs) } : {}),
			...(bucket.references.size > 0
				? {
						references: {
							data: sortReferenceMap(bucket.references),
							override: false,
						},
					}
				: {}),
			...(productName && resolveScopedSelector(options.target, productName)
				? {
						target_impl_name: resolveScopedSelector(
							options.target,
							productName,
						),
					}
				: {}),
			...(productName && resolveScopedSelector(options.parent, productName)
				? {
						parent_impl_name: resolveScopedSelector(
							options.parent,
							productName,
						),
					}
				: {}),
		};

		payloads.push(payload);
	}

	return payloads;
}

async function listRepoFiles(cwd: string): Promise<string[]> {
	return walkFiles(cwd, cwd);
}

async function walkFiles(root: string, directory: string): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	const { join, relative } = await import("node:path");
	const collected: string[] = [];

	const queue = [directory];
	while (queue.length > 0) {
		const current = queue.shift()!;
		let dirEntries;
		try {
			dirEntries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		dirEntries.sort((left, right) => left.name.localeCompare(right.name));

		for (const entry of dirEntries) {
			if (entry.isDirectory()) {
				if (IGNORED_REF_DIRS.has(entry.name)) continue;
				queue.push(join(current, entry.name));
				continue;
			}

			if (!entry.isFile()) continue;
			const relativePath = relative(root, join(current, entry.name))
				.split("\\")
				.join("/");
			collected.push(relativePath);
		}
	}

	collected.sort((left, right) => left.localeCompare(right));
	return collected;
}

function parseFeatureDocumentInternal(
	raw: string,
	relativePath: string,
): ParsedFeatureDocument {
	const document = loadYaml(raw);
	if (!document || typeof document !== "object") {
		throw runtimeError(`Invalid feature spec: ${relativePath}`);
	}

	const root = document as Record<string, unknown>;
	const feature = asRecord(
		root.feature,
		`Invalid feature spec: ${relativePath}`,
	);
	const featureName = asString(
		feature.name,
		`Invalid feature spec: ${relativePath}`,
	);
	const productName = asString(
		feature.product,
		`Invalid feature spec: ${relativePath}`,
	);

	const spec: PushSpec = {
		feature: {
			name: featureName,
			product: productName,
			version:
				typeof feature.version === "string" && feature.version.trim()
					? feature.version
					: "1.0.0",
			...(typeof feature.description === "string"
				? { description: feature.description }
				: {}),
			...(Array.isArray(feature.prerequisites)
				? {
						prerequisites: feature.prerequisites.map((value) =>
							asString(value, `Invalid feature spec: ${relativePath}`),
						),
					}
				: {}),
		},
		meta: {
			last_seen_commit: "",
			path: relativePath,
		},
		requirements: {},
	};

	const requirements = new Map<string, PushSpec["requirements"][string]>();
	for (const sectionName of ["components", "constraints"]) {
		const section = root[sectionName];
		if (!section || typeof section !== "object") continue;

		for (const [componentName, componentValue] of Object.entries(
			section as Record<string, unknown>,
		)) {
			const component = asRecord(
				componentValue,
				`Invalid feature spec: ${relativePath}`,
			);
			const requirementValues = asRecord(
				component.requirements,
				`Invalid feature spec: ${relativePath}`,
			);
			const componentDeprecated = component.deprecated === true;
			const notes = collectNotes(requirementValues);

			for (const [requirementId, requirementValue] of Object.entries(
				requirementValues,
			)) {
				if (requirementId.endsWith("-note")) continue;

				const requirement = asRequirementDefinition(
					requirementValue,
					`Invalid feature spec: ${relativePath}`,
				);
				const acid = `${featureName}.${componentName}.${requirementId}`;
				const entry: PushSpec["requirements"][string] = {
					requirement: requirement.requirement,
					deprecated: requirement.deprecated ?? componentDeprecated,
					...((requirement.note ?? notes.get(requirementId))
						? { note: requirement.note ?? notes.get(requirementId) }
						: {}),
					...(requirement.replaced_by
						? { replaced_by: requirement.replaced_by }
						: {}),
				};

				requirements.set(acid, entry);
			}
		}
	}

	const sortedRequirements = [...requirements.entries()].sort(
		([left], [right]) => left.localeCompare(right),
	);
	spec.requirements = Object.fromEntries(sortedRequirements);

	return { spec };
}

function collectNotes(
	requirementValues: Record<string, unknown>,
): Map<string, string> {
	const notes = new Map<string, string>();

	for (const [key, value] of Object.entries(requirementValues)) {
		const noteMatch = key.match(/^(.*)-note$/);
		if (!noteMatch) continue;
		if (typeof value !== "string") continue;
		notes.set(noteMatch[1]!, value);
	}

	return notes;
}

function asRecord(value: unknown, message: string): Record<string, any> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw runtimeError(message);
	}

	return value as Record<string, any>;
}

function asString(value: unknown, message: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw runtimeError(message);
	}

	return value;
}

function asRequirementDefinition(
	value: unknown,
	message: string,
): {
	requirement: string;
	deprecated?: boolean;
	note?: string;
	replaced_by?: string[];
} {
	if (typeof value === "string") {
		return { requirement: value };
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw runtimeError(message);
	}

	const record = value as Record<string, unknown>;
	const requirement = asString(record.requirement, message);

	return {
		requirement,
		...(typeof record.deprecated === "boolean"
			? { deprecated: record.deprecated }
			: {}),
		...(typeof record.note === "string" ? { note: record.note } : {}),
		...(Array.isArray(record.replaced_by)
			? {
					replaced_by: record.replaced_by.map((entry) =>
						asString(entry, message),
					),
				}
			: Array.isArray(record.replacements)
				? {
						replaced_by: record.replacements.map((entry) =>
							asString(entry, message),
						),
					}
				: {}),
	};
}

function isFeatureSpecPath(relativePath: string): boolean {
	return (
		relativePath.startsWith(FEATURE_SPEC_PREFIX) &&
		relativePath.endsWith(FEATURE_SPEC_SUFFIX)
	);
}

function shouldScanForReferences(relativePath: string): boolean {
	if (isFeatureSpecPath(relativePath)) return false;
	if (relativePath.split("/").some((segment) => IGNORED_REF_DIRS.has(segment)))
		return false;

	const lower = relativePath.toLowerCase();
	return ![...REF_SCAN_EXCLUDED_SUFFIXES].some((suffix) =>
		lower.endsWith(suffix),
	);
}

function isTestPath(relativePath: string): boolean {
	const normalized = relativePath.split("\\").join("/");
	const segments = normalized.split("/");
	if (segments.some((segment) => TEST_PATH_SEGMENTS.has(segment))) return true;
	return /(^|\.)(test|spec)\.[^.]+$/i.test(segments[segments.length - 1] ?? "");
}

function compareReferenceEntries(
	left: DiscoveredPushReference,
	right: DiscoveredPushReference,
): number {
	return (
		left.featureName.localeCompare(right.featureName) ||
		left.acid.localeCompare(right.acid) ||
		left.path.localeCompare(right.path) ||
		Number(right.isTest) - Number(left.isTest)
	);
}

function pushReferenceToBucket(
	bucket: ProductBucket,
	reference: DiscoveredPushReference,
): void {
	const refs = bucket.references.get(reference.acid) ?? [];
	refs.push({ path: reference.path, is_test: reference.isTest });
	bucket.references.set(reference.acid, refs);
}

function sortSpecs(specs: PushSpec[]): PushSpec[] {
	return [...specs].sort((left, right) => {
		return (
			left.meta.path.localeCompare(right.meta.path) ||
			left.feature.name.localeCompare(right.feature.name) ||
			left.feature.product.localeCompare(right.feature.product)
		);
	});
}

function sortReferenceMap(
	referenceMap: Map<string, PushReference[]>,
): Record<string, PushReference[]> {
	const sortedEntries = [...referenceMap.entries()].sort(([left], [right]) =>
		left.localeCompare(right),
	);
	const result: Record<string, PushReference[]> = {};

	for (const [acid, refs] of sortedEntries) {
		result[acid] = [...refs].sort(
			(left, right) =>
				left.path.localeCompare(right.path) ||
				Number(left.is_test) - Number(right.is_test),
		);
	}

	return result;
}

function resolveScopedSelector(
	value: string | undefined,
	productName: string,
): string | undefined {
	if (!value) return undefined;

	const slashIndex = value.indexOf("/");
	if (slashIndex <= 0) return value;

	const scopedProduct = value.slice(0, slashIndex);
	const scopedValue = value.slice(slashIndex + 1);
	if (scopedProduct !== productName || !scopedValue) return undefined;
	return scopedValue;
}

function normalizeFeatureFilter(
	featureNames?: string[],
): Set<string> | undefined {
	const names = featureNames
		?.map((entry) => entry.trim())
		.filter((entry): entry is string => entry.length > 0);
	if (!names || names.length === 0) return undefined;
	return new Set(names);
}

function joinPath(left: string, right: string): string {
	return left.endsWith("/") ? `${left}${right}` : `${left}/${right}`;
}
