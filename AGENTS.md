## Context
`acai` is a CLI tool for spec-driven development. It scans codebases for `<feature-name>.feature.yaml` spec files and Acceptance Criteria IDs (ACIDs) in source code. The results are formatted in json and pushed to the acai.sh server. The CLI is part of a broader toolset including a web dashboard and JSON REST API.

The CLI is intended to be run from CI/CD pipelines (GitHub Actions), to keep the acai server in sync with changes to specs or code.

## Testing Guidelines

**Test Command:** `AGENT=1 bun test`
*(CRITICAL: Always prefix test executions with `AGENT=1`. This enables a stripped-down reporter that minimizes token output to prevent overwhelming the context window during automated runs.)*

**Framework & Tooling**
We strictly use Bun's built-in testing utilities (`bun:test`). Do not install external runners or assertion libraries like Jest or Vitest.

* **Unit Testing:**
    * Focus on isolated internal logic (argument parsing, output formatting).
    * Use `mock()` from `bun:test` to stub the `openapi-fetch` client responses.
* **End-to-End (E2E) Testing:**
    * **Mock API:** Use `Bun.serve()` in a `beforeAll` block to spin up a local, zero-latency HTTP server to return deterministic mock JSON.
    * **Execution:** Use `Bun.spawn()` to run the CLI binary as a subprocess. Pass the local `Bun.serve()` URL via environment variables.
    * **Assertions:** Capture and assert against the subprocess's `stdout` (text/formatting), `stderr` (errors), and `exitCode` (0 for success, >0 for failure).
