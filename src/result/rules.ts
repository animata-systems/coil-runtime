import type { ScriptNode, ThinkNode } from '../ast/nodes.js';
import type { ScopeModel } from '../validator/scope.js';
import type { DialectTable } from '../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator/validator.js';
import { walkOperators } from '../validator/walk.js';
import { formatMessage } from '../validator/messages.js';
import type { ResultSchemaField } from './schema.js';
import { compileResult } from './compile.js';

// ─── Check functions (R-0027) ─────────────────────────────

/** CHOICE with fewer than 2 options → error */
export function checkChoiceMinOptions(
  fields: ResultSchemaField[],
  dialect: DialectTable,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  for (const field of fields) {
    if (field.schema.kind === 'choice' && field.schema.options.length < 2) {
      diagnostics.push({
        severity: 'error',
        ruleId: 'result-choice-min-options',
        message: formatMessage('result-choice-min-options', dialect, field.name),
        span: field.span,
      });
    }
    // Recurse into LIST children
    if (field.schema.kind === 'list') {
      diagnostics.push(...checkChoiceMinOptions(field.schema.itemFields, dialect));
    }
  }

  return diagnostics;
}

/** LIST nested inside LIST → error */
export function checkNestedList(
  fields: ResultSchemaField[],
  dialect: DialectTable,
  parentIsList = false,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  for (const field of fields) {
    if (field.schema.kind === 'list') {
      if (parentIsList) {
        diagnostics.push({
          severity: 'error',
          ruleId: 'result-nested-list',
          message: formatMessage('result-nested-list', dialect, field.name),
          span: field.span,
        });
      }
      // Recurse — check for deeper nesting even after reporting
      diagnostics.push(...checkNestedList(field.schema.itemFields, dialect, true));
    }
  }

  return diagnostics;
}

/** LIST without children → warning */
export function checkListNoChildren(
  fields: ResultSchemaField[],
  dialect: DialectTable,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  for (const field of fields) {
    if (field.schema.kind === 'list') {
      if (field.schema.itemFields.length === 0) {
        diagnostics.push({
          severity: 'warning',
          ruleId: 'result-list-no-children',
          message: formatMessage('result-list-no-children', dialect, field.name),
          span: field.span,
        });
      }
      // Recurse
      diagnostics.push(...checkListNoChildren(field.schema.itemFields, dialect));
    }
  }

  return diagnostics;
}

/** Duplicate field names at the same level → error */
export function checkDuplicateField(
  fields: ResultSchemaField[],
  dialect: DialectTable,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const seen = new Map<string, ResultSchemaField>();

  for (const field of fields) {
    const existing = seen.get(field.name);
    if (existing) {
      diagnostics.push({
        severity: 'error',
        ruleId: 'result-duplicate-field',
        message: formatMessage('result-duplicate-field', dialect, field.name),
        span: field.span,
      });
    } else {
      seen.set(field.name, field);
    }

    // Recurse into LIST children (separate scope)
    if (field.schema.kind === 'list') {
      diagnostics.push(...checkDuplicateField(field.schema.itemFields, dialect));
    }
  }

  return diagnostics;
}

// ─── Wrapper rule (R-0027) ────────────────────────────────

/**
 * Single ValidationRule wrapper for all RESULT validation.
 * Walks ThinkNodes, compiles result once per node, runs all checks.
 */
export const resultSchemaRule: ValidationRule = {
  ruleId: 'result-schema',
  run(ast: ScriptNode, _scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];

    walkOperators(ast.nodes, (op) => {
      if (op.kind !== 'Op.Think') return;
      const think = op as ThinkNode;
      if (think.result.length === 0) return;

      // Compile once per ThinkNode
      const compiled = compileResult(think.result, dialect);

      // Diagnostics from compilation (result-leaf-with-children, result-orphan-depth)
      diagnostics.push(...compiled.diagnostics);

      // Run check functions on the compiled tree
      diagnostics.push(...checkChoiceMinOptions(compiled.fields, dialect));
      diagnostics.push(...checkNestedList(compiled.fields, dialect));
      diagnostics.push(...checkListNoChildren(compiled.fields, dialect));
      diagnostics.push(...checkDuplicateField(compiled.fields, dialect));
    });

    return diagnostics;
  },
};
