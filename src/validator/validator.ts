import type { SourceSpan } from '../common/types.js';
import type { ScriptNode } from '../ast/nodes.js';
import type { DialectTable } from '../dialect/types.js';
import type { ScopeModel } from './scope.js';
import { buildScope } from './scope.js';
import { exitRequired } from './rules/exit-required.js';
import { unreachableAfterExit } from './rules/unreachable-after-exit.js';
import { unsupportedOperator } from './rules/unsupported-operator.js';

export type Severity = 'error' | 'warning' | 'info';

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

/** Validation rule interface — each rule is an independent module */
export interface ValidationRule {
  ruleId: string;
  run(ast: ScriptNode, scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[];
}

/** Registry: collects rules, runs them all */
export class RuleRegistry {
  private rules: ValidationRule[] = [];

  register(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  runAll(ast: ScriptNode, scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];
    for (const rule of this.rules) {
      diagnostics.push(...rule.run(ast, scope, dialect));
    }
    return diagnostics;
  }
}

/** Default registry with all built-in rules */
function createDefaultRegistry(): RuleRegistry {
  const registry = new RuleRegistry();
  registry.register(exitRequired);
  registry.register(unreachableAfterExit);
  registry.register(unsupportedOperator);
  return registry;
}

const defaultRegistry = createDefaultRegistry();

/**
 * Validate AST semantics (R-0007).
 * Builds scope model, runs all registered rules.
 */
export function validate(ast: ScriptNode, dialect: DialectTable): ValidationResult {
  const scope = buildScope(ast);
  const diagnostics = defaultRegistry.runAll(ast, scope, dialect);
  return { diagnostics };
}
