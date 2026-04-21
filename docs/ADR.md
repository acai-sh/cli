# ADR

### Distribution: four install paths, one codebase

| Audience | Method | How |
|---|---|---|
| JS/Node users | `npx acai` / `npm i -g` / `yarn add` / `bun add` | `bun build --target=node` bundle published to npm |
| Non-JS users | Download binary | `bun build --compile` per-platform on GitHub releases |
| Future | `brew install acai` | Homebrew formula pointing at GitHub release binaries |

---

### Dependencies: light (runtime)

- **Arg parsing:** handrolled `process.argv` parsing — sufficient for current subcommand surface
- **HTTP & API Client:** `openapi-fetch` (runtime) wrapping native `fetch`, paired with `openapi-typescript` (dev dependency). 
  - *Why:* This combination provides zero-overhead, end-to-end type safety directly from the API's `openapi.json` contract. It gives us the developer experience of a strongly typed SDK without the massive bundle size or runtime bloat of traditional generated clients.
- **File scanning:** recursive `fs.readdir` walker (Node) / `Bun.Glob` (Bun), abstracted via compat shim
- No `commander`, no `glob` package, no heavy HTTP libraries (e.g., `axios`), no bulky generated SDKs.

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

## Future Considerations

Out of scope for MVP:
- **Git-aware push:** diff against git to push only changed specs and code references — becomes the default behavior of plain `acai push`
- **Scoped scanning:** build requirement ID patterns from named feature specs first, then scan only for those patterns — performance optimization for large repos
- **`rg` integration:** optional ripgrep fallback for very large codebases — check for presence at runtime, fall back to native walker if absent
