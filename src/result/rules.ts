import type { OperatorNode, ThinkNode } from '../ast/nodes.js';
import type { ScopeModel } from '../validator/scope.js';
import type { ValidationDiagnostic, VisitorRule, VisitorContext } from '../validator/validator.js';
import { formatMessage } from '../validator/messages.js';
import type { ResultSchemaField } from './schema.js';
import { compileResult } from './compile.js';

// ─── Check functions (R-0027) ─────────────────────────────

/** CHOICE with fewer than 2 options → error */
export function checkChoiceMinOptions(
  fields: ResultSchemaField[],
  dialect: VisitorContext['dialect'],
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
    // Recurse into LIST/OBJECT children
    if (field.schema.kind === 'list') {
      diagnostics.push(...checkChoiceMinOptions(field.schema.itemFields, dialect));
    } else if (field.schema.kind === 'object') {
      diagnostics.push(...checkChoiceMinOptions(field.schema.fields, dialect));
    }
  }

  return diagnostics;
}

/** LIST nested inside LIST → error */
export function checkNestedList(
  fields: ResultSchemaField[],
  dialect: VisitorContext['dialect'],
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
    } else if (field.schema.kind === 'object') {
      // Recurse into object fields — LIST inside OBJECT counts as nested if parent is LIST
      diagnostics.push(...checkNestedList(field.schema.fields, dialect, parentIsList));
    }
  }

  return diagnostics;
}

/** LIST without children → warning */
export function checkListNoChildren(
  fields: ResultSchemaField[],
  dialect: VisitorContext['dialect'],
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
    } else if (field.schema.kind === 'object') {
      diagnostics.push(...checkListNoChildren(field.schema.fields, dialect));
    }
  }

  return diagnostics;
}

/** Duplicate field names at the same level → error */
export function checkDuplicateField(
  fields: ResultSchemaField[],
  dialect: VisitorContext['dialect'],
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

    // Recurse into LIST/OBJECT children (separate scope)
    if (field.schema.kind === 'list') {
      diagnostics.push(...checkDuplicateField(field.schema.itemFields, dialect));
    } else if (field.schema.kind === 'object') {
      diagnostics.push(...checkDuplicateField(field.schema.fields, dialect));
    }
  }

  return diagnostics;
}

// ─── Visitor rule (R-0027, R-0033) ──────────────────────────

/**
 * VisitorRule for all RESULT validation.
 * enter() fires on ThinkNodes, compiles result once per node, runs all checks.
 */
export const resultSchemaRule: VisitorRule = {
  ruleId: 'result-schema',
  enter(node: OperatorNode, _scope: Readonly<ScopeModel>, ctx: VisitorContext): void {
    if (node.kind !== 'Op.Think') return;
    const think = node as ThinkNode;
    if (think.result.length === 0) return;

    // Compile once per ThinkNode
    const compiled = compileResult(think.result, ctx.dialect);

    // Diagnostics from compilation (result-leaf-with-children, result-orphan-depth)
    for (const d of compiled.diagnostics) ctx.report(d);

    // Run check functions on the compiled tree
    for (const d of checkChoiceMinOptions(compiled.fields, ctx.dialect)) ctx.report(d);
    for (const d of checkNestedList(compiled.fields, ctx.dialect)) ctx.report(d);
    for (const d of checkListNoChildren(compiled.fields, ctx.dialect)) ctx.report(d);
    for (const d of checkDuplicateField(compiled.fields, ctx.dialect)) ctx.report(d);
  },
};
