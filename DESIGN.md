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
| **Consequences** | (1) `readNumber()` — integers only; decimals when demand arises. (2) Comparison operators (`>`, `>=`, `<`, `<=`, `=`, `!=`) are tokenized as `Identifier`; a separate token type — when the expression parser is implemented. (3) ~~`WAIT ON` — mandatory presence is not checked by the parser; `WAIT END` without `ON` creates `WaitNode { on: [] }`.~~ Resolved: `parseWait` now requires `Mod.On` and throws `ParseError` for `WAIT END` without `ON`. (4) ~~Silent skip of unknown tokens in `parseThink`, `parseWait`, `parseSend`.~~ Resolved: unexpected tokens inside stable block parsers now throw `ParseError`. `parseBody()` (IF/REPEAT/EACH) also hardened. (5) `expect()` uses `skipTrivia()` internally, which allows comments between arg list elements and RESULT; correct per R-0015. Scope: `src/parser/parser.ts`, `src/lexer/tokenizer.ts`. |

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

## R-0030 — WaitNode: optional binding name for bound WAIT form

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-29 |
| **Context** | Spec 02-core.md § 2.10 defines a bound form `WAIT data ON ?x END` where the resolved value is available as `$data`. The parser and AST did not support this — an implementation gap from STORY-010 (D-010-06). |
| **Decision** | `WaitNode` gains `name: string | null`. The parser reads an optional `Identifier` token after the WAIT keyword and before modifiers. No ambiguity: modifiers (`ON`, `MODE`, `TIMEOUT`) and `END` lex as `Keyword`, not `Identifier`. Scope model and `use-before-wait` rule register the bound name as a `'defined'` variable. No MODE restriction in this phase (open question deferred to language review). |
| **Alternatives** | (A) Store binding as a separate wrapper node — over-engineering for a single optional field. (B) Require sigil (`$data`) in syntax — contradicts spec, which uses bare identifier. |
| **Consequences** | Scope: `src/ast/nodes.ts`, `src/parser/parser.ts`, `src/validator/scope.ts`, `src/validator/rules/use-before-wait.ts`. Existing tests updated with `name: null` regression assertions. New tests: EN bound (MODE ANY, single), RU bound. Integration test: `coil/tests/valid/core/wait-bound.coil`. |

## R-0031 — Test suite hardening: strict metadata with filePath

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-29 |
| **Scope** | `src/suite.test.ts` |

**Context.** `extractCoilMeta` and `extractMdMeta` silently default `@test`, `@dialect`, `@role` when missing. This masks annotation omissions — a test with no `@dialect` silently runs as `en-standard`, potentially hiding a real bug.

**Decision.** (1) `extractCoilMeta(src, filePath)` throws `Error('Missing required @<field> in <filePath>')` when `@test`, `@dialect`, or `@role` is absent. `@description` keeps `?? ''` — it's informational. (2) `extractMdMeta(src, filePath)` throws on missing `@dialect`. `@test` defaults to `'valid'` and `@role` to `'unknown'` — all markdown examples are valid scenarios. (3) Both functions gain a `filePath: string` parameter for diagnostic quality.

**Rationale.** Errors thrown from metadata extraction may occur outside `it()` blocks during file collection. Without `filePath`, vitest shows "unhandled error in describe" with no indication of which file is broken. The `filePath` parameter makes diagnostics unambiguous.

**Cost.** All call sites of `extractCoilMeta` and `extractMdMeta` must pass the file path. Trivial — the path is already available at every call site.

## R-0032 — Error matching: all error codes mandatory

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-29 |
| **Updated** | 2026-03-29 |
| **Scope** | `src/suite.test.ts`, `src/parser/parser.ts`, `src/lexer/tokenizer.ts`, `coil/tests/invalid/*.coil` |

**Context.** Originally, invalid tests for parse errors used only `instanceof` check — `abstractId` on `ParseError` was optional (R-0005) and not consistently set. Validate tests already matched by `ruleId`. This was a deliberate transitional compromise.

**Decision.** (1) `ParseError` and `LexerError` gain a mandatory `errorCode: string` field — kebab-case, stable, machine-readable, by analogy with validator `ruleId`. (2) All 37 `throw new ParseError(...)` and all 6 `throw new LexerError(...)` sites carry a specific code from the registry in STORY-011 phase 4. (3) `@error parse <code>` in invalid tests is now mandatory — every parse/lexer invalid test specifies the expected code. (4) `runInvalidChecks` matches by `errorCode` unconditionally; the `instanceof`-only fallback is removed. (5) `ParseError.abstractId` remains as an optional fourth parameter for dialect-aware diagnostic formatting (R-0005) — it is orthogonal to `errorCode`.

**Rationale.** STORY-011 phase 3 (parser hardening) added 5 new error points. With 37 parser + 6 lexer throw sites, the cost of auditing all sites is justified and the transitional regime is no longer needed. Uniform mandatory codes enable downstream tooling (IDE diagnostics, `coil check --json`) to match errors programmatically.

**Cost.** Every new `throw new ParseError(...)` or `throw new LexerError(...)` must assign a code and register it. Minor overhead, large gain in test precision and tooling support.

## R-0033 — Visitor pattern for validator: single AST walk with rule hooks

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-29 |
| **Scope** | `src/validator/walk.ts`, `src/validator/scope.ts`, `src/validator/validator.ts`, `src/validator/rules/*` |

**Context.** 11 validation rules, 9 of which call `walkOperators()` independently — up to 9 redundant AST traversals per validation. As the rule count grows, this duplicates traversal logic and complicates adding new rules. D-007-6 noted this as acceptable at 8 rules but anticipated the need for a visitor pattern at 15+.

**Decision.** Introduce `VisitorRule` interface and `ScopeWalker`:

(1) New interface:

```typescript
interface VisitorContext extends WalkContext {
  dialect: DialectTable;
  report(diagnostic: ValidationDiagnostic): void;
}

interface VisitorRule {
  ruleId: string;
  enter?(node: OperatorNode, scope: Readonly<ScopeModel>, ctx: VisitorContext): void;
  leave?(node: OperatorNode, scope: Readonly<ScopeModel>, ctx: VisitorContext): void;
  finalize?(scope: Readonly<ScopeModel>, ast: ScriptNode, ctx: VisitorContext): void;
}
```

(2) `ScopeWalker.walk(ast, rules, dialect)` performs a single pre-order traversal. For each node: call `enter` on all rules → update scope (logic from current `buildScope()`) → recurse into children → call `leave` on all rules. After the walk: call `finalize` on all rules. Returns `{ scope, diagnostics }`.

(3) **`enter` is called BEFORE scope update** for the current node. This preserves the contract of positional rules: `use-before-wait` checks refs against scope that does not yet include the current node's contributions; `duplicate-define` checks its seen map before adding.

(4) Scope is passed as `Readonly<ScopeModel>` — mutable internally, read-only for rules. No cloning.

(5) `RuleRegistry` supports both `VisitorRule` and `ValidationRule`. `runAll()`: first runs `ScopeWalker` with all visitor rules → then runs `run()` for standalone rules with the final scope.

(6) Migration map:
- **Visitor `enter`**: `use-before-wait`, `duplicate-define`, `unsupported-operator`, `resultSchemaRule`
- **Visitor `finalize`**: `undeclared-participant`, `undeclared-tool`, `undefined-variable`, `set-without-define`, `undefined-promise`
- **Standalone `run()`** (no change): `exit-required`, `unreachable-after-exit`

(7) **No semantic changes.** Rules that currently check against the final global scope use `finalize()` — behavior is identical. Making rules positional (e.g. `undefined-variable` catching forward references) is a separate semantic decision, not part of this refactoring.

**Rationale.** Single walk eliminates 8 redundant traversals. `VisitorRule` / `ValidationRule` split keeps top-level-only rules simple. `enter`-before-update contract is natural for positional rules and matches ESLint's visitor model. `finalize()` provides a clean migration path for global rules without changing their semantics.

**Cost.** `ScopeWalker` duplicates the scope-building logic currently in `buildScope()` — `buildScope()` can delegate to `ScopeWalker` internally to avoid duplication. Rules that maintain internal state across nodes (`duplicate-define`'s `seen` map, `use-before-wait`'s `reported` set) must manage state lifecycle: initialized once per `walk()` call. The `leave` hook has no consumers today but is included for forward compatibility.

## R-0034 — ComparisonToken: symbolic tokens for comparison operators

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/lexer/tokens.ts`, `src/lexer/tokenizer.ts`, `src/parser/parser.ts` |

**Context.** R-0022 recorded that `=`, `<`, `>`, `<=`, `>=` are tokenized as `Identifier` until an expression parser is implemented. STORY-012 phase 6 introduces the expression parser; the tokenizer must emit typed tokens for these operators.

**Decision.** New token type `ComparisonToken { type: 'Comparison'; operator: string; span: SourceSpan }`. The lexer emits it for: `=`, `==`, `!=`, `<`, `>`, `<=`, `>=`. Seven symbols total.

Key points:
- Comparison operators are universal symbols, not dialect-dependent. They are NOT added to the dialect table — unlike `AND`/`OR`/`NOT`/`TRUE`/`FALSE` which are dialect keywords (category `expressions`).
- `==` and `!=` are tokenized as `ComparisonToken` (not rejected in the lexer) so the expression parser can give a clear error with code `disallowed-operator` (D-0034, D-0035).
- For `!=`: the lexer checks `!` followed by `=` **before** ToolRef sigil processing. `!` followed by a non-`=` character continues to ToolRef parsing as before.
- The existing `Identifier` fallback for `=`/`<`/`>`/`<=`/`>=` is removed. `parseSignatureLine()` and `parseIf()` will no longer see these as `Identifier` tokens.

**Alternatives.** (A) Add comparisons to dialect table as category `comparisons` — semantically wrong: `<` is not a word that changes per language. (B) Keep as `Identifier` and parse in expression parser — loses type safety, expression parser must string-match on `Identifier.name`.

**Cost.** Existing parser code that collects condition tokens via `parseSignatureLine()` may rely on these being `Identifier`. After this change, `parseIf` and `parseRepeat` must handle `ComparisonToken` in their token streams. This is addressed by the expression parser integration (R-0035).

## R-0035 — Expression parser: separate file, AST nodes in ast/nodes.ts

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/ast/nodes.ts`, `src/parser/expression.ts`, `src/parser/parser.ts` |

**Context.** STORY-012 phase 6.1 requires an expression parser for IF conditions and REPEAT UNTIL. The existing `parser.ts` is 1043 lines. The expression grammar is self-contained. A decision on code placement and AST shape is needed.

**Decision.**

(1) **Expression AST nodes** in `src/ast/nodes.ts`:

```
ExpressionNode = BinaryExpr | UnaryExpr | GroupExpr | LiteralExpr | VarRefExpr

BinaryExpr   { kind: 'BinaryExpr'; op: ComparisonOp | LogicOp; left: ExpressionNode; right: ExpressionNode; span }
UnaryExpr    { kind: 'UnaryExpr'; op: 'Not'; operand: ExpressionNode; span }
GroupExpr    { kind: 'GroupExpr'; inner: ExpressionNode; span }
LiteralExpr  { kind: 'LiteralExpr'; value: string | number | boolean; literalType: 'string' | 'number' | 'boolean'; span }
VarRefExpr   { kind: 'VarRefExpr'; name: string; path: string[]; span }

ComparisonOp = '=' | '<' | '>' | '<=' | '>='
LogicOp      = 'And' | 'Or'
```

No separate `FieldAccessExpr` — the lexer already tokenizes `$name.a.b` as a single `ValueRefToken { path: ['a', 'b'] }`. `VarRefExpr` carries the path.

(2) **Expression parser** in `src/parser/expression.ts`. Recursive descent. Accepts a token slice (array + start index), returns `{ expr: ExpressionNode; nextIndex: number }`. Called from `parseIf` and `parseRepeat` in `parser.ts`.

(3) **AST change**: `IfNode.condition` changes from `string` to `ExpressionNode`. `RepeatNode.until` changes from `string | null` to `ExpressionNode | null`. This is a breaking change to the AST interface. All consumers (validator scope-walker, tests, IDE) must be updated.

(4) **R-0019 is superseded** in part: `parse()` still accepts `source` (needed for other raw-text uses), but IF/REPEAT conditions no longer use `source.slice()` for raw-text reconstruction.

(5) **Error handling split: parse vs validate.** The expression parser is tolerant for structural issues (to match the conformance test annotations and provide partial AST for IDE). Errors are split between two phases:

**Expression parser rejects (ParseError):** token-level errors where the form itself is invalid.
- `==` → code `disallowed-operator` (matches test `if-double-equals.coil`)
- `!=` → code `disallowed-operator` (matches test `if-not-equals-operator.coil`)
- Arithmetic tokens (`+`, `-`, etc.) → code `arithmetic-deferred` (matches test `if-arithmetic.coil`)
- Empty condition → code `expr-empty-condition`
- Unexpected token → code `expr-unexpected-token`

**Validator catches (new VisitorRules):** structural issues where tokens are valid but the combination is forbidden.
- Chained comparisons (`1 < $x < 10`) → ruleId `chained-comparison` (matches test `if-chained-comparison.coil`)
- Mixed `AND`/`OR` without parentheses → ruleId `mixed-and-or-without-parens` (matches test `if-mixed-and-or.coil`)
- Bare variable reference as condition (truthiness) → ruleId `truthiness-deferred` (matches test `if-truthiness.coil`)

Error codes are dictated by the conformance test annotations in `coil/tests/invalid/` and must match exactly.

(6) **Precedence** (D-0033): `NOT` (highest) > comparisons (`=`, `<`, `>`, `<=`, `>=`) > `AND`/`OR` (lowest, same priority). Since `AND` and `OR` share a priority level, the expression parser parses them left-to-right without distinguishing. A validation rule (`mixed-and-or-without-parens`) then rejects trees where both operators appear without grouping.

(7) **Tolerant parsing for structural errors.** The expression parser builds AST even for structurally invalid expressions:
- Chained `1 < $x < 10` → builds `BinaryExpr(<, BinaryExpr(<, Lit(1), Var($x)), Lit(10))`.
- Mixed `$a > 0 AND $b > 0 OR $c > 0` → builds tree with mixed ops.
- Truthiness `$done` → builds lone `VarRefExpr`.
This preserves partial AST for IDE diagnostics and matches the `validate`-phase test annotations.

**Alternatives.** (A) Expression parser inside `parser.ts` — inflates an already large file. (B) Separate module `src/expression/` — over-engineering for one file. (C) Pratt parser — equivalent power for this grammar, but recursive descent is more readable for the simple precedence structure. (D) Parser rejects all expression errors — violates conformance test annotations which require `validate`-phase detection for structural issues.

**Cost.** Breaking AST change: `IfNode.condition: string → ExpressionNode`, `RepeatNode.until: string | null → ExpressionNode | null`. Every test that asserts on these fields must be updated. Three new validation rules required: `chained-comparison`, `mixed-and-or-without-parens`, `truthiness-deferred`. Scope: parser tests, validator tests, suite tests, IDE code (if any).

## R-0036 — Executor scope: chain with parent for nested blocks

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/executor.ts` |

**Context.** The executor uses a flat `Map<string, unknown>` for scope. D-0045 requires EACH iterations to have isolated scopes. IF and REPEAT also nest body statements.

**Decision.**

(1) Introduce `Scope` abstraction in the executor:
```
Scope {
  parent: Scope | null
  bindings: Map<string, unknown>
  get(name): unknown     — walks up the chain
  set(name, value): void — writes to current bindings
  has(name): boolean     — walks up the chain
  child(): Scope         — creates child with parent = this
}
```

(2) **IF / REPEAT** — body executes in the **current** scope (no child). DEFINE/SET inside are visible after the block. This matches the validator model where variables inside IF are `conditional: true` but still in the same scope level.

(3) **EACH** — each iteration creates `scope.child()`. `$element` is set in the child. DEFINE/SET inside the iteration are in the child. After iteration, the child is discarded. Variables from one iteration don't leak to the next or to the parent.

(4) **BodyValue resolution** for DEFINE/SET. New utility `resolveBodyValue(body: BodyValue, scope: Scope): unknown`:
- `TemplateNode` → `interpolate(template, scope)` → string
- `ValueRef` → `scope.get(name)` + `resolveFieldPath()` → unknown
- `NumberLiteral` → `lit.value` (number)
- `StringLiteral` → `lit.value` (string)

**Alternatives.** (A) `new Map(parentMap)` per iteration — O(n) copy per iteration, wasteful for large scopes. (B) Copy-on-write — complexity not justified for v0.4 scope sizes.

**Cost.** `interpolate()` must accept `Scope` instead of `Map<string, unknown>`. Existing tests pass `Map` — need adapter or conversion. Minimal: `Scope` can wrap a `Map` as root.

## R-0037 — Field access traversal: strict, error on missing property

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/executor.ts` |

**Context.** `$name.a.b.c` requires property traversal on `unknown` values. Both the expression evaluator (`VarRefExpr`) and template interpolation (`RefPart`) need this. The existing `interpolate()` throws `NotImplementedError` for any path.

**Decision.**

(1) New utility `resolveFieldPath(root: unknown, path: string[], span: SourceSpan): unknown`. Shared by expression evaluator and `interpolate()`.

(2) **Strict traversal rules:**
- Intermediate `null` or `undefined` → execution error: `"cannot access .<field> on null/undefined"`.
- Intermediate is not an object (`typeof !== 'object'`) → execution error: `"cannot access .<field> on <typeof>"`.
- Property does not exist on object (`!(key in obj)`) → execution error: `"property .<field> does not exist on $name"`.
- Last step returns the value as-is (may be `null`, `undefined`, any type).

(3) **Rationale for strict:** COIL is for users, not programmers. Silent `undefined` on a typo (`$result.typo`) would produce confusing downstream errors (e.g. `undefined = "bug"` evaluates to `false` with no indication of why). Strict access catches mistakes at the point of origin.

(4) `interpolate()` is updated: replace `NotImplementedError` with `resolveFieldPath()` call.

**Alternatives.** (A) JavaScript semantics (silent undefined for missing property) — user-hostile, masks typos. (B) Optional chaining with `?` syntax — not in COIL v0.4 spec.

**Cost.** Every object value in scope must have all accessed properties. Authors can't defensively access "maybe" fields. This is deliberate — COIL favors explicit structure over defensive flexibility.

## R-0038 — EACH iterable contract: Array only in v0.4

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/executor.ts` |

**Context.** `EACH $element FROM $source` requires `$source` to be iterable. The spec does not fix the type. A runtime contract is needed.

**Decision.** For v0.4: `$source` must be a JavaScript `Array`. Any other type → execution error: `"$source is not iterable (expected array, got <typeof>)"`. Empty array → zero iterations, no error.

Deferred: objects (entry iteration), strings (character iteration), `Symbol.iterator` protocol. When added, this will be a new R-decision, not a change to R-0038.

**Alternatives.** (A) Any iterable via `Symbol.iterator` — opens the door to generators, custom iterables, but no COIL construct currently produces non-array iterables. Premature. (B) Array + object — ambiguous iteration order for objects across engines.

**Cost.** If a provider returns a non-array collection, the author must first convert it. This is acceptable — COIL is not a general-purpose language.

## R-0039 — Typ.Object: named-fields container in RESULT

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/dialect/types.ts`, `src/result/schema.ts`, `src/result/compile.ts`, `src/result/rules.ts`, `src/parser/parser.ts` |

**Context.** Spec v0.4 added `Typ.Object` (OBJECT / ОБЪЕКТ / 構造 / 对象) as a RESULT type for named-fields records. Dialect tables already include it. The runtime type system, schema compiler, and validation rules don't know about it — `fieldToSchema` falls through to default `text`, and nesting into a non-list/non-object is flagged as `result-leaf-with-children`.

**Decision.** Add `Typ.Object` support to the RESULT pipeline:

(1) `TypId` union: add `'Typ.Object'`. Update `ALL_TYP_IDS`.

(2) `ResultSchema` union: add `ObjectSchema { kind: 'object'; fields: ResultSchemaField[] }`.

(3) `compileResult` / `fieldToSchema`: `case 'Typ.Object': return { kind: 'object', fields: [] }`. Nesting logic: OBJECT is a container like LIST — children go into `objectSchema.fields`, stack pushes for depth tracking.

(4) Validation rules: all four check functions (`checkChoiceMinOptions`, `checkNestedList`, `checkListNoChildren`, `checkDuplicateField`) recurse into `object.fields`. `result-leaf-with-children` in `compileResult` allows nesting in `object` (same as `list`). `result-nested-list` propagates `parentIsList` through OBJECT transparently (LIST > OBJECT > LIST is still nested-list). OBJECT inside OBJECT is valid.

(5) Parser: `parseResultBlock` has a hardcoded `isAnyKeywordOf([...])` list of accepted type IDs — added `'Typ.Object'`. Without this, the parser rejected OBJECT as an unknown result type despite the dialect table containing it.

**Rationale.** COIL agents interact with tools and models that return nested objects. Field access `$result.metadata.author` already works in the executor (R-0037). Without OBJECT in RESULT, authors cannot describe the structure the LLM should produce for nested non-list data. This creates an artificial asymmetry: field access works, but the schema can't express the shape.

**Cost.** One more variant in the discriminated union. Minimal — OBJECT behaves identically to LIST in the compiler, just semantically different (single record vs array of records).

## R-0040 — Executor pause-resume: explicit state machine, not generators

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/executor.ts`, `src/executor/snapshot.ts` |

**Context.** The SDK must support two hosting modes: stateful (CLI, long-running server) and stateless (serverless, snapshot restore). The executor must be able to yield at any wait point (RECEIVE, WAIT, SEND AWAIT) inside arbitrarily nested blocks (IF, REPEAT, EACH), serialize its state as a JSON snapshot, and resume from that snapshot in a potentially different process.

Three approaches were considered: (A) async generators (`async function*`) — natural yield in TS, but generators are not serializable; stateless restore requires either replay (expensive for long scripts) or a hybrid with two execution paths; (B) explicit state machine with program counter — one execution path for both modes, snapshot is the single source of truth, instant restore without replay; (C) hybrid generator + state machine — two engines that must produce identical behavior, hard to test.

**Decision.** Explicit state machine (option B). The executor is a regular function, not a generator. Execution state (scope chain, program counter, pending promises, stream handles) is an explicit `ExecutionSnapshot` object. At each yield point the executor saves the snapshot via `StateProvider.save()` and returns a `YieldRequest` to the host. On resume the executor loads the snapshot, restores the program counter, and continues from the exact position.

Program counter format: see R-0041.

**Rationale.** One execution path eliminates the class of bugs where stateful and stateless modes diverge. Program counter as `number[]` directly maps to the AST nesting structure (ScriptNode → body of IF/REPEAT/EACH → nested body). Instant restore without replay is critical for serverless hosting where a RECEIVE may block for hours/days.

**Cost.** More boilerplate than generators: every nested block dispatcher must read/advance the program counter explicitly. New operators with nesting must integrate with the program counter. Code is less idiomatic TypeScript than `yield*`. However, the code is easier to test step-by-step, and the snapshot format is self-documenting.

## R-0041 — Program counter: typed path segments

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/snapshot.ts` |

**Context.** R-0040 defines the executor as an explicit state machine with a program counter. The program counter must encode the position inside arbitrarily nested blocks. EACH has iterations (indexed by element), IF/REPEAT have a body but no iteration index. A flat `number[]` is compact but the meaning of each element depends on the node type — the reader must consult the AST to interpret the counter. A typed format is self-describing.

Three approaches were considered: (A) flat `number[]` with interleaved semantics — compact, but each element's meaning is context-dependent; (B) typed path segments — `Array<{ node: number; iteration?: number }>` — self-describing, readable without AST; (C) flat `number[]` with a convention (EACH always adds two elements) — essentially (A) with a rule.

**Decision.** Typed path segments (option B). Program counter is `ProgramCounter = PathSegment[]`.

```
PathSegment = { node: number; iteration?: number }
```

Examples:
- `[{ node: 5 }]` — top-level node 5.
- `[{ node: 3, iteration: 3 }, { node: 0 }]` — node 3 (EACH), iteration 3, body node 0 (RECEIVE).
- `[{ node: 2 }, { node: 1, iteration: 7 }, { node: 0 }]` — node 2 (IF), body node 1 (EACH), iteration 7, body node 0.

`iteration` is present only for EACH (and future iterable constructs). IF and REPEAT omit it. REPEAT could add it later if needed (e.g., for debugging "which iteration are we on") without breaking the format.

**Rationale.** Snapshot is not a hot path — the extra bytes from typed objects don't matter. Debugging and logging benefit enormously: a program counter like `[{ node: 3, iteration: 3 }, { node: 0 }]` is immediately readable. New node types with custom state (e.g., a future PARALLEL construct) can add fields to `PathSegment` without changing existing code.

**Cost.** JSON is ~3x larger than flat `number[]`. Irrelevant for typical COIL scripts (depth 2–4). Every nested block dispatcher constructs a `PathSegment` object instead of pushing a number. Minimal overhead.

## R-0042 — ModelProvider receives compiled ResultSchemaField[], not raw fields

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/sdk/providers.ts`, `src/executor/executor.ts` |

**Context.** `ThinkNode.result` in the AST is `ResultField[]` — a flat array with `depth`, a parser-level representation (R-0026). `ModelProvider.call(config)` needs a result schema to instruct the LLM what structure to produce. Two representations exist in the runtime: raw `ResultField[]` and compiled `ResultSchemaField[]` (tree, from `compileResult()`). The question: which one enters the SDK contract?

Three options: (A) compiled `ResultSchemaField[]` — executor compiles before calling provider; (B) raw `ResultField[]` — provider compiles itself; (C) compiled tree + ready-made JSON Schema — executor also generates a standard schema.

**Decision.** Option A. The executor calls `compileResult()` and passes `ResultSchemaField[]` to `ModelProvider.call()`. The provider receives a clean tree structure: `{ name, description, schema: ResultSchema }` where `ResultSchema` is the discriminated union (`text | number | flag | choice | list | object`).

JSON Schema generation (or any other LLM-specific format) is the responsibility of the provider implementation, not the executor. Different LLM APIs require different schema formats (OpenAI function calling, Anthropic tool use, XML instructions, etc.). The SDK defines the semantic model; the provider translates it.

**Rationale.** `ResultSchemaField[]` is already a stable type in the runtime (R-0026), JSON-serializable, and intuitive. Raw `ResultField[]` leaks parser details (`depth`) into the public SDK contract. JSON Schema generation in the executor would couple it to a specific LLM API standard.

**Cost.** `compileResult()` runs in the executor before each THINK with a non-empty RESULT block. Compilation is O(n) and cheap. Provider authors work with a tree, not a flat depth-indexed array — this is easier to consume.

## R-0043 — Promise registry in ExecutionSnapshot: status + name, no invocation descriptor

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/snapshot.ts`, `src/executor/executor.ts` |

**Context.** THINK/EXECUTE/SEND create promises (`?name`). The executor may yield (at WAIT or RECEIVE) while some promises are still pending. The snapshot must represent pending and resolved promises in a JSON-serializable form. JavaScript `Promise` objects cannot be serialized. The question: what does the snapshot store, and how does the host know which promises to fulfill on resume?

Three options: (A) promise registry `Map<string, PendingPromise>` with status and origin operator type — the host sees which promises are pending by name; (B) only a list of awaited names — minimal, but no provenance info; (C) registry with full invocation descriptor (provider type + call params) — the host can re-invoke lost calls, but params can be large and re-invocation is not always idempotent.

**Decision.** Option A — promise registry without invocation descriptor.

```
PromiseEntry = {
  status: 'pending' | 'resolved';
  origin: 'think' | 'execute' | 'send';
  result?: unknown;  // present when status === 'resolved'
}
```

`ExecutionSnapshot.promises: Record<string, PromiseEntry>`.

When a launching operator (THINK, EXECUTE, SEND with AWAIT) executes, the executor adds an entry `{ status: 'pending', origin }` to the registry. When a promise resolves (via ResumeEvent), the executor sets `status: 'resolved'` and stores the result. Resolved values are also written into the scope chain as `$name`.

For WAIT ALL on `?a, ?b, ?c`: if two of three are already resolved before yield, their entries have `status: 'resolved'` in the snapshot. The host only needs to supply ResumeEvent for the remaining pending entries. The executor on resume checks which promises are still pending and waits accordingly.

**Rationale.** Promise names are unique within a scope (enforced by the validator: `duplicate-define`). The registry is self-describing: the host reads `snapshot.promises`, filters by `status: 'pending'`, and knows exactly what to fulfill. Invocation descriptors (option C) are tempting but dangerous: re-invoking SEND or EXECUTE is not idempotent, and storing full prompts/contexts bloats the snapshot. If the host loses a pending result, that's a host-level failure, not an executor concern.

**Cost.** The registry duplicates resolved values (present in both `promises[name].result` and `scope.$name`). This is acceptable — resolved entries can be pruned from the registry after WAIT consumes them. The `origin` field is informational (useful for debugging and host logic) and costs one string per entry.

## R-0044 — AWAIT correlation: host aggregates, executor receives one ResumeEvent

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/sdk/providers.ts`, `src/executor/executor.ts`, `src/executor/snapshot.ts` |

**Context.** `SEND ... AWAIT ALL` sends a message to multiple participants and waits for replies from all of them. D-0036 says "correlation of replies with promises is host-defined". But the executor must know when all replies are collected to resolve the promise and continue. The question: who counts replies, and how does the executor learn that "all" have arrived?

Three options: (A) `ChannelProvider.deliver()` returns a `correlationId`, executor counts replies one by one — executor takes on business logic of "what counts as all"; (B) `deliver()` returns a JS `Promise<Reply[]>` — not serializable, breaks stateless mode; (C) `deliver()` returns a `correlationId`, the host aggregates replies according to the await policy and delivers one `ResumeEvent` with the complete result.

**Decision.** Option C — hybrid with host-side aggregation.

Flow:
1. Executor calls `ChannelProvider.deliver(channel, participantIds, message)` → receives `correlationId: string`.
2. Executor stores `correlationId` in the promise registry (R-0043): `{ status: 'pending', origin: 'send', correlationId }`.
3. Executor yields: `YieldRequest { type: 'await-replies', promiseName, correlationId, awaitPolicy: 'any' | 'all' }`.
4. The host collects replies externally (transport-specific). For `'all'` — waits until all expected replies arrive. For `'any'` — takes the first.
5. The host resumes: `ResumeEvent { type: 'MessageReply', correlationId, replies: Reply[] }` — one event, one array (`replies.length === 1` for ANY, `>= 1` for ALL, chronological order per D-0036).
6. Executor resolves the promise, writes `$name` to scope, continues.

No intermediate states in the snapshot. Between `deliver` and resume, the snapshot contains a pending promise with `correlationId`. The host is responsible for aggregation, timeout enforcement, and deciding what "all participants replied" means.

**Rationale.** The executor should not count replies — that's business logic (D-0038: structure consistency is a business concern). `correlationId` is the minimal coupling between executor and host: executor says "I sent this, wake me when done", host says "here are the results". One ResumeEvent per promise maps cleanly to the state machine model (R-0040): deliver → yield → one resume = done. No partial states, no intermediate yields between replies.

**Cost.** The host must implement aggregation logic. For `AWAIT ALL`, the host must track which participants have replied and when all are accounted for. This is inherently transport-specific (Slack has different reply semantics than email) and belongs in the host, not the executor. `ChannelProvider.deliver()` gains a return type `Promise<{ correlationId: string }>`.

## R-0045 — SendNode.await: null preserved in AST, helper resolves default

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/ast/nodes.ts`, `src/sdk/helpers.ts`, `src/executor/executor.ts`, `src/validator/rules/*` |

**Context.** The parser currently sets `SendNode.await = null` when the AWAIT modifier is absent. D-0036 defines: "if AWAIT is omitted, AWAIT NONE is implied". STORY-014 phase 3 asks: should the parser start setting `'none'` instead of `null`, or should consumers handle the default?

This matters for COIL-H round-trip (D-0046): the table view must distinguish "author explicitly wrote AWAIT NONE" from "author wrote nothing" — they render differently (explicit cell value vs empty cell).

Three options: (A) parser sets `'none'` — consumers are simpler, but AST loses information; (B) parser preserves `null`, every consumer writes `?? 'none'` — lossless but DRY violation; (C) parser preserves `null`, a shared helper `resolveAwaitPolicy()` is the single point of truth for the default.

**Decision.** Option C. AST remains lossless: `SendNode.await: 'none' | 'any' | 'all' | null`. A helper function `resolveAwaitPolicy(node: SendNode): 'none' | 'any' | 'all'` returns the effective policy, treating `null` as `'none'`. The executor and validator call the helper. IDE/COIL-H reads `node.await` directly to distinguish explicit from implicit.

**Rationale.** Lossless AST is a principle already established by R-0014 (CommentNode preserved for COIL-H) and R-0005 (typed nodes). The helper is a one-liner but prevents the class of bugs where a consumer forgets `?? 'none'` and treats `null` as a distinct fourth state. The validation rule `send-name-with-await-none` (D-0036) calls the helper and checks: `resolveAwaitPolicy(node) === 'none' && node.name !== null` → preparation error.

**Cost.** One extra function call per SendNode processing. Consumers must know to use the helper instead of reading `.await` directly for execution logic. This is documented in JSDoc on the `await` field itself: "null means omitted; use `resolveAwaitPolicy()` for effective value".

## R-0046 — Snapshot boundary: executor state only, providers manage their own persistence

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/snapshot.ts`, `src/sdk/providers.ts` |

**Context.** `ExecutionSnapshot` stores executor-controlled state: scope chain, program counter (R-0041), promise registry (R-0043). But there is also provider-side state: stream buffers in StreamProvider, reply aggregation in ChannelProvider, pending model calls in ModelProvider. In stateless hosting (serverless), the executor restores from snapshot, but providers are fresh objects created by the host. The question: does the snapshot include provider state, or does each provider manage its own persistence separately?

Three options: (A) snapshot = executor state only, providers manage their own persistence — clean separation, but two sources of truth; (B) snapshot includes provider state via `getState()/setState()` callbacks on each provider — atomic save/restore, but opaque blobs in snapshot; (C) snapshot stores handles and correlationIds, providers are stateless by contract — simple providers, but stream buffers need restoration somehow.

**Decision.** Option A — snapshot contains only executor state. Provider state is the host's responsibility.

Snapshot contains:
- Scope chain (nested, D-014-03)
- Program counter (typed path segments, R-0041)
- Promise registry (R-0043)
- Stream handles (passive data, D-014-04) — names and ownerIds only
- Budget consumed (counters)

Snapshot does NOT contain:
- Stream buffer contents (StreamProvider internal state)
- Reply aggregation state (ChannelProvider internal state)
- Pending LLM call state (ModelProvider internal state)
- Any opaque provider blobs

The host is responsible for ensuring that provider state is consistent with the executor snapshot on restore. For stateful mode (CLI, long-running server) — everything is in memory, no issue. For stateless mode — the host uses its own storage (Redis, DB, etc.) for provider state, keyed by execution ID or correlation IDs from the snapshot.

**Rationale.** Providers are pluggable (D-014-01). The executor does not know their internal structure. Adding `getState()/setState()` to every provider interface would:
(1) couple the snapshot format to provider implementations,
(2) make snapshots unpredictable in size (a stream buffer could be megabytes),
(3) create opaque blobs that are impossible to debug or inspect.

Clean separation means the snapshot is self-contained, predictable, and transparent. The cost is that the host must coordinate two persistence paths — but the host already owns the providers and knows how to persist their state.

**Cost.** Two sources of truth: executor snapshot and provider state. If they desynchronize (e.g., snapshot says promise is pending but the provider lost the pending call), the execution may fail on resume. This is a host-level failure, analogous to a database crash — not something the executor can prevent. The host contract includes: "if you save a snapshot, ensure your providers can resume from the same point".

## R-0047 — Stream buffer limit: provider-level config, not per-stream

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/sdk/providers.ts` |

**Context.** D-0039 defines: "buffer limit is host-defined, overflow is an execution error". But the API for configuring the limit is not specified. The executor calls `StreamProvider.createStream(name, ownerId)` — should it pass buffer configuration, or is the limit set when the provider is constructed?

Three options: (A) limit as a parameter of `createStream()` — granular per-stream, but executor doesn't know business logic of limits; (B) limit as provider-level configuration at construction time — simple, one limit for all streams; (C) both default in constructor and per-stream override — maximum flexibility, premature for v0.4.

**Decision.** Option B. The buffer limit is a provider-level configuration, set by the host when constructing the StreamProvider. All streams created by that provider share the same limit.

`StreamProvider` constructor (host-side): accepts `{ bufferLimit: number }` (or equivalent config). The executor does not pass buffer options — it calls `createStream(name, ownerId)` with no configuration parameters.

Per-stream override can be added later as an optional parameter to `createStream()` without breaking the existing interface.

**Rationale.** The executor should not make decisions about buffer sizes — that's infrastructure configuration, not protocol logic. A single provider-level limit covers all v0.4 use cases: typical COIL scripts have 1–3 streams with similar buffering needs. Per-stream tuning is a production concern that can be deferred to post-v0.4 when real usage patterns emerge.

**Cost.** No per-stream tuning in v0.4. If a host needs different limits for different streams, it must create multiple StreamProvider instances or wait for the per-stream override extension.

## R-0048 — SIGNAL-close ordering: no race in v0.4, executor checks isOpen

| | |
|---|---|
| **Status** | accepted |
| **Decided** | 2026-03-31 |
| **Scope** | `src/executor/executor.ts`, `src/sdk/providers.ts` |

**Context.** D-0041 says SIGNAL after close is an execution error. D-0040 says SIGNAL is asynchronous. In a concurrent system, a race between SIGNAL and stream close could produce ambiguous behavior. The question: does v0.4 need ordering guarantees or conflict resolution for SIGNAL vs close?

**Analysis.** Race condition is impossible in v0.4 due to three constraints working together:

1. The executor is a sequential state machine (R-0040). It does not execute SIGNAL and WAIT simultaneously.
2. Streams are single-instance ownership (D-0039). Only the owning instance sends SIGNALs and waits on the stream.
3. Close is tied to promise resolution (D-0041). A promise resolves via ResumeEvent, which the executor processes during WAIT — a deliberate executor step, not a spontaneous external event.

Therefore: SIGNAL always occurs before close in the executor's step sequence, because close can only happen when the executor processes a WAIT resume. The only scenario where SIGNAL follows close is when the author writes SIGNAL after the WAIT that resolved the promise — this is a legitimate authoring error, caught by the `isOpen` check.

**Decision.** No special ordering mechanism for v0.4. The executor checks `StreamProvider.isOpen(handle)` before each SIGNAL. If the stream is closed, the executor throws an execution error with a diagnostic pointing to the SIGNAL source span.

`StreamProvider` interface gains: `isOpen(handle: StreamHandle): boolean`.

Cross-instance and multi-consumer scenarios (deferred per D-0039) will introduce real concurrency and will need a separate ordering mechanism (timestamps, happens-before, or explicit close protocol). This is explicitly out of scope for v0.4.

**Rationale.** Adding concurrency control for a sequential executor is premature complexity. The three constraints (sequential executor, single-instance ownership, close-on-resolve) form a complete safety net. Documenting this analysis prevents future developers from adding unnecessary locking.

**Cost.** One `isOpen()` call per SIGNAL execution. Negligible.
