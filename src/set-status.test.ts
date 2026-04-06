import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFeatureStatesResponse, buildImplementationsResponse } from "../test/support/fixtures.ts";
import { createApiClient } from "./core/api.ts";
import {
  formatSetStatusText,
  normalizeSetStatusOptions,
  parseFeatureStatesPayload,
  readSetStatusInput,
  runSetStatusCommand,
} from "./core/set-status.ts";

describe("set-status.MAIN.1 set-status.MAIN.4 set-status.MAIN.5 set-status.MAIN.6", () => {
  test("set-status.MAIN.4 and set-status.MAIN.5 normalize direct selectors", () => {
    expect(
      normalizeSetStatusOptions('{"set-status.MAIN.1":{"status":"completed"}}', {
        product: "example-product",
        impl: "main",
        json: true,
      }),
    ).toEqual({
      source: '{"set-status.MAIN.1":{"status":"completed"}}',
      productName: "example-product",
      implementationName: "main",
      json: true,
    });
  });

  test("set-status.MAIN.4 cli-core.TARGETING.1 resolves product from --impl product/implementation", () => {
    expect(
      normalizeSetStatusOptions('{"set-status.MAIN.1":{"status":"completed"}}', {
        impl: "example-product/main",
      }),
    ).toEqual({
      source: '{"set-status.MAIN.1":{"status":"completed"}}',
      productName: "example-product",
      implementationName: "main",
      json: false,
    });
  });

  test("set-status.MAIN.1 set-status.MAIN.4 set-status.MAIN.5 reject missing values and conflicts", () => {
    expect(() => normalizeSetStatusOptions("--product", { product: "example-product" })).toThrow(
      "Missing value for <json>.",
    );
    expect(() => normalizeSetStatusOptions("{}", { product: "-bad" })).toThrow("Missing value for --product.");
    expect(() => normalizeSetStatusOptions("{}", { product: "example-product", impl: "-bad" })).toThrow(
      "Missing value for --impl.",
    );
    expect(() => normalizeSetStatusOptions("{}", { impl: "main" })).toThrow("Missing product selector");
    expect(() =>
      normalizeSetStatusOptions("{}", {
        product: "example-product",
        impl: "other-product/main",
      })).toThrow("Conflicting product selectors");
  });
});

describe("set-status.MAIN.2 set-status.MAIN.3 set-status.INPUT.5 set-status.SAFETY.1 set-status.UX.2", () => {
  test("set-status.MAIN.2 reads @file JSON input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acai-set-status-"));
    const filePath = join(dir, "states.json");
    await writeFile(filePath, '{"set-status.MAIN.1":{"status":"completed"}}');

    await expect(readSetStatusInput(`@${filePath}`)).resolves.toBe(
      '{"set-status.MAIN.1":{"status":"completed"}}',
    );
  });

  test("set-status.MAIN.2 rejects empty @file selectors", async () => {
    await expect(readSetStatusInput("@")).rejects.toThrow("Missing file path after @ input selector.");
  });
});

describe("set-status.INPUT.1 set-status.INPUT.2 set-status.INPUT.2-1 set-status.INPUT.3 set-status.INPUT.4 set-status.INPUT.5 set-status.SAFETY.3", () => {
  test("set-status.INPUT.1 set-status.INPUT.2 set-status.INPUT.3 and set-status.INPUT.4 validate one-feature ACID maps", () => {
    expect(
      parseFeatureStatesPayload(
        JSON.stringify({
          "set-status.MAIN.1": { status: "completed", comment: "done" },
          "set-status.INPUT.1": { status: null },
        }),
      ),
    ).toEqual({
      featureName: "set-status",
      states: {
        "set-status.MAIN.1": { status: "completed", comment: "done" },
        "set-status.INPUT.1": { status: null },
      },
    });
  });

  test("set-status.INPUT.5 rejects malformed JSON", () => {
    expect(() => parseFeatureStatesPayload("{")).toThrow("Invalid JSON payload.");
  });

  test("set-status.INPUT.5 rejects malformed ACIDs", () => {
    expect(() =>
      parseFeatureStatesPayload(JSON.stringify({ "not-an-acid": { status: "completed" } }))).toThrow(
      "Malformed ACID: not-an-acid",
    );
  });

  test("set-status.INPUT.3 set-status.INPUT.5 rejects mixed-feature payloads", () => {
    expect(() =>
      parseFeatureStatesPayload(
        JSON.stringify({
          "set-status.MAIN.1": { status: "completed" },
          "feature.MAIN.1": { status: "accepted" },
        }),
      )).toThrow("All ACIDs in one payload must share the same feature prefix.");
  });

  test("set-status.INPUT.2 set-status.INPUT.2-1 set-status.INPUT.5 rejects invalid states", () => {
    expect(() =>
      parseFeatureStatesPayload(JSON.stringify({ "set-status.MAIN.1": { comment: "missing" } }))).toThrow(
      "State for set-status.MAIN.1 must include status.",
    );
    expect(() =>
      parseFeatureStatesPayload(JSON.stringify({ "set-status.MAIN.1": { status: "todo" } }))).toThrow(
      "Invalid status for set-status.MAIN.1: todo",
    );
  });
});

describe("set-status.API.1 set-status.API.2 set-status.API.3 set-status.UX.1 set-status.UX.2 cli-core.OUTPUT.1 cli-core.OUTPUT.2", () => {
  test("set-status.API.1 sends PATCH /feature-states requests and normalizes errors", async () => {
    const patch = mock(async (path: string, options: Record<string, unknown>) => {
      expect(path).toBe("/feature-states");
      expect(options.body).toEqual({
        product_name: "example-product",
        feature_name: "set-status",
        implementation_name: "main",
        states: {
          "set-status.MAIN.1": { status: "completed" },
        },
      });

      return { data: buildFeatureStatesResponse() };
    });

    const client = createApiClient(
      { baseUrl: "https://api.example.test", token: "secret" },
      { client: { GET: mock(async () => { throw new Error("unexpected"); }), POST: mock(async () => { throw new Error("unexpected"); }), PATCH: patch } },
    );

    await expect(
      client.setFeatureStates({
        product_name: "example-product",
        feature_name: "set-status",
        implementation_name: "main",
        states: { "set-status.MAIN.1": { status: "completed" } },
      }),
    ).resolves.toEqual(buildFeatureStatesResponse());

    const errorClient = createApiClient(
      { baseUrl: "https://api.example.test", token: "secret" },
      {
        client: {
          GET: mock(async () => { throw new Error("unexpected"); }),
          POST: mock(async () => { throw new Error("unexpected"); }),
          PATCH: mock(async () => ({
            data: undefined,
            error: { errors: { detail: "set-status detail" } },
            response: { status: 422 },
          })),
        },
      },
    );

    await expect(
      errorClient.setFeatureStates({
        product_name: "example-product",
        feature_name: "set-status",
        implementation_name: "main",
        states: { "set-status.MAIN.1": { status: "completed" } },
      }),
    ).rejects.toThrow("set-status detail");
  });

  test("set-status.API.1 set-status.API.2 cli-core.TARGETING.1 resolves explicit and namespaced targets", async () => {
    const setFeatureStates = mock(async () => buildFeatureStatesResponse());
    const apiClient = {
      listImplementations: mock(async () => buildImplementationsResponse()),
      setFeatureStates,
    };

    const direct = await runSetStatusCommand(
      apiClient as never,
      {
        productName: "example-product",
        implementationName: "main",
        source: '{"set-status.MAIN.1":{"status":"completed"}}',
        json: false,
      },
    );

    expect(direct.stdoutLines).toEqual([
      "example-product/main feature=set-status",
      "states_written=2",
    ]);
    expect(setFeatureStates).toHaveBeenCalledWith({
      product_name: "example-product",
      feature_name: "set-status",
      implementation_name: "main",
      states: { "set-status.MAIN.1": { status: "completed" } },
    });
  });

  test("set-status.API.3 set-status.UX.1 surfaces warnings in text and --json modes", async () => {
    const payload = buildFeatureStatesResponse({
      data: {
        warnings: ["warning one", "warning two"],
        states_written: 1,
      },
    });
    const apiClient = {
      listImplementations: mock(async () => buildImplementationsResponse()),
      setFeatureStates: mock(async () => payload),
    };

    const textResult = await runSetStatusCommand(
      apiClient as never,
      {
        productName: "example-product",
        implementationName: "main",
        source: '{"set-status.MAIN.1":{"status":"completed"}}',
        json: false,
      },
    );
    expect(textResult.stdoutLines).toEqual([
      "example-product/main feature=set-status",
      "states_written=1",
      "warning: warning one",
      "warning: warning two",
    ]);

    const jsonResult = await runSetStatusCommand(
      apiClient as never,
      {
        productName: "example-product",
        implementationName: "main",
        source: '{"set-status.MAIN.1":{"status":"completed"}}',
        json: true,
      },
    );
    expect(jsonResult).toEqual({ exitCode: 0, jsonPayload: payload, stderrLines: ["warning one", "warning two"] });
  });

  test("set-status.INPUT.5 proves parse failures happen before any API call", async () => {
    const apiClient = {
      listImplementations: mock(async () => buildImplementationsResponse()),
      setFeatureStates: mock(async () => buildFeatureStatesResponse()),
    };

    await expect(
      runSetStatusCommand(
        apiClient as never,
        {
          productName: "example-product",
          implementationName: "main",
          source: "ignored",
          json: false,
        },
        {
          readInput: async () => "{",
        },
      ),
    ).rejects.toThrow("Invalid JSON payload.");

    expect(apiClient.listImplementations).not.toHaveBeenCalled();
    expect(apiClient.setFeatureStates).not.toHaveBeenCalled();
  });

  test("set-status.UX.1 formats resolved product implementation feature and count", () => {
    expect(
      formatSetStatusText(
        buildFeatureStatesResponse({
          data: {
            product_name: "example-product",
            implementation_name: "preview",
            feature_name: "set-status",
            states_written: 3,
            warnings: ["warn"],
          },
        }),
      ),
    ).toEqual([
      "example-product/preview feature=set-status",
      "states_written=3",
      "warning: warn",
    ]);
  });
});
