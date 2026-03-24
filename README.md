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
| Parser + AST | Planned |
| Semantic validator | Planned |
| Executor | Planned |
| SDK interfaces | Planned |
| Reference implementations | Planned |

## CLI

```bash
coil parse script.coil     # parse → AST or syntax errors
coil check script.coil     # semantic validation
coil run script.coil       # execute with reference SDK implementations
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

The [COIL spec repository](https://github.com/animata-systems/coil) contains a conformance test suite in `tests/`. The CI pipeline for this repository runs the full test suite against the parser and validator.

```bash
# Run conformance tests
make test-conformance
```

A spec-compliant implementation must:
- accept all files in `tests/valid/`
- reject all files in `tests/invalid/` at preparation time

## Dialect support

The runtime operates on construct semantics, not keyword spelling. Dialect support is implemented as a keyword mapping layer on top of the parser.

## Related

- [coil](https://github.com/animata-systems/coil) — language specification
- [coil-ide](https://github.com/animata-systems/coil-ide) — web editor (uses this parser)
- [coil-sandbox](https://github.com/animata-systems/coil-sandbox) — sandbox host environment (uses this runtime)

---

Animata Systems
