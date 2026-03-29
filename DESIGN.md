# Implementation Decisions

Log of accepted design decisions for the COIL implementation (coil-runtime):

- code structure,
- parser architecture,
- CLI behavior,
- AST format.

## How this log is maintained

Each decision receives a sequential number `R-NNNN`.

| Status | Meaning |
|---|---|
| `accepted` | Decision is recorded, implementation follows it. |
| `accepted as direction` | Choice is made, details are refined during implementation. |
| `superseded by R-NNNN` | Decision is replaced by the specified one. |

Process:
1. Accept a decision — assign the next `R-NNNN`, record the rationale, status `accepted`.
2. Replace a decision — assign `superseded by R-NNNN` to the old one, assign a new `R-NNNN` to the new one.

---

## R-0001 — Project structure: monopackage with directory-based separation

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | Initially the requirements specified `cli/` as the source root. But the lexer, parser, validator, AST form a library, while the CLI is a thin layer on top of it. Future consumers (coil-ide, coil-sandbox) will import the library, not the CLI. |
| **Decision** | Monopackage. Library in `src/` with subdirectories per subsystem (`lexer/`, `parser/`, `validator/`, `executor/`, `ast/`, `dialect/`, `sdk/`). CLI is a separate directory `cli/`, a thin layer, `bin` entry point in `package.json`. |
| **Alternatives** | (A) Everything in `cli/` — semantically incorrect, false coupling. (B) Monorepo with workspace packages — premature overhead. (C) Flat structure without subdirectories — doesn't scale when files > 10. |
| **Consequences** | The initial requirements are updated: "directory `cli/`" is replaced with a description of the actual structure. The library is exported via `main`/`exports` in `package.json`. |

## R-0002 — Dialect is specified by the path to a table file

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | The specification (01-lexical.md) requires the dialect to be unambiguously determined before lexical analysis begins, but leaves the mechanism to the implementation. D-0029 requires: no dialect is privileged, mappings are loaded from external tables. |
| **Decision** | CLI accepts a flag `--dialect <path>`, the value is a path to a dialect table file. No built-in dialect registry. If the flag is not specified — error `dialect not specified`. Auto-detection is a separate future decision. |
| **Alternatives** | (A) Flag with dialect name (`--dialect en-standard`) + built-in registry — violates the D-0029 principle, hardcodes knowledge of specific dialects. (B) Auto-detect by first keyword — complex, unreliable, can be added later. |
| **Consequences** | The user must specify the dialect explicitly. The table file format is determined separately (JSON as the initial choice). Anyone can create their own dialect without touching the code. |

## R-0003 — Lexer: phrases as units, longest match

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | The specification (01-lexical.md § 1.0) explicitly requires: the lexer cannot be limited to word-by-word recognition. Multi-word keyword phrases (`REPLY TO`, `NO MORE THAN`, `НЕ БОЛЕЕ`, `БЕЛЫЙ КРОЛИК`) are full units. |
| **Decision** | The lexer is initialized with the dialect table and builds a reverse index "phrase -> abstract ID". When encountering a potential start of a keyword phrase — longest match against the table. Example: sees `NO` -> checks `NO MORE THAN` -> if matched, emits one token `Mod.Timeout` (or `Mod.Limit` — context is resolved by the parser). If not matched — it's an identifier. |
| **Alternatives** | (A) Word-by-word recognition + merging in the parser — violates the spec requirement, complicates the parser, breaks diagnostics. |
| **Consequences** | The lexer is more complex than a word-by-word one. But this is a one-time effort, and the architecture is correct from day one. Lookahead is bounded by the length of the longest phrase in the table. |

## R-0004 — Templates: the lexer splits into [TextFragment, ValueRef, ...]

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | Templates `<< >>` contain free text with `$`-substitutions. A decision is needed on who handles substitution parsing: the lexer or the executor. |
| **Decision** | When encountering `<<`, the lexer switches to template mode and splits the content into typed parts: `TextFragment` (raw text) and `ValueRef` (`$name`, `$name.field`). The parser builds a `TemplateNode` from these parts. |
| **Alternatives** | (A) One raw token `TemplateContent` — substitutions are resolved by the executor. Simpler lexer, but the validator cannot check `$`-references before execution, violating the principle "preparation errors vs execution errors". |
| **Consequences** | The validator can check that `$name` is declared before execution. The executor simply concatenates fragments during substitution. The lexer is slightly more complex, but parsing `$`-references inside a template is trivial. |

## R-0005 — AST: typed nodes per operator

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | Two approaches to AST: a generic `OperatorNode` with `modifiers: Map<string, any>` or a typed node per operator. |
| **Decision** | Each operator has its own node: `ReceiveNode`, `SendNode`, `ExitNode`, etc. Fields are typed: `SendNode.await` is `'none' | 'any' | 'all' | null`, not an arbitrary string. Invalid states are unrepresentable at the type level. |
| **Alternatives** | (A) Generic `OperatorNode` with a dictionary of modifiers — more flexible, but pushes checks from types to runtime. Convenient for metaprogramming, but COIL has a fixed set of operators, not extensible by users. |
| **Consequences** | More code for node definitions (each new operator is a new type). In return — type safety, IDE autocompletion, self-documentation. When adding THINK, EXECUTE, WAIT — analogous nodes. The common `OperatorNode` is a base interface with `kind` and `span`. |

## R-0006 — CLI: SEND without address -> stdout

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | The specification defines SEND as sending a message to a channel. The acceptance criteria require SEND without `TO`, without `FOR`, just the body `<< Hello, $name! >>`. CLI semantics are needed. |
| **Decision** | In the CLI execution environment, SEND without `TO` and without `FOR` outputs the body to stdout. Conceptually: the CLI environment provides a default channel, and SEND without an address is directed there. SEND with modifiers (`TO`, `FOR`, `AWAIT`, `REPLY TO`, `TIMEOUT`) — the executor throws a `not implemented` error. |
| **Alternatives** | (A) SEND without address — always an error. Formally correct, but makes the vertical slice useless for demos. (B) Introduce a special PRINT operator — violates the spec, COIL has no such operator. |
| **Consequences** | The behavior is specific to the CLI environment. Other execution environments (coil-sandbox, production) will define their own behavior for SEND without an address. |

## R-0007 — Validation of EOF without EXIT — separate pass

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | The requirements specify: EOF without EXIT is a validation error. Question: does the parser or a separate validator check this? |
| **Decision** | The parser builds the AST as-is. A separate pass `validate(ast)` checks semantic invariants, including "script must end with EXIT". For the vertical slice — one rule. Architecturally — an extension point for dozens of rules. |
| **Alternatives** | (A) Parser checks — mixes syntax and semantics. In the future, rules like "undeclared participant", "WAIT on non-promise" won't fit in the parser without turning it into a second validator. |
| **Consequences** | Pipeline: `file -> dialect -> lexer -> parser -> validator -> executor`. The validator is a separate module with a clean interface: `validate(ast): ValidationError[]`. The parser handles syntax, the validator handles semantics. Errors from both levels contain `SourceSpan` for diagnostics. |

## R-0008 — Dialect table format: JSON

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | D-0031 defines the dialect table structure (metadata + six mapping categories), but does not fix the file format. A specific format is needed for implementation. |
| **Decision** | The dialect table is a JSON file. Structure: `{ name, label, operators: { "Op.Actors": "ACTORS", ... }, terminators: { "Kw.End": "END" }, modifiers: { "Mod.To": "TO", "Mod.ReplyTo": "REPLY TO", ... }, policies: { "Pol.All": "ALL", ... }, resultTypes: { "Typ.Text": "TEXT", ... }, durationSuffixes: { "Dur.Seconds": "s", ... } }`. JSON files live alongside READMEs in dialect directories: `dialects/en-standard/en-standard.json`, `dialects/ru-matrix/ru-matrix.json`. |
| **Alternatives** | (A) YAML — dependency on a parser. (B) TypeScript module — requires compilation, violates the principle "a dialect is data, not code". (C) TOML — less common, additional dependency. |
| **Consequences** | JSON — zero-dependency, readable from any language. README in the dialect directory — a human-readable description with rationale and explanations. The JSON file — a machine-readable table for the loader. Both artifacts live together but serve different purposes. |

## R-0009 — Code after EXIT: validator warning, not a parser error

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | EXIT is a terminating operator. Code after it is unreachable. The spec doesn't explicitly forbid text after EXIT, but the meaning is clear. A decision is needed: does the parser reject it, the validator throw an error, or the validator issue a warning? |
| **Decision** | The parser parses the entire file, including operators after EXIT (useful for tooling). The validator emits a **warning** `unreachable-after-exit` if there are operators after ExitNode. The warning is output to stderr but does not affect the exit code. |
| **Alternatives** | (A) Parser rejects — loses the ability to highlight and navigate "dead" code. (B) Hard validator error — may block test runs; can be tightened later. |
| **Consequences** | `ValidationResult` contains both errors and warnings. CLI: errors -> exit 1, warnings -> stderr but exit 0. The validator in the vertical slice has two rules: `exit-required` (error) and `unreachable-after-exit` (warning). |

## R-0010 — KeywordIndex: one phrase -> array of possible IDs

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | SPEC.md § 5 allows context-dependent resolution: one keyword phrase can map to multiple abstract IDs (example: `НЕ БОЛЕЕ` -> `Mod.Timeout` in SEND/WAIT, `Mod.Limit` in REPEAT). The lexer doesn't know the operator context — that's the parser's job. |
| **Decision** | `KeywordIndex.lookup(phrase)` returns `{ ids: AbstractId[] }`. If `ids.length === 1` — unambiguous, the lexer emits a token with one ID. If more — the lexer emits a `Keyword` with an array of candidates, the parser resolves by operator context. |
| **Alternatives** | (A) One phrase -> one ID, contextual logic hardcoded in the lexer — violates lexer/parser separation, the lexer would need to know the current operator. |
| **Consequences** | For the vertical slice, all phrases are unambiguous (REPEAT is out of scope, `НЕ БОЛЕЕ` / `NO MORE THAN` resolves to `Mod.Timeout`). The architecture is ready for extension. |

## R-0011 — Unimplemented operators: UnsupportedOperatorNode, not a parser error

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | The lexer tokenizes all operators from the registry (Op.Think, Op.Execute, Op.If, etc.), but the parser in the vertical slice implements only RECEIVE, SEND, EXIT. What to do when encountering an unimplemented operator? |
| **Decision** | When encountering an unimplemented operator, the parser: recognizes the keyword -> skips content until the corresponding `Kw.End` (counting nesting) -> creates `UnsupportedOperatorNode { kind: AbstractId, span: SourceSpan }`. The parser does not throw an exception on a syntactically correct block. The validator adds the rule `unsupported-operator` (error): "operator Op.Think is not supported in this version". |
| **Alternatives** | (A) Parser throws an exception — loses tooling capabilities, the parser cannot show a file outline with THINK. |
| **Consequences** | Tooling (highlighting, navigation, outline) works for all operators. Adding a new operator = implementing `parseThink()` + replacing `UnsupportedOperatorNode` with `ThinkNode` + removing from the unsupported list. The validator in the vertical slice has three rules: `exit-required` (error), `unreachable-after-exit` (warning), `unsupported-operator` (error). |

## R-0012 — ValidationDiagnostic: unified type with severity

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | The validator must return both errors and warnings (R-0009). Two approaches: two separate arrays (`errors[]`, `warnings[]`) or a unified type with a `severity` field. |
| **Decision** | Unified `ValidationDiagnostic { severity: 'error' \| 'warning', ruleId: string, message: string, span: SourceSpan }`. Result: `ValidationResult { diagnostics: ValidationDiagnostic[] }`. CLI: `diagnostics.filter(d => d.severity === 'error').length > 0` -> exit 1. |
| **Alternatives** | (A) Two arrays `{ errors: [], warnings: [] }` — essentially the same filter hardcoded into the structure. Less extensible (for `'info'`, `'hint'` another array is needed). |
| **Consequences** | One array: easier to sort by span, output in a single stream, extend severity without changing the structure. |

## R-0013 — Dialect tables: git dependency on coil

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-24 |
| **Context** | coil-runtime tests use JSON dialect tables from `coil/dialects/`. |
| **Decision** | Add `coil` as a git dependency in `devDependencies`: `"coil": "github:animata-systems/coil"`. Tests get dialects from `node_modules/coil/dialects/`. No `../` paths outside the repository. |
| **Alternatives** | (A) Copy JSON into `test/fixtures/` — duplication, desynchronization. (B) npm package `@coil/dialects` — overhead for two JSON files. |
| **Consequences** | `npm install` clones public `coil`, tests work autonomously. Single source of truth for dialects. Versioning: pinning to main for now, switch to tags when the spec stabilizes. |

## R-0014 — CommentNode: separate type, not an operator

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-25 |
| **Context** | COIL-H (spec/11-coil-h.md § 11.6) requires displaying section comments as separator rows in the tabular projection. For this, the parser must preserve comments in the AST, not skip them. Question: is a comment a kind of operator or a separate entity? |
| **Decision** | `CommentNode { kind: 'Comment', text: string, span: SourceSpan }` — a separate type, **not** part of the `OperatorNode` union. `ScriptNode.nodes: (OperatorNode | CommentNode)[]` — the array contains both types. The old field `operators` is renamed to `nodes`. |
| **Alternatives** | (A) Include `CommentNode` in the `OperatorNode` union — semantically incorrect: a comment is not executed, not validated, not numbered in COIL-H. Inclusion in the union would force every validator rule and executor to filter it manually, and TypeScript exhaustiveness checks would require a Comment branch in every switch. (B) Store comments in a separate array `ScriptNode.comments[]` — loses ordering relative to operators, which is necessary for COIL-H section dividers. |
| **Consequences** | All consumers of `ScriptNode` (validator, executor, tooling) filter `nodes` by `kind` when iterating over operators. Pattern: `ast.nodes.filter((n): n is OperatorNode => n.kind !== 'Comment')`. The COIL-H projection iterates over `nodes` as a whole, handling CommentNode as divider rows. |

## R-0015 — Comments: top-level are preserved, inside blocks — not

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-25 |
| **Context** | Comments can appear at two levels: (1) between operators (top-level), (2) inside an operator body (between the keyword and END). For COIL-H section dividers, only top-level comments are needed. Comments inside blocks are author notes with no structural significance for the projection. |
| **Decision** | Main loop of the parser: `Comment` token -> `CommentNode` in `nodes[]`. Inside blocks (`parseReceive`, `parseSend`, `skipBlock`): the function `skipTrivia()` skips both Newline and Comment. The function `skipNewlines()` skips only Newline and is used in the main loop to preserve Comment tokens. |
| **Alternatives** | (A) Preserve comments at all levels — complicates every `*Node` (needs `leadingComments`/`trailingComments` fields), and there are no consumers for this data yet. Can be added later if needed. (B) Don't preserve anywhere — impossible to build COIL-H dividers. |
| **Consequences** | Contract for authors: if a comment should be visible in COIL-H as a section divider — it must be top-level (between operators), not inside a block. This matches the author's intuition: a section heading is naturally written between operators. When extending the parser (adding IF, REPEAT, etc.), block comments will remain invisible to COIL-H, which is correct: nested structure is displayed differently. |

## R-0016 — Browser entry point: granular imports without node:fs

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-25 |
| **Context** | coil-ide (Vite + React) imports the lexer, parser, validator from coil-runtime. Modules `loadDialect` (node:fs) and `executor` (node:readline) are not available in the browser. An entry point excluding Node.js dependencies is needed. |
| **Decision** | File `src/browser.ts` re-exports modules individually: `common`, `ast`, `dialect/types`, `dialect/keyword-index`, `lexer`, `parser`, `validator`. Does **not** re-export `dialect/index` (contains `loadDialect`), `executor`, `cli`. In `package.json`: `"exports": { "./browser": "./dist/src/browser.js" }`. The playground imports dialect JSON directly (Vite JSON import) and passes `DialectTable` to `KeywordIndex.build()`. |
| **Alternatives** | (A) Re-export through `dialect/index` with tree-shaking — Vite/Rollup doesn't guarantee removal of `node:fs` with `export *`, because `loadDialect` is exported with side-effect-free code, but the `import` of a module with `node:fs` itself causes a bundler error. (B) Conditional `export` via `package.json` `"browser"` field — less explicit, not all bundlers support it equally. |
| **Consequences** | Granular imports in `browser.ts` are fragile: a new export in `dialect/index.ts` won't automatically appear in the browser entry point. This is a deliberate choice — safety (not pulling in node:fs) matters more than convenience. When adding new modules to the runtime, one needs to decide whether they are exported from `browser.ts`. |

## R-0017 — Build for git dependency: exclude tests + prepare

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-25 |
| **Context** | coil-ide connects coil-runtime as a git dependency (`github:animata-systems/coil-runtime`). npm clones the repository, but `dist/` is not in git. Automatic build is needed. Problem: `tsc` includes `*.test.ts` (via `include: ["src/**/*"]`), which import `vitest`. When installing from git, npm doesn't install `devDependencies` of transitive dependencies -> `vitest` is missing -> `tsc` fails. |
| **Decision** | (1) `tsconfig.json`: add `"exclude": ["**/*.test.ts"]`. (2) `package.json`: add `"prepare": "tsc"`. `prepare` is called by npm after `npm install` from a git source and builds `dist/`. |
| **Alternatives** | (A) `file:` dependencies — ties to the umbrella structure, breaks autonomous build (I-0001). (B) Separate `tsconfig.build.json` — excessive for a single `exclude`. (C) Commit `dist/` to git — anti-pattern, merge conflicts, repository bloat. |
| **Consequences** | `vitest` continues to work — it compiles files via esbuild, not `tsc`. `pretest: "tsc"` continues to work: it builds `dist/` for tests, but without test files. Tests don't end up in `dist/`, which is correct — they shouldn't be part of the package. |

## R-0018 — parseRefList: generic function with token type parameter

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | Several operators parse comma-separated lists of references of different types: SEND.FOR (`@name`), THINK.AS (`$name`), THINK.USING (`!name`), WAIT.ON (`?name`). The question: one generic function or four separate ones? |
| **Decision** | One generic function `parseRefList(expectedType)`, parameterized by token type. The parsing logic is identical: `expect(type) -> while(Comma) -> expect(type)`. The token type determines what is expected. |
| **Alternatives** | Duplicating comma-separated parsing in 4 places — DRY violation with identical logic. A generic function is a single source of truth for the "comma-separated reference list" pattern. |
| **Consequences** | Return type depends on the parameter — either overloading or a discriminated union on output is needed. Minimal complexity, justified by eliminating duplication. Scope: `src/parser/parser.ts`. |

## R-0019 — parse() accepts source string for raw-text conditions

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | D-006-1 requires storing IF and REPEAT conditions as raw strings. The parser works with tokens, not source text. To reconstruct raw text (including whitespace), access to the original string is needed. |
| **Decision** | The `parse()` signature is extended: `parse(tokens, dialect, source)`. For IF/REPEAT, the parser computes the condition span and takes `source.slice(startOffset, endOffset)`. In the AST, the condition is stored as `condition: string` (raw text). |
| **Alternatives** | Reconstructing text from token values — loses whitespace and formatting, doesn't match the principle "raw text to end of line". Source is the only reliable origin. |
| **Consequences** | One additional parameter in the public API `parse()`. All call sites (CLI, IDE, tests) are updated trivially — source is already available in each of them (it's the same string passed to `tokenize()`). Scope: `src/parser/parser.ts`, `cli/index.ts`, `src/browser.ts`. |

## R-0020 — WAIT ON $value: parser error, not semantic

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | `WAIT ON` expects `?name` (PromiseRef). If the user writes `ON $data` (ValueRef), that's an error. Question: parser or semantic? |
| **Decision** | Parser error. `parseRefList('PromiseRef')` for WAIT.ON expects a token of type PromiseRef. ValueRef is the wrong token type -> ParseError. This is the same level as "expected ChannelRef, got Identifier" in SEND.TO. |
| **Alternatives** | Syntax/semantics separation (R-0007): the parser checks token types, the validator checks names and declarations. Token type ($ vs ?) is determined by the lexer and is a syntactic property, not semantic. A semantic check would be unjustified complexity. |
| **Consequences** | The test `wait-value-not-promise.coil` belongs in the scope of parser tests. Scope: `src/parser/parser.ts`. |

## R-0021 — BodyValue and AST literals: `type` discriminant in each union variant

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | `BodyValue = TemplateNode | ValueRef | NumberLiteral | StringLiteral`. Without a discriminant, `NumberLiteral { value: number }` and `StringLiteral { value: string }` are distinguishable only via `typeof value` — fragile at runtime and inconvenient for executor/tooling. |
| **Decision** | Each BodyValue variant gets a `type` field: `TemplateNode.type = 'template'`, `ValueRef.type = 'ref'`, `NumberLiteral.type = 'number'`, `StringLiteral.type = 'string'`. Consumers use `switch (body.type)`. |
| **Alternatives** | Without a discriminant — distinguishing via `typeof value`, fragile at runtime. Discriminated union is idiomatic TypeScript, uniform with `TemplatePart.type`, `OperatorNode.kind`. |
| **Consequences** | Each literal/ref creation in the parser gets an additional field. Minimal cost. Added before consumers appeared — zero migration. Scope: `src/ast/nodes.ts`, `src/parser/parser.ts`. |

## R-0022 — Known gaps of phase 1

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | Phase 1 code review identified a number of issues that don't block the current phase but require attention in the future. |
| **Decision** | Record the known limitations as deliberate, with a plan to extend when demand arises. |
| **Alternatives** | Fix everything immediately — premature optimization, there are no consumers for most items. |
| **Consequences** | (1) `readNumber()` — integers only; decimals when demand arises. (2) Comparison operators (`>`, `>=`, `<`, `<=`, `=`, `!=`) are tokenized as `Identifier`; a separate token type — when the expression parser is implemented. (3) `WAIT ON` — mandatory presence is not checked by the parser; `WAIT END` without `ON` creates `WaitNode { on: [] }`; mandatory check is validator scope (R-0007). (4) Silent skip of unknown tokens in `parseThink`, `parseWait`, `parseSend`; tolerant parsing is a deliberate choice for tooling; diagnostic warning is a future task. (5) `expect()` uses `skipTrivia()` internally, which allows comments between arg list elements and RESULT; correct per R-0015. Scope: `src/parser/parser.ts`, `src/lexer/tokenizer.ts`. |

## R-0023 — Tests and code do not reference paths outside the repository

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | When a needed file is missing from `node_modules`, there is a temptation to reference a file outside the repository via `../../` or an absolute path. This violates R-0013 and creates an implicit dependency on the external directory structure. |
| **Decision** | Code and tests inside coil-runtime are prohibited from referencing file paths outside the repository root: `../` above the root, absolute paths to external directories, fallback paths. All external data comes from `node_modules/` (R-0013). If a dependency is outdated — `rm package-lock.json && npm install`. |
| **Alternatives** | Fallback paths with `existsSync` — violates autonomy, tests depend on the external directory structure. |
| **Consequences** | When adding a new file to the `coil` dependency, packages in coil-runtime need to be reinstalled. Tests work when cloning coil-runtime in isolation. |

## R-0024 — lookupDialectWord: extract from parser into dialect module

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | `lookupDialectWord(id, dialect)` is a private function in `parser.ts` (line 1017). It translates an abstract ID (`Op.Actors`, `Mod.Via`) into a dialect keyword (`УЧАСТНИКИ`, `ЧЕРЕЗ`). Currently used only by `formatError()` in the parser. The validator needs it for dialect-dependent diagnostics (D-007-4). |
| **Decision** | Extract `lookupDialectWord()` into a separate file `src/dialect/lookup.ts`. Export through `src/dialect/index.ts` and `src/browser.ts`. The parser imports from `dialect/lookup.ts`. |
| **Alternatives** | (A) Duplicate in the validator — violates DRY. (B) Put in `dialect/types.ts` — types.ts contains only types, adding a runtime function violates the convention. (C) Put in `common/` — the function is specific to dialect, not common. |
| **Consequences** | One additional file in `dialect/`. Minimal change: moving the function + updating the import in `parser.ts`. Scope: `src/dialect/lookup.ts`, `src/dialect/index.ts`, `src/parser/parser.ts`, `src/browser.ts`. |

## R-0025 — Parser-check automation for narrative examples

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-26 |
| **Context** | Stable executable examples need to be at least parser-checkable in an automated flow. `suite.test.ts` covered all `.coil` files in `coil/examples/` and `coil/tests/`, but didn't check COIL-C blocks embedded in narrative `.md` examples (`hello-world.md`, `research-agent.en.md`, `research-agent.ru.md`). |
| **Decision** | Add to `suite.test.ts`: (1) a utility `extractCoilBlocks()` for extracting ` ```coil ` fenced blocks from markdown; (2) helpers `parseStringEN()` / `parseStringRU()` for parsing from a string (existing `parseFile*` are expressed through them); (3) tests for EN narrative examples and RU narrative examples. The file list is specified explicitly, not via auto-discovery — not every `.md` is required to contain parser-checkable COIL-C. |
| **Alternatives** | (A) Auto-discovery of all `.md` — impossible to determine the dialect automatically, and not every `.md` contains complete executable fragments. (B) Require a `.coil` twin for every `.md` and check only twins — delegates responsibility to content authors, doesn't close the gap for existing narrative examples. |
| **Consequences** | Scope: `src/suite.test.ts`. If in the future examples are marked with fence attributes (e.g. `` ```coil {.experimental} ``), the `extractCoilBlocks` regex will need extension. |

## R-0026 — ResultSchema: type model and tolerant compilation

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-27 |
| **Scope** | `src/result/schema.ts`, `src/result/compile.ts`, `src/result/index.ts` |

**Context.** The parser returns `ResultField[]` — a flat array with `depth`. For validation, compilation to JSON Schema, and display in COIL-H, a tree-based type model is needed. The scope is defined as: 5 types (`text`, `number`, `flag`, `choice`, `list`), tree by `depth`, a set of structural constraints.

**Decision.** New directory `src/result/`. Types:

- `ResultSchema` — discriminated union by `kind`: `text`, `number`, `flag`, `choice` (with `options: string[]`), `list` (with `itemFields: ResultSchemaField[]`).
- `ResultSchemaField` — `{ name, description, schema: ResultSchema, span }`.
- `compileResult(fields: ResultField[]): CompileResultOutput` — builds the tree in a single linear pass with a parent stack by `depth`.
- `CompileResultOutput = { fields: ResultSchemaField[], diagnostics: ValidationDiagnostic[] }` — tolerant compilation: on errors (nesting in a scalar, orphan depth), the error is recorded in diagnostics rather than thrown as an exception. Partial structure is preserved for the IDE.

**Rationale.** Tolerant compilation allows collecting all errors in a single pass without losing partial structure. This is critical for the Playground (progressive authoring) and for `coil check` (all errors at once, not just the first one found). The rule `result-leaf-with-children` is naturally generated inside `compileResult`, because that's where the attempt to nest a field in a scalar is visible.

**Cost.** Calling code must check `diagnostics` rather than relying on exceptions. The type model may contain an incomplete tree (e.g., orphan fields are discarded). Consumers must be resilient to this.

## R-0027 — RESULT validation rules: single ValidationRule wrapper

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-27 |
| **Scope** | `src/result/rules.ts`, `src/validator/validator.ts` |

**Context.** The requirements define 5 RESULT validation rules. The current `ValidationRule` interface accepts `(ast, scope, dialect)`. RESULT rules operate on `ResultSchemaField[]` (the type model), not directly on the AST. A way to plug them into the validator registry without duplicating compilation is needed.

**Decision.** One `ValidationRule` wrapper `resultSchemaRule` in `src/result/rules.ts`:

1. Iterates over ThinkNode via `walkOperators`.
2. For each non-empty `think.result`, calls `compileResult` — once per ThinkNode.
3. Runs check functions over `ResultSchemaField[]`.
4. Each check function returns `ValidationDiagnostic[]` with its own `ruleId`.
5. Diagnostics from `compileResult` (including `result-leaf-with-children`) are added to the result.

Rules:
- `result-choice-min-options` (error): `kind === 'choice'` and `options.length < 2`.
- `result-nested-list` (error): `kind === 'list'` inside `kind === 'list'`.
- `result-leaf-with-children` (error): generated in `compileResult` when attempting to nest in a scalar.
- `result-list-no-children` (warning): `kind === 'list'` and `itemFields.length === 0`.
- `result-duplicate-field` (error): two fields with the same `name` at the same level.

`resultSchemaRule` is registered in `createDefaultRegistry()` in `validator.ts`.

**Rationale.** The "single wrapper" approach avoids duplicating compilation (5 rules x each ThinkNode) and preserves clean separation: `src/result/` knows about the type model, `src/validator/` knows about AST traversal. Each check returns its own `ruleId`, so diagnostic granularity is not lost.

**Cost.** `resultSchemaRule` has a composite `ruleId` (the wrapper's formal ID), while the actual diagnostics carry their own individual `ruleId`. This is not a problem: `RuleRegistry.runAll` collects a flat array of diagnostics, the wrapper's `ruleId` never appears in the output.

## R-0028 — Annotation-driven test suite

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-29 |
| **Context** | `suite.test.ts` hardcoded file lists, dialect assignments, and syntactic/semantic split. After metadata annotations were standardized across all `.coil` and `.md` files (`@test`, `@role`, `@dialect`, `@covers`, `@description`), the test suite can discover files and derive expected behavior from annotations instead of maintaining parallel lists. |
| **Decision** | `suite.test.ts` reads `@dialect` to load the correct dialect, `@test valid/invalid` to determine expected outcome. File discovery is recursive. Dialect README showcases (`dialects/*/README.md`) are tested alongside conformance tests and examples. Annotations use HTML comments in `.md` files (`<!-- @dialect ... -->`) and COIL comments in `.coil` files (`' @dialect ...`). |
| **Alternatives** | Keep hardcoded lists — fragile, requires manual sync on every file add/remove/rename. |
| **Consequences** | Adding a new test or example requires only the file itself with correct annotations — no changes to `suite.test.ts`. |

## R-0029 — Runtime is an English-language repository

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-29 |
| **Context** | COIL is dialect-agnostic, but the runtime implementation needs a single language for code, comments, error messages, and test descriptions. |
| **Decision** | Code, comments, CLI messages, and test descriptions in `coil-runtime` are written in English. Abstract IDs use English mnemonics (`Op.Think`, `Mod.Result`). When referring to operators in code or comments, use en-standard keywords (THINK, WAIT, SEND), not keywords from other dialects. |
| **Alternatives** | Bilingual codebase — increases maintenance burden, confuses contributors. |
| **Consequences** | Diagnostic messages are in English by default. Localized diagnostics may be added later as a separate layer. |
