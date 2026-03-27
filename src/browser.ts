/**
 * Browser-safe entry point for coil-runtime.
 * Exports everything except modules that depend on Node.js APIs:
 *   - loadDialect, DialectLoadError (node:fs)
 *   - CliEnvironment (node:readline)
 *   - execute, ExecutionError, NotImplementedError (CliEnvironment uses node:readline)
 *
 * Playground imports dialect JSON directly and passes DialectTable to KeywordIndex.build().
 */

export * from './common/index.js';
export * from './ast/index.js';
// Granular imports (not from ./dialect/index.js) to avoid pulling in node:fs via loader.ts.
export * from './dialect/types.js';
export { KeywordIndex } from './dialect/keyword-index.js';
export type { KeywordMatch } from './dialect/keyword-index.js';
export { lookupDialectWord, extractLanguage } from './dialect/lookup.js';
export * from './lexer/index.js';
export * from './parser/index.js';
export * from './validator/index.js';
export * from './result/index.js';
