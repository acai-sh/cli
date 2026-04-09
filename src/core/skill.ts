import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommandResult } from "./output.ts";

import canonicalSkillContent from "../../.agents/skills/acai/SKILL.md" with {
	type: "text",
};

export interface SkillArgs {
	install: boolean;
}

export interface SkillCommandOptions {
	install?: boolean;
}

export interface SkillDependencies {
	cwd?: string;
	createDirectory?: typeof mkdir;
	writeFile?: typeof writeFile;
}

const SKILL_INSTALL_PATH_SEGMENTS = [".agents", "skills", "acai", "SKILL.md"];

// skill.MAIN.2 / skill.SAFETY.3
export function getCanonicalSkillContent(): string {
	return canonicalSkillContent;
}

// skill.MAIN.4
export function normalizeSkillOptions(
	options: SkillCommandOptions = {},
): SkillArgs {
	return {
		install: options.install ?? false,
	};
}

// skill.WRITE.1
export function resolveSkillInstallPath(cwd: string): string {
	return join(cwd, ...SKILL_INSTALL_PATH_SEGMENTS);
}

// skill.WRITE.2
export async function installSkill(
	cwd: string,
	dependencies: Omit<SkillDependencies, "cwd"> = {},
): Promise<string> {
	const destination = resolveSkillInstallPath(cwd);
	const createDirectory = dependencies.createDirectory ?? mkdir;
	const writeSkillFile = dependencies.writeFile ?? writeFile;

	await createDirectory(dirname(destination), { recursive: true });
	// skill.WRITE.3 skill.SAFETY.3
	await writeSkillFile(destination, getCanonicalSkillContent());

	return destination;
}

// skill.MAIN.1
export async function runSkillCommand(
	args: SkillArgs,
	dependencies: SkillDependencies = {},
): Promise<CommandResult> {
	if (args.install) {
		// skill.MAIN.3 skill.UX.2
		await installSkill(dependencies.cwd ?? process.cwd(), dependencies);
		return { exitCode: 0 };
	}

	// skill.SAFETY.1 skill.UX.1
	return {
		exitCode: 0,
		stdoutText: getCanonicalSkillContent(),
	};
}
