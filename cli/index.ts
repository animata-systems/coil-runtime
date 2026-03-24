#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import {
  loadDialect, KeywordIndex,
  tokenize,
  parse,
  validate,
  execute, CliEnvironment,
} from '../src/index.js';

const USAGE = `Usage: coil run <file> --dialect <path>

Arguments:
  <file>              Path to .coil script
  --dialect <path>    Path to dialect table JSON file`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] !== 'run') {
    console.error(USAGE);
    process.exit(1);
  }

  // Parse: coil run <file> --dialect <path>
  let file: string | undefined;
  let dialect: string | undefined;

  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--dialect') {
      if (i + 1 >= rest.length || rest[i + 1].startsWith('-')) {
        console.error('error: dialect path missing after --dialect');
        console.error(USAGE);
        process.exit(1);
      }
      dialect = rest[++i];
    } else if (!rest[i].startsWith('-')) {
      file = rest[i];
    }
  }

  if (!file) {
    console.error('error: file not specified');
    console.error(USAGE);
    process.exit(1);
  }

  if (!dialect) {
    console.error('error: dialect not specified');
    console.error(USAGE);
    process.exit(1);
  }

  // Pipeline: file → readFile → loadDialect → tokenize → parse → validate → execute
  try {
    const [source, dialectTable] = await Promise.all([
      readFile(file, 'utf-8'),
      loadDialect(dialect),
    ]);

    const keywords = KeywordIndex.build(dialectTable);
    const tokens = tokenize(source, keywords);
    const ast = parse(tokens, dialectTable);
    const result = validate(ast);

    // Output diagnostics
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    const warnings = result.diagnostics.filter(d => d.severity === 'warning');

    for (const w of warnings) {
      console.error(`warning[${w.ruleId}]: ${w.message} (line ${w.span.line})`);
    }

    if (errors.length > 0) {
      for (const e of errors) {
        console.error(`error[${e.ruleId}]: ${e.message} (line ${e.span.line})`);
      }
      process.exit(1);
    }

    // Execute
    const env = new CliEnvironment();
    await execute(ast, env);
    process.exit(0);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`error: ${err.message}`);
    } else {
      console.error('error: unknown error');
    }
    process.exit(1);
  }
}

main();
