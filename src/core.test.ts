import { describe, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createApiClient } from "./core/api.ts";
import { resolveApiConfig } from "./core/config.ts";
import { runCli } from "./core/cli.ts";
import {
    writeJsonResult,
    writeRawTextResult,
    writeTextResult,
} from "./core/output.ts";
import { getCanonicalSkillContent } from "./core/skill.ts";
import { normalizeRepoUri, readGitContext } from "./core/git.ts";
import {
    normalizeFeaturesOptions,
    runFeaturesCommand,
} from "./core/features.ts";
import {
    buildFeatureContextResponse,
    buildImplementationFeatureEntry,
    buildImplementationFeaturesResponse,
    buildImplementationsResponse,
} from "../test/support/fixtures.ts";
import { createMockApiServer } from "../test/support/mock-api.ts";

function readWrites(writer: { mock: { calls: unknown[][] } }): string {
    return (writer.mock.calls as Array<[string]>)
        .map(([text]) => text)
        .join("");
}

describe("cli-core.CONFIG.1 cli-core.AUTH.2", () => {
    test("cli-core.CONFIG.1 defaults the API base URL to the hosted acai.sh endpoint", () => {
        const config = resolveApiConfig({ ACAI_API_TOKEN: "secret" });
        expect(config).toEqual({
            baseUrl: "https://app.acai.sh/api/v1",
            token: "secret",
        });
    });

    test("resolves API base URL and bearer token from env", () => {
        const config = resolveApiConfig({
            ACAI_API_BASE_URL: "https://api.example.test",
            ACAI_API_TOKEN: "secret",
        });
        expect(config).toEqual({
            baseUrl: "https://api.example.test",
            token: "secret",
        });
    });

    test("cli-core.CONFIG.2 fails when API bearer token configuration is missing", () => {
        expect(() => resolveApiConfig({})).toThrow(
            "Missing API bearer token configuration.",
        );
    });
});

describe("cli-core.DIST.1 cli-core.DIST.2 cli-core.DIST.3", () => {
    test("package and release workflow define npm publishing with provenance and GitHub Release binaries", async () => {
        const packageJson = JSON.parse(
            await readFile(new URL("../package.json", import.meta.url), "utf8"),
        );
        const ciWorkflow = await readFile(
            new URL("../.github/workflows/ci.yml", import.meta.url),
            "utf8",
        );
        const releaseWorkflow = await readFile(
            new URL("../.github/workflows/release.yml", import.meta.url),
            "utf8",
        );
        const npmArtifactVerification = await readFile(
            new URL("../scripts/verify-npm-artifact.mjs", import.meta.url),
            "utf8",
        );
        const releaseDocs = await readFile(
            new URL("../docs/releasing.md", import.meta.url),
            "utf8",
        );
        const cliEntrypoint = await readFile(
            new URL("./index.ts", import.meta.url),
            "utf8",
        );
        const gitRuntime = await readFile(
            new URL("./core/git.ts", import.meta.url),
            "utf8",
        );
        const pushRuntime = await readFile(
            new URL("./core/push.ts", import.meta.url),
            "utf8",
        );
        const setStatusRuntime = await readFile(
            new URL("./core/set-status.ts", import.meta.url),
            "utf8",
        );

        expect(packageJson.name).toBe("@acai.sh/cli");
        expect(packageJson.files).toEqual(["dist", "README.md", "docs"]);
        expect(packageJson.bin).toEqual({ acai: "dist/acai.js" });
        expect(packageJson.scripts["build:npm"]).toContain(
            "bun build ./src/index.ts --target=node --outfile dist/acai.js",
        );
        expect(packageJson.scripts["verify:npm-artifact"]).toBe(
            "node ./scripts/verify-npm-artifact.mjs",
        );
        expect(packageJson.scripts.prepack).toBe("bun run build:npm");
        expect(packageJson.scripts["build:release:linux-x64"]).toContain(
            "--compile",
        );
        expect(packageJson.scripts["build:release:darwin-arm64"]).toContain(
            "--compile",
        );
        expect(cliEntrypoint.startsWith("#!/usr/bin/env node")).toBe(true);
        expect(cliEntrypoint).not.toContain("Bun.");
        expect(gitRuntime).not.toContain("Bun.");
        expect(pushRuntime).not.toContain("Bun.");
        expect(setStatusRuntime).not.toContain("Bun.");

        expect(ciWorkflow).toContain("name: CI");
        expect(ciWorkflow).toContain("branches:");
        expect(ciWorkflow).toContain("- main");
        expect(ciWorkflow).toContain("pull_request:");
        expect(ciWorkflow).toContain("test-and-build:");
        expect(ciWorkflow).toContain("AGENT=1 bun test");
        expect(ciWorkflow).toContain("bun run build:npm");
        expect(ciWorkflow).toContain("verify-npm-artifact:");
        expect(ciWorkflow).toContain(
            "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
        );
        expect(ciWorkflow).toContain("actions/setup-node@v4");
        expect(ciWorkflow).toContain("bun run verify:npm-artifact");

        expect(releaseWorkflow).toContain("id-token: write");
        expect(releaseWorkflow).toContain("Verify tag matches package version");
        expect(releaseWorkflow).toContain("actions/setup-node@v4");
        expect(releaseWorkflow).toContain("Verify packed npm artifact under real Node");
        expect(releaseWorkflow).toContain("bun run verify:npm-artifact");
        expect(releaseWorkflow).toContain("npm publish --provenance");
        expect(releaseWorkflow).toContain("--tag next");
        expect(releaseWorkflow).toContain("cli-core.DIST.1");
        expect(releaseWorkflow).toContain("cli-core.DIST.2 / cli-core.DIST.3");
        expect(releaseWorkflow).toContain("softprops/action-gh-release@v2");
        expect(releaseWorkflow).toContain("SHA256SUMS.txt");
        expect(npmArtifactVerification).toContain("bun-node-fallback-bin");
        expect(npmArtifactVerification).toContain('"npm", ["pack", "--pack-destination", packDir]');
        expect(npmArtifactVerification).toContain('"npm", ["install", "--no-package-lock", tarballPath]');
        expect(npmArtifactVerification).toContain("npm pack did not report a tarball filename");
        expect(npmArtifactVerification).toContain("assertCommandSucceeded(result, \"npm pack\")");
        expect(npmArtifactVerification).toContain('"node_modules", ".bin", "acai"');
        expect(npmArtifactVerification).toContain("runInstalledCli(binPath");
        expect(npmArtifactVerification).toContain("cli-core.DIST.1 verification requires a real Node runtime");
        expect(releaseDocs).toContain("bun run verify:npm-artifact");
        expect(releaseDocs).toContain("real Node runtime");
    });
});

describe("API client behavior", () => {
    test("cli-core.AUTH.1 applies bearer auth on outgoing API requests", async () => {
        const server = createMockApiServer((request) => {
            expect(request.headers.get("authorization")).toBe("Bearer secret");
            expect(new URL(request.url).searchParams.get("product_name")).toBe(
                "example-product",
            );
            return Response.json(buildImplementationsResponse());
        });

        try {
            const client = createApiClient({
                baseUrl: server.url.toString(),
                token: "secret",
            });

            await expect(
                client.listImplementations({ productName: "example-product" }),
            ).resolves.toMatchObject({
                data: { product_name: "example-product" },
            });
        } finally {
            server.stop();
        }
    });

    test("feature.MAIN.2-1 sends GET /implementations requests without product_name when product is unknown", async () => {
        const get = mock(
            async (path: string, options: Record<string, unknown>) => {
                expect(path).toBe("/implementations");
                expect(options).toMatchObject({
                    params: {
                        query: {
                            repo_uri: "github.com/my-org/my-repo",
                            branch_name: "main",
                            feature_name: "feature",
                        },
                    },
                });
                expect(
                    (options as { params: { query: Record<string, unknown> } })
                        .params.query,
                ).not.toHaveProperty("product_name");

                return {
                    data: buildImplementationsResponse({
                        data: {
                            product_name: undefined,
                            implementations: [
                                {
                                    implementation_id: "impl-1",
                                    implementation_name: "main",
                                    product_name: "example-product",
                                },
                            ],
                        },
                    }),
                };
            },
        );

        const client = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: get,
                    POST: mock(async () => {
                        throw new Error("unexpected");
                    }),
                } as never,
            },
        );

        await expect(
            client.listImplementations({
                repoUri: "github.com/my-org/my-repo",
                branchName: "main",
                featureName: "feature",
            }),
        ).resolves.toEqual(
            buildImplementationsResponse({
                data: {
                    product_name: undefined,
                    implementations: [
                        {
                            implementation_id: "impl-1",
                            implementation_name: "main",
                            product_name: "example-product",
                        },
                    ],
                },
            }),
        );
    });

    test("normalizes network failures", async () => {
        const get = mock(async () => {
            throw new Error("network down");
        });

        const client = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: get,
                    POST: mock(async () => {
                        throw new Error("unexpected");
                    }),
                } as never,
            },
        );

        await expect(
            client.listImplementationFeatures({
                productName: "example-product",
                implementationName: "main",
            }),
        ).rejects.toThrow("API request failed.");
    });

    test("cli-core.ERRORS.6 normalizes empty API responses", async () => {
        const get = mock(async () => ({
            data: undefined,
            error: undefined,
            response: undefined,
        }));

        const client = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: get,
                    POST: mock(async () => {
                        throw new Error("unexpected");
                    }),
                } as never,
            },
        );

        await expect(
            client.listImplementations({ productName: "example-product" }),
        ).rejects.toThrow(
            "API request failed. Check ACAI_API_BASE_URL and that the server is reachable.",
        );
    });

    test("surfaces API detail messages", async () => {
        const get = mock(async () => ({
            data: undefined,
            error: { errors: { detail: "detail from api" } },
            response: { status: 422 },
        }));

        const client = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: get,
                    POST: mock(async () => {
                        throw new Error("unexpected");
                    }),
                } as never,
            },
        );

        await expect(
            client.listImplementations({ productName: "example-product" }),
        ).rejects.toThrow("detail from api");
    });

    test("feature.API.1 normalizes feature-context API detail failures", async () => {
        const get = mock(async () => ({
            data: undefined,
            error: { errors: { detail: "feature detail" } },
            response: { status: 404 },
        }));

        const client = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: get,
                    POST: mock(async () => {
                        throw new Error("unexpected");
                    }),
                } as never,
            },
        );

        await expect(
            client.getFeatureContext({
                productName: "example-product",
                featureName: "feature",
                implementationName: "main",
            }),
        ).rejects.toThrow("feature detail");
    });

    test("feature.API.1 sends GET /feature-context requests", async () => {
        const get = mock(
            async (path: string, options: Record<string, unknown>) => {
                expect(path).toBe("/feature-context");
                expect(options).toMatchObject({
                    params: {
                        query: {
                            product_name: "example-product",
                            feature_name: "feature",
                            implementation_name: "main",
                            include_refs: true,
                            statuses: ["completed"],
                        },
                    },
                });

                return { data: buildFeatureContextResponse() };
            },
        );

        const client = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: get,
                    POST: mock(async () => {
                        throw new Error("unexpected");
                    }),
                } as never,
            },
        );

        await expect(
            client.getFeatureContext({
                productName: "example-product",
                featureName: "feature",
                implementationName: "main",
                includeRefs: true,
                statuses: ["completed"],
            }),
        ).resolves.toEqual(buildFeatureContextResponse());
    });

    test("push.API.1 sends POST /push requests and normalizes push errors", async () => {
        const post = mock(
            async (path: string, options: Record<string, unknown>) => {
                expect(path).toBe("/push");
                expect(options.body).toMatchObject({
                    product_name: "example-product",
                });
                return {
                    data: {
                        product_name: "example-product",
                        implementation_name: "main",
                        specs_created: 1,
                        specs_updated: 0,
                        warnings: [],
                    },
                };
            },
        );

        const client = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: mock(async () => {
                        throw new Error("unexpected");
                    }),
                    POST: post,
                } as never,
            },
        );

        await expect(
            client.push({
                branch_name: "main",
                commit_hash: "c1",
                repo_uri: "github.com/my-org/my-repo",
                product_name: "example-product",
            }),
        ).resolves.toMatchObject({
            product_name: "example-product",
            implementation_name: "main",
        });

        const errorPost = mock(async () => ({
            data: undefined,
            error: { errors: { detail: "push detail" } },
            response: { status: 422 },
        }));

        const errorClient = createApiClient(
            { baseUrl: "https://api.example.test", token: "secret" },
            {
                client: {
                    GET: mock(async () => {
                        throw new Error("unexpected");
                    }),
                    POST: errorPost,
                } as never,
            },
        );

        await expect(
            errorClient.push({
                branch_name: "main",
                commit_hash: "c1",
                repo_uri: "github.com/my-org/my-repo",
                product_name: "example-product",
            }),
        ).rejects.toThrow("push detail");
    });
});

describe("cli-core.OUTPUT.1 cli-core.OUTPUT.2", () => {
    test("routes json payload to stdout and diagnostics to stderr", async () => {
        const stdout = { write: mock(() => {}) };
        const stderr = { write: mock(() => {}) };

        await writeJsonResult({ stdout, stderr }, { ok: true }, ["warn"]);

        expect(stderr.write).toHaveBeenCalledWith("warn\n");
        expect(stdout.write).toHaveBeenCalledWith('{"ok":true}\n');
    });

    test("routes text payload to stdout and diagnostics to stderr", async () => {
        const stdout = { write: mock(() => {}) };
        const stderr = { write: mock(() => {}) };

        await writeTextResult(
            { stdout, stderr },
            ["line one", "line two"],
            ["diag"],
        );

        expect(stderr.write).toHaveBeenCalledWith("diag\n");
        expect(stdout.write).toHaveBeenCalledWith("line one\n");
        expect(stdout.write).toHaveBeenCalledWith("line two\n");
    });

    test("skill.UX.1 preserves raw text bytes without appending a newline", async () => {
        const stdout = { write: mock(() => {}) };
        const stderr = { write: mock(() => {}) };

        await writeRawTextResult({ stdout, stderr }, "line one\nline two");

        expect(stderr.write).not.toHaveBeenCalled();
        expect(stdout.write).toHaveBeenCalledWith("line one\nline two");
    });
});

describe("features command targeting", () => {
    test("features.MAIN.2 features.MAIN.3 normalize direct selectors into features args", () => {
        expect(
            normalizeFeaturesOptions({
                product: "example-product",
                impl: "main",
                status: ["todo", "doing"],
                changedSinceCommit: "abc123",
                json: true,
            }),
        ).toEqual({
            productName: "example-product",
            implementationName: "main",
            implementationFilter: undefined,
            statuses: ["todo", "doing"],
            changedSinceCommit: "abc123",
            json: true,
        });
    });

    test("features.MAIN.4 features.MAIN.5 normalize repeated statuses and changed-since filters", () => {
        expect(
            normalizeFeaturesOptions({
                product: "example-product",
                impl: "main",
                status: ["todo", "doing"],
                changedSinceCommit: "abc123",
                json: true,
            }),
        ).toEqual({
            productName: "example-product",
            implementationName: "main",
            implementationFilter: undefined,
            statuses: ["todo", "doing"],
            changedSinceCommit: "abc123",
            json: true,
        });
    });

    test("features.MAIN.4 features.MAIN.5 reject missing filter values", () => {
        expect(() =>
            normalizeFeaturesOptions({
                status: ["-bad"],
            }),
        ).toThrow("Missing value for --status.");
        expect(() =>
            normalizeFeaturesOptions({
                changedSinceCommit: "-bad",
            }),
        ).toThrow("Missing value for --changed-since-commit.");
    });

    test("features.MAIN.2-1 features.MAIN.3 resolves product from a namespaced implementation selector", () => {
        expect(
            normalizeFeaturesOptions({
                impl: "example-product/main",
            }),
        ).toEqual({
            productName: "example-product",
            implementationName: "main",
            implementationFilter: undefined,
            statuses: [],
            changedSinceCommit: undefined,
            json: false,
        });
    });

    test("features.MAIN.2-1 features.MAIN.3 treats omitted-product --impl as a discovery filter", () => {
        expect(
            normalizeFeaturesOptions({
                impl: "main",
            }),
        ).toEqual({
            productName: undefined,
            implementationName: undefined,
            implementationFilter: "main",
            statuses: [],
            changedSinceCommit: undefined,
            json: false,
        });
    });

    test("cli-core.TARGETING.2 and cli-core.TARGETING.3 normalize git remote context", async () => {
        const context = await readGitContext({
            runner: {
                async run(args) {
                    if (args.join(" ") === "remote get-url origin") {
                        return {
                            exitCode: 0,
                            stdout: "git@github.com:my-org/my-repo.git\n",
                            stderr: "",
                        };
                    }

                    if (args.join(" ") === "branch --show-current") {
                        return { exitCode: 0, stdout: "main\n", stderr: "" };
                    }

                    return { exitCode: 1, stdout: "", stderr: "unexpected" };
                },
            },
        });

        expect(context).toEqual({
            repoUri: "github.com/my-org/my-repo",
            branchName: "main",
        });
        expect(normalizeRepoUri("https://github.com/my-org/my-repo.git")).toBe(
            "github.com/my-org/my-repo",
        );
    });

    test("features.MAIN.2-1 cli-core.TARGETING.2 cli-core.TARGETING.3 resolve one git-derived implementation context", async () => {
        const apiClient = {
            listImplementations: mock(async () =>
                buildImplementationsResponse({
                    data: {
                        implementations: [
                            {
                                implementation_id: "impl-1",
                                implementation_name: "main",
                            },
                        ],
                    },
                }),
            ),
            listImplementationFeatures: mock(async () =>
                buildImplementationFeaturesResponse(),
            ),
        };

        const result = await runFeaturesCommand(
            apiClient as never,
            { productName: "example-product", statuses: [], json: false },
            {
                readGitContext: async () => ({
                    repoUri: "github.com/my-org/my-repo",
                    branchName: "main",
                }),
            },
        );

        expect(result.stdoutLines).toEqual([
            "FEATURE          DONE  REFS  TESTS  SPEC   STATES  LAST_SEEN",
            "---------------  ----  ----  -----  -----  ------  ---------",
            "example-feature  1/3   2     1      local  none    abc123   ",
        ]);
        expect(apiClient.listImplementations).toHaveBeenCalledWith({
            productName: "example-product",
            repoUri: "github.com/my-org/my-repo",
            branchName: "main",
        });
        expect(apiClient.listImplementationFeatures).toHaveBeenCalledWith({
            productName: "example-product",
            implementationName: "main",
            statuses: undefined,
            changedSinceCommit: undefined,
        });
    });

    test("features.MAIN.2-1 cli-core.TARGETING.3 narrows omitted-product discovery with an --impl filter before listing features", async () => {
        const apiClient = {
            listImplementations: mock(async () =>
                buildImplementationsResponse({
                    data: {
                        product_name: undefined,
                        implementations: [
                            {
                                implementation_id: "impl-1",
                                implementation_name: "main",
                                product_name: "product-a",
                            },
                            {
                                implementation_id: "impl-2",
                                implementation_name: "preview",
                                product_name: "product-b",
                            },
                        ],
                    },
                }),
            ),
            listImplementationFeatures: mock(async () =>
                buildImplementationFeaturesResponse({
                    data: {
                        product_name: "product-a",
                        implementation_name: "main",
                    },
                }),
            ),
        };

        await runFeaturesCommand(
            apiClient as never,
            {
                implementationFilter: "main",
                statuses: [],
                json: false,
            },
            {
                readGitContext: async () => ({
                    repoUri: "github.com/my-org/my-repo",
                    branchName: "main",
                }),
            },
        );

        expect(apiClient.listImplementations).toHaveBeenCalledWith({
            productName: undefined,
            repoUri: "github.com/my-org/my-repo",
            branchName: "main",
        });
        expect(apiClient.listImplementationFeatures).toHaveBeenCalledWith({
            productName: "product-a",
            implementationName: "main",
            statuses: undefined,
            changedSinceCommit: undefined,
        });
    });

    test("features.MAIN.2-2 cli-core.TARGETING.4 rejects omitted-product ambiguity across products", async () => {
        const ambiguousClient = {
            listImplementations: mock(async () =>
                buildImplementationsResponse({
                    data: {
                        implementations: [
                            {
                                implementation_id: "impl-1",
                                implementation_name: "main",
                                product_name: "product-b",
                            },
                            {
                                implementation_id: "impl-2",
                                implementation_name: "main",
                                product_name: "product-a",
                            },
                        ],
                    },
                }),
            ),
            listImplementationFeatures: mock(async () =>
                buildImplementationFeaturesResponse(),
            ),
        };

        await expect(
            runFeaturesCommand(
                ambiguousClient as never,
                { statuses: [], json: false },
                {
                    readGitContext: async () => ({
                        repoUri: "github.com/my-org/my-repo",
                        branchName: "main",
                    }),
                },
            ),
        ).rejects.toThrow(
            "Multiple implementations matched the current repo, branch, and filters: product-a/main, product-b/main",
        );
    });

    test("features.MAIN.2-2 cli-core.TARGETING.4 rejects omitted-product ambiguity within one product with qualified candidates", async () => {
        const ambiguousClient = {
            listImplementations: mock(async () =>
                buildImplementationsResponse({
                    data: {
                        implementations: [
                            {
                                implementation_id: "impl-1",
                                implementation_name: "main",
                                product_name: "example-product",
                            },
                            {
                                implementation_id: "impl-2",
                                implementation_name: "preview",
                                product_name: "example-product",
                            },
                        ],
                    },
                }),
            ),
            listImplementationFeatures: mock(async () =>
                buildImplementationFeaturesResponse(),
            ),
        };

        await expect(
            runFeaturesCommand(
                ambiguousClient as never,
                { productName: "example-product", statuses: [], json: false },
                {
                    readGitContext: async () => ({
                        repoUri: "github.com/my-org/my-repo",
                        branchName: "main",
                    }),
                },
            ),
        ).rejects.toThrow(
            "Multiple implementations matched the current repo, branch, and filters: example-product/main, example-product/preview",
        );
    });

    test("cli-core.ERRORS.2 reports missing git context", async () => {
        await expect(
            readGitContext({
                runner: {
                    async run() {
                        return {
                            exitCode: 1,
                            stdout: "",
                            stderr: "git failure",
                        };
                    },
                },
            }),
        ).rejects.toThrow("Git context could not be determined.");
    });
});

describe("features command output", () => {
    test("features.API.2 features.UX.3 format the text features list in API order with counts and inheritance metadata", async () => {
        const result = await runFeaturesCommand(
            {
                listImplementations: mock(async () =>
                    buildImplementationsResponse(),
                ),
                listImplementationFeatures: mock(async () =>
                    buildImplementationFeaturesResponse({
                        data: {
                            features: [
                                buildImplementationFeatureEntry({
                                    feature_name: "feature-b",
                                    completed_count: 1,
                                    total_count: 4,
                                    refs_count: 2,
                                    test_refs_count: 1,
                                    has_local_spec: false,
                                    has_local_states: true,
                                    states_inherited: true,
                                    spec_last_seen_commit: "commit-b",
                                }),
                                buildImplementationFeatureEntry({
                                    feature_name: "feature-a",
                                    completed_count: 3,
                                    total_count: 3,
                                    refs_count: 5,
                                    test_refs_count: 2,
                                    has_local_spec: true,
                                    has_local_states: true,
                                    states_inherited: false,
                                    spec_last_seen_commit: "commit-a",
                                }),
                            ],
                        },
                    }),
                ),
            } as never,
            {
                productName: "example-product",
                implementationName: "main",
                statuses: ["todo", "doing"],
                changedSinceCommit: "abc123",
                json: false,
            },
        );

        expect(result).toEqual({
            exitCode: 0,
            stdoutLines: [
                "FEATURE    DONE  REFS  TESTS  SPEC       STATES     LAST_SEEN",
                "---------  ----  ----  -----  ---------  ---------  ---------",
                "feature-b  1/4   2     1      inherited  inherited  commit-b ",
                "feature-a  3/3   5     2      local      local      commit-a ",
            ],
        });
    });

    test("features.MAIN.6 and features.UX.5 return the full JSON payload", async () => {
        const payload = buildImplementationFeaturesResponse();

        const result = await runFeaturesCommand(
            {
                listImplementations: mock(async () =>
                    buildImplementationsResponse(),
                ),
                listImplementationFeatures: mock(async () => payload),
            } as never,
            {
                productName: "example-product",
                implementationName: "main",
                statuses: [],
                json: true,
            },
        );

        expect(result).toEqual({ exitCode: 0, jsonPayload: payload });
    });

    test("features.MAIN.7 and features.MAIN.8 forward repeated statuses and changed-since filters", async () => {
        const listImplementationFeatures = mock(async () =>
            buildImplementationFeaturesResponse(),
        );
        const apiClient = {
            listImplementations: mock(async () =>
                buildImplementationsResponse(),
            ),
            listImplementationFeatures,
        };

        await runFeaturesCommand(apiClient as never, {
            productName: "example-product",
            implementationName: "main",
            statuses: ["todo", "doing"],
            changedSinceCommit: "abc123",
            json: false,
        });

        expect(listImplementationFeatures).toHaveBeenCalledWith({
            productName: "example-product",
            implementationName: "main",
            statuses: ["todo", "doing"],
            changedSinceCommit: "abc123",
        });
    });

    test("features.UX.2 only performs targeting reads and implementation-features reads", async () => {
        const listImplementations = mock(async () =>
            buildImplementationsResponse(),
        );
        const listImplementationFeatures = mock(async () =>
            buildImplementationFeaturesResponse(),
        );
        const setFeatureStates = mock(async () => {
            throw new Error("should not be called");
        });
        const push = mock(async () => {
            throw new Error("should not be called");
        });

        await runFeaturesCommand(
            {
                listImplementations,
                listImplementationFeatures,
                setFeatureStates,
                push,
            } as never,
            {
                productName: "example-product",
                statuses: [],
                json: false,
            },
            {
                readGitContext: async () => ({
                    repoUri: "github.com/my-org/my-repo",
                    branchName: "main",
                }),
            },
        );

        expect(listImplementations).toHaveBeenCalledTimes(1);
        expect(listImplementationFeatures).toHaveBeenCalledTimes(1);
        expect(setFeatureStates).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
    });
});

describe("cli-core.HELP.1 cli-core.HELP.2 cli-core.HELP.4", () => {
    test("runCli prints top-level help and skips the API when invoked without a subcommand", async () => {
        const output = {
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        };
        const apiClient = {
            listImplementations: mock(async () => {
                throw new Error("should not be called");
            }),
            listImplementationFeatures: mock(async () => {
                throw new Error("should not be called");
            }),
        };

        const exitCode = await runCli([], {
            output,
            apiClient: apiClient as never,
        });

        expect(exitCode).toBe(0);
        expect(readWrites(output.stdout.write)).toContain("Usage: acai");
        expect(readWrites(output.stdout.write)).toContain("features");
        expect(output.stderr.write).not.toHaveBeenCalled();
        expect(apiClient.listImplementations).not.toHaveBeenCalled();
        expect(apiClient.listImplementationFeatures).not.toHaveBeenCalled();
    });

    test("cli-core.HELP.2 and cli-core.HELP.5 keep --help and -h in sync", async () => {
        const makeOutput = () => ({
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        });

        const helpOutput = makeOutput();
        const shortHelpOutput = makeOutput();

        const helpExit = await runCli(["--help"], { output: helpOutput });
        const shortHelpExit = await runCli(["-h"], { output: shortHelpOutput });

        expect(helpExit).toBe(0);
        expect(shortHelpExit).toBe(0);
        expect(readWrites(helpOutput.stdout.write)).toBe(
            readWrites(shortHelpOutput.stdout.write),
        );
    });
});

describe("cli-core.HELP.3 cli-core.HELP.5", () => {
    test("runCli prints features help for --help and -h without calling the API", async () => {
        const makeOutput = () => ({
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        });
        const apiClient = {
            listImplementations: mock(async () => {
                throw new Error("should not be called");
            }),
            listImplementationFeatures: mock(async () => {
                throw new Error("should not be called");
            }),
        };

        const helpOutput = makeOutput();
        const shortHelpOutput = makeOutput();

        const helpExit = await runCli(["features", "--help"], {
            output: helpOutput,
            apiClient: apiClient as never,
        });
        const shortHelpExit = await runCli(["features", "-h"], {
            output: shortHelpOutput,
            apiClient: apiClient as never,
        });

        expect(helpExit).toBe(0);
        expect(shortHelpExit).toBe(0);
        expect(readWrites(helpOutput.stdout.write)).toContain(
            "Usage: acai features [options]",
        );
        expect(readWrites(helpOutput.stdout.write)).toContain("product name");
        expect(readWrites(helpOutput.stdout.write)).toContain(
            "implementation name or namespaced selector",
        );
        expect(readWrites(helpOutput.stdout.write)).toContain(
            "<product/implementation>",
        );
        expect(readWrites(helpOutput.stdout.write)).toBe(
            readWrites(shortHelpOutput.stdout.write),
        );
        expect(apiClient.listImplementations).not.toHaveBeenCalled();
        expect(apiClient.listImplementationFeatures).not.toHaveBeenCalled();
    });

    test("skill.MAIN.1 prints skill help without calling the API", async () => {
        const makeOutput = () => ({
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        });
        const apiClient = {
            listImplementations: mock(async () => {
                throw new Error("should not be called");
            }),
            listImplementationFeatures: mock(async () => {
                throw new Error("should not be called");
            }),
        };

        const helpOutput = makeOutput();
        const shortHelpOutput = makeOutput();

        const helpExit = await runCli(["skill", "--help"], {
            output: helpOutput,
            apiClient: apiClient as never,
        });
        const shortHelpExit = await runCli(["skill", "-h"], {
            output: shortHelpOutput,
            apiClient: apiClient as never,
        });

        expect(helpExit).toBe(0);
        expect(shortHelpExit).toBe(0);
        expect(readWrites(helpOutput.stdout.write)).toContain(
            "Usage: acai skill [options]",
        );
        expect(readWrites(helpOutput.stdout.write)).toBe(
            readWrites(shortHelpOutput.stdout.write),
        );
        expect(apiClient.listImplementations).not.toHaveBeenCalled();
        expect(apiClient.listImplementationFeatures).not.toHaveBeenCalled();
    });
});

describe("cli-core.ERRORS.3 cli-core.ERRORS.4 cli-core.ERRORS.5", () => {
    test("runCli reports unknown commands with help text", async () => {
        const output = {
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        };

        const exitCode = await runCli(["bogus"], { output });

        expect(exitCode).toBe(2);
        expect(readWrites(output.stderr.write)).toContain("unknown command");
        expect(readWrites(output.stderr.write)).toContain("Usage: acai");
    });

    test("cli-core.ERRORS.4 reports unknown options with features help text", async () => {
        const output = {
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        };

        const exitCode = await runCli(
            ["features", "--product", "example-product", "--unknown-option"],
            { output },
        );

        expect(exitCode).toBe(2);
        expect(readWrites(output.stderr.write)).toContain("unknown option");
        expect(readWrites(output.stderr.write)).toContain(
            "Usage: acai features",
        );
    });

    test("skill.MAIN.1 cli-core.ERRORS.4 rejects unknown skill options", async () => {
        const output = {
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        };

        const exitCode = await runCli(["skill", "--unknown-option"], {
            output,
        });

        expect(exitCode).toBe(2);
        expect(readWrites(output.stderr.write)).toContain("unknown option");
        expect(readWrites(output.stderr.write)).toContain("Usage: acai skill");
    });

    test("skill.SAFETY.1 runs locally without API configuration", async () => {
        const output = {
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        };

        const exitCode = await runCli(["skill"], { output, env: {} });

        expect(exitCode).toBe(0);
        expect(readWrites(output.stdout.write)).toBe(
            getCanonicalSkillContent(),
        );
        expect(output.stderr.write).not.toHaveBeenCalled();
    });

    test("cli-core.ERRORS.5 prints features help when usage validation fails inside the command", async () => {
        const output = {
            stdout: { write: mock(() => {}) },
            stderr: { write: mock(() => {}) },
        };

        const exitCode = await runCli(
            ["features", "--product", "example-product", "--impl", "main"],
            {
                env: {},
                output,
            },
        );

        expect(exitCode).toBe(2);
        const stderr = readWrites(output.stderr.write);
        expect(stderr).toContain("Missing API bearer token configuration.");
        expect(stderr).toContain("Usage: acai features");
    });
});
