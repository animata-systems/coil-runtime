#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import {
  loadDialect, KeywordIndex,
  tokenize,
  parse,
  validate,
  execute, resume,
} from '../src/index.js';
import { createCLIProviders, cliReceive } from './providers.js';
import type { YieldRequest, ExecutionResult } from '../src/sdk/types.js';
import type { ScriptNode, OperatorNode, CommentNode } from '../src/ast/nodes.js';

const USAGE = `Usage: coil <command> <file> --dialect <path>

Commands:
  run <file>     Run a .coil script
  parse <file>   Parse and print AST (no execution)
  check <file>   Validate a .coil script (no execution)

Arguments:
  <file>              Path to .coil script
  --dialect <path>    Path to dialect table JSON file`;

function parseArgs(args: string[]): { file: string; dialect: string } {
  let file: string | undefined;
  let dialect: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dialect') {
      if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
        console.error('error: dialect path missing after --dialect');
        console.error(USAGE);
        process.exit(1);
      }
      dialect = args[++i];
    } else if (!args[i].startsWith('-')) {
      file = args[i];
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

  return { file, dialect };
}

/** Print AST node for `coil parse` */
function printNode(node: OperatorNode | CommentNode, indent: string = ''): void {
  if (node.kind === 'Comment') {
    console.log(`${indent}Comment: "${node.text}"`);
    return;
  }

  const fields: string[] = [];

  switch (node.kind) {
    case 'Op.Receive':
      fields.push(`name=${node.name}`);
      if (node.prompt) fields.push('prompt=<template>');
      break;
    case 'Op.Send':
      if (node.name) fields.push(`name=${node.name}`);
      if (node.to) fields.push(`to=#...`);
      if (node.for.length) fields.push(`for=[${node.for.join(', ')}]`);
      if (node.await) fields.push(`await=${node.await}`);
      if (node.timeout) fields.push(`timeout=${node.timeout.value}`);
      if (node.body) fields.push('body=<template>');
      break;
    case 'Op.Exit':
      break;
    case 'Op.Actors':
      fields.push(`names=[${node.names.join(', ')}]`);
      break;
    case 'Op.Tools':
      fields.push(`names=[${node.names.join(', ')}]`);
      break;
    case 'Op.Define':
      fields.push(`name=${node.name}`, `body.type=${node.body.type}`);
      break;
    case 'Op.Set':
      fields.push(`target=$${node.target.name}`, `body.type=${node.body.type}`);
      break;
    case 'Op.Think':
      fields.push(`name=${node.name}`);
      if (node.via) fields.push(`via=$${node.via.name}`);
      if (node.as.length) fields.push(`as=[${node.as.map(r => '$' + r.name).join(', ')}]`);
      if (node.using.length) fields.push(`using=[${node.using.map(r => '!' + r.name).join(', ')}]`);
      if (node.goal) fields.push('goal=<template>');
      if (node.input) fields.push('input=<template>');
      if (node.context) fields.push('context=<template>');
      if (node.result.length) fields.push(`result=[${node.result.length} fields]`);
      if (node.body) fields.push('body=<template>');
      break;
    case 'Op.Execute':
      fields.push(`name=${node.name}`, `tool=!${node.tool.name}`);
      if (node.args.length) fields.push(`args=[${node.args.map(a => a.key).join(', ')}]`);
      break;
    case 'Op.Wait':
      if (node.on.length) fields.push(`on=[${node.on.map(r => '?' + r.name).join(', ')}]`);
      if (node.mode) fields.push(`mode=${node.mode}`);
      if (node.timeout) fields.push(`timeout=${node.timeout.value}`);
      break;
    case 'Op.Signal':
      fields.push(`target=~${node.target.name}`, 'body=<template>');
      break;
    case 'Op.If':
      fields.push(`condition="${node.condition}"`);
      break;
    case 'Op.Repeat':
      fields.push(`limit=${node.limit}`);
      if (node.until) fields.push(`until="${node.until}"`);
      break;
    case 'Op.Each':
      fields.push(`element=$${node.element.name}`, `from=$${node.from.name}`);
      break;
    case 'Unsupported':
      fields.push(`operatorId=${node.operatorId}`);
      break;
  }

  const fieldsStr = fields.length > 0 ? ` ${fields.join(', ')}` : '';
  console.log(`${indent}${node.kind}${fieldsStr}`);

  // Print nested body for control-flow operators
  if (node.kind === 'Op.If' || node.kind === 'Op.Repeat' || node.kind === 'Op.Each') {
    for (const child of node.body) {
      printNode(child, indent + '  ');
    }
  }
}

function printAST(ast: ScriptNode): void {
  console.log(`Script (dialect: ${ast.dialect})`);
  for (const node of ast.nodes) {
    printNode(node, '  ');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || !['run', 'parse', 'check'].includes(args[0])) {
    console.error(USAGE);
    process.exit(1);
  }

  const command = args[0];
  const { file, dialect } = parseArgs(args.slice(1));

  try {
    const [source, dialectTable] = await Promise.all([
      readFile(file, 'utf-8'),
      loadDialect(dialect),
    ]);

    const keywords = KeywordIndex.build(dialectTable);
    const tokens = tokenize(source, keywords);
    const ast = parse(tokens, dialectTable, source);
    const validationResult = validate(ast, dialectTable);

    // Output diagnostics
    const errors = validationResult.diagnostics.filter(d => d.severity === 'error');
    const warnings = validationResult.diagnostics.filter(d => d.severity === 'warning');

    for (const w of warnings) {
      console.error(`warning[${w.ruleId}]: ${w.message} (line ${w.span.line})`);
    }

    if (command === 'check') {
      const infos = validationResult.diagnostics.filter(d => d.severity === 'info');
      for (const d of infos) {
        console.error(`info[${d.ruleId}]: ${d.message} (line ${d.span.line})`);
      }
      if (errors.length > 0) {
        for (const e of errors) {
          console.error(`error[${e.ruleId}]: ${e.message} (line ${e.span.line})`);
        }
        process.exit(1);
      }
      process.exit(0);
    }

    if (command === 'parse') {
      printAST(ast);
      if (errors.length > 0) {
        for (const e of errors) {
          console.error(`error[${e.ruleId}]: ${e.message} (line ${e.span.line})`);
        }
        process.exit(1);
      }
      process.exit(0);
    }

    // command === 'run'
    if (errors.length > 0) {
      for (const e of errors) {
        console.error(`error[${e.ruleId}]: ${e.message} (line ${e.span.line})`);
      }
      process.exit(1);
    }

    const providers = createCLIProviders();
    let result: ExecutionResult | YieldRequest = await execute(ast, providers);

    // Run loop: handle yield requests until completion
    while (result.type === 'yield') {
      const yr = result as YieldRequest;
      if (yr.detail.type === 'receive') {
        const value = await cliReceive(yr.detail.prompt ?? `${yr.detail.variableName}: `);
        result = await resume(yr.snapshot, { type: 'ReceiveValue', value }, ast, providers);
      } else {
        console.error(`error: unhandled yield type: ${yr.detail.type}`);
        process.exit(1);
      }
    }

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
