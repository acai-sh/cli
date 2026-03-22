# ADR

## Status
Draft

## Context
`acai` is a CLI tool for spec-driven development. It scans codebases for `feature.yaml` spec files and requirement ID references in source code, then pushes the results to the acai.sh server. The CLI is part of a broader toolset including a web dashboard and JSON REST API.

Goals: minimal dependencies, broad accessibility across JS and non-JS users, simple enough to run locally, in CI, or via git hooks.

---

## Decisions

### Runtime: Bun
- Native TypeScript support — no build step during development
- Built-in `fetch` and `Bun.file()` eliminate most dependencies
- `bun build` as bundler; `bun build --compile` for standalone binaries
- `Bun.Glob` used for file scanning — abstracted behind a compat shim (see Node target below)

---

### Distribution: four install paths, one codebase

| Audience | Method | How |
|---|---|---|
| JS/Node users | `npx acai` / `npm i -g` / `yarn add` / `bun add` | `bun build --target=node` bundle published to npm |
| Non-JS users | Download binary | `bun build --compile` per-platform on GitHub releases |
| Future | `brew install acai` | Homebrew formula pointing at GitHub release binaries |

---

### Dependencies: zero (runtime)
- **Arg parsing:** handrolled `process.argv` parsing — sufficient for current subcommand surface
- **HTTP:** native `fetch`
- **File scanning:** recursive `fs.readdir` walker (Node) / `Bun.Glob` (Bun), abstracted via compat shim
- **`.gitignore` handling:** hardcoded exclusions for MVP (`node_modules`, `.git`, `dist`, `build`, `vendor`) — known gap, see Future Considerations
- No `commander`, no `glob` package, no HTTP library

---

### Node target compatibility shim

`Bun.*` APIs are unavailable when the bundle runs on Node. A `src/fs-compat.ts` shim abstracts the differences:

| Bun API | Node equivalent |
|---|---|
| `Bun.file(path).text()` | `fs.promises.readFile(path, 'utf8')` |
| `Bun.Glob` | Hand-rolled recursive `readdir` walker (~50 lines) |
| `fetch` | No shim needed (Node 18+) |

The shim is the only meaningful maintenance surface for dual-target support and is written as part of this effort.

---

### Commands (MVP)

**Supported:**

```
acai push --all
acai push <feature-name> [feature-name...]
```

**Explicitly rejected (with actionable error):**

```
acai push
```

Plain `acai push` is reserved for a future git-aware mode that pushes only changed specs and code references. It is rejected in MVP with an explicit message rather than silently doing something unexpected:

```
Error: plain `acai push` is not yet supported
Use `acai push --all` to scan and push everything, or
    `acai push <feature-name> [feature-name...]` to push specific features
```

---

### Scan behavior

`acai push` performs two scans:

1. **Spec scan** — finds all `*.feature.yaml` files in the codebase
2. **Code reference scan** — walks the codebase looking for occurrences of requirement IDs (e.g. `my-feature.EXAMPLE.1`) in source files, using `String.matchAll()`

**For `--all`:** full scan, full push.

**For `<feature-name> [feature-name...]`:** full scan is performed, then results are filtered to the named features before the payload is built. Scoped scanning (skipping irrelevant files earlier in the pipeline) is a future performance optimization — scan-then-filter is simpler, has one code path, and is easier to test correctly.

**Hardcoded exclusions (MVP):** `node_modules`, `.git`, `dist`, `build`, `vendor`. Parsing actual `.gitignore` files is deferred — see Future Considerations.

---

### Error handling

- **Exit codes:** `0` = success, `1` = runtime failure (network, server error, file I/O), `2` = bad arguments / misuse
- **Output:** errors and warnings → `stderr`; data output → `stdout` (pipeable)
- **Atomicity:** the server guarantees atomic pushes — any server-side failure rolls back entirely. The CLI receives a single success or failure response and exits accordingly.
- **Payload size:** no automatic chunking or retry. If the server rejects a payload, the user scopes their push by naming specific features. The `--all` flag is the user's explicit acknowledgement of a full push.
- **Batching:** not supported in MVP. Each invocation is a single push operation. Partial failure handling is deferred until batching is introduced.

---

### Git-awareness

Deferred entirely from MVP. The `acai push --all` behavior (full scan on every invocation) is correct and sufficient at MVP scale, and the server's idempotency guarantee means re-pushing unchanged data is harmless.

When git-awareness is added, `acai push` (no flags) will become the default optimized path. The `--all` flag will remain as a force-full-scan escape hatch — no breaking changes to the command interface.

---

## Future Considerations

- **Git-aware push:** diff against git to push only changed specs and code references — becomes the default behavior of plain `acai push`
- **Scoped scanning:** build requirement ID patterns from named feature specs first, then scan only for those patterns — performance optimization for large repos
- **`.gitignore` parsing:** respect actual ignore files rather than hardcoded exclusions — important for monorepos with non-standard output directories
- **Batching and partial failure handling:** chunked pushes with defined behavior on partial failure — requires product decisions on retry logic and exit code semantics
- **`rg` integration:** optional ripgrep fallback for very large codebases — check for presence at runtime, fall back to native walker if absent
- **Rust rewrite:** if scan performance becomes the primary bottleneck at scale; `grep-searcher`/`grep-regex` crates are the likely path
- If the subcommand surface grows meaningfully, `commander` is the preferred escape hatch — it is zero-dependency and adds ~50KB to the bundle.
