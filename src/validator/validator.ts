import type { SourceSpan } from '../common/types.js';
import type { ScriptNode, OperatorNode } from '../ast/nodes.js';

export type Severity = 'error' | 'warning';

/** R-0012: unified diagnostic with severity */
export interface ValidationDiagnostic {
  severity: Severity;
  ruleId: string;
  message: string;
  span: SourceSpan;
}

export interface ValidationResult {
  diagnostics: ValidationDiagnostic[];
}

/**
 * Validate AST semantics (R-0007).
 * Rules:
 *   exit-required (error) — last operator must be EXIT
 *   unreachable-after-exit (warning) — operators after EXIT (R-0009)
 *   unsupported-operator (error) — UnsupportedOperatorNode present (R-0011)
 */
export function validate(ast: ScriptNode): ValidationResult {
  const diagnostics: ValidationDiagnostic[] = [];

  const ops = ast.nodes.filter((n): n is OperatorNode => n.kind.startsWith('Op.') || n.kind === 'Unsupported');

  // Rule: exit-required
  if (ops.length === 0 || ops[ops.length - 1].kind !== 'Op.Exit') {
    const span = ops.length > 0
      ? ops[ops.length - 1].span
      : { line: 1, col: 1, offset: 0, length: 0 };
    diagnostics.push({
      severity: 'error',
      ruleId: 'exit-required',
      message: 'script must end with EXIT',
      span,
    });
  }

  // Rule: unreachable-after-exit (R-0009)
  for (let i = 0; i < ops.length - 1; i++) {
    if (ops[i].kind === 'Op.Exit') {
      for (let j = i + 1; j < ops.length; j++) {
        diagnostics.push({
          severity: 'warning',
          ruleId: 'unreachable-after-exit',
          message: 'unreachable code after EXIT',
          span: ops[j].span,
        });
      }
      break;
    }
  }

  // Rule: unsupported-operator (R-0011)
  for (const op of ops) {
    if (op.kind === 'Unsupported') {
      diagnostics.push({
        severity: 'error',
        ruleId: 'unsupported-operator',
        message: `operator ${op.operatorId} is not supported in this version`,
        span: op.span,
      });
    }
  }

  return { diagnostics };
}
