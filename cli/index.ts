#!/usr/bin/env node

const USAGE = `Usage: coil run <file> --dialect <path>

Arguments:
  <file>              Path to .coil script
  --dialect <path>    Path to dialect table JSON file`;

function main(): void {
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

  // TODO: Phase 5 — wire pipeline: readFile → loadDialect → tokenize → parse → validate → execute
  console.log('not implemented');
}

main();
