# coil-runtime

Reference implementation of the COIL language runtime.

Parser, AST, semantic validator, execution engine, and SDK interfaces for embedding COIL in a host environment.

## What this is

`coil-runtime` is the canonical implementation of the [COIL specification](https://github.com/animata-systems/coil). It provides:

- **Parser** — tokenizer and AST builder for COIL-C (all dialects)
- **Validator** — preparation-time semantic checks
- **Executor** — deterministic control flow engine
- **SDK interfaces** — contracts for embedding COIL in a host environment
- **Reference implementations** — in-memory providers for development and testing
- **CLI** — `coil` command line tool

## Status

| Component | Status |
|---|---|
| Parser + AST | RECEIVE, SEND (all modifiers), EXIT; unsupported operators → UnsupportedOperatorNode |
| Semantic validator | exit-required, unreachable-after-exit, unsupported-operator |
| Executor | RECEIVE → stdin, SEND (no modifiers) → stdout, EXIT → return |
| SDK interfaces | Planned (`Environment` interface exists) |
| Reference implementations | Planned |
| CLI | `coil run` with `--dialect` flag |

## CLI

```bash
coil run script.coil --dialect path/to/dialect.json   # execute (implemented)
coil parse script.coil     # parse → AST or syntax errors (planned)
coil check script.coil     # semantic validation (planned)
```

## SDK interfaces

To embed COIL in your host environment, implement these interfaces:

| Interface | Responsibility |
|---|---|
| `ParticipantProvider` | Resolve `@name`, deliver and receive messages |
| `ChannelProvider` | Channels `#name`, routing, replies |
| `ToolProvider` | Resolve `!name`, invoke, arguments, result |
| `ModelProvider` | Resolve `$model` for VIA, call LLM, structured output |
| `BudgetPolicy` | Token, step, and time limits |

## Conformance tests

The [COIL spec repository](https://github.com/animata-systems/coil) contains a conformance test suite in `tests/`. The test suite runs `tests/valid/` and `tests/invalid/` files through the parser (122 tests total).

```bash
npm test
```

A spec-compliant implementation must:
- accept all files in `tests/valid/`
- reject all files in `tests/invalid/` at preparation time

## Dialect support

The runtime operates on construct semantics, not keyword spelling. Dialect support is implemented as a keyword mapping layer on top of the parser. The CLI requires an explicit `--dialect <path>` flag pointing to a JSON dialect table — no built-in dialects (R-0002).

## Design decisions

Implementation decisions (code structure, AST format, parser strategy, CLI behavior) are documented in [DESIGN.md](DESIGN.md) with rationale and trade-offs.

## Related

- [coil](https://github.com/animata-systems/coil) — language specification
- [coil-ide](https://github.com/animata-systems/coil-ide) — web editor (uses this parser)
- [coil-sandbox](https://github.com/animata-systems/coil-sandbox) — sandbox host environment (uses this runtime)

---

Animata Systems
