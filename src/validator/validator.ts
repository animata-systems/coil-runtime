import type { SourceSpan } from '../common/types.js';
import type { ScriptNode, OperatorNode } from '../ast/nodes.js';
import type { DialectTable } from '../dialect/types.js';
import type { ScopeModel } from './scope.js';
import type { WalkContext } from './walk.js';
import { scopeWalk } from './scope-walker.js';
import { exitRequired } from './rules/exit-required.js';
import { unreachableAfterExit } from './rules/unreachable-after-exit.js';
import { unsupportedOperator } from './rules/unsupported-operator.js';
import { undeclaredParticipant } from './rules/undeclared-participant.js';
import { undeclaredTool } from './rules/undeclared-tool.js';
import { undefinedVariable } from './rules/undefined-variable.js';
import { createDuplicateDefine } from './rules/duplicate-define.js';
import { setWithoutDefine } from './rules/set-without-define.js';
import { undefinedPromise } from './rules/undefined-promise.js';
import { createUseBeforeWait } from './rules/use-before-wait.js';
import { resultSchemaRule } from '../result/rules.js';
import { expressionRules } from './rules/expression-rules.js';

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

/** Standalone validation rule — runs independently after scope is built */
export interface ValidationRule {
  ruleId: string;
  run(ast: ScriptNode, scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[];
}

/** R-0033: Visitor context passed to VisitorRule hooks */
export interface VisitorContext extends WalkContext {
  dialect: DialectTable;
  report(diagnostic: ValidationDiagnostic): void;
}

/**
 * R-0033: Visitor-based rule — participates in the single AST walk.
 * Scope is shared and mutable — rules MUST NOT modify it.
 */
export interface VisitorRule {
  ruleId: string;
  enter?(node: OperatorNode, scope: Readonly<ScopeModel>, ctx: VisitorContext): void;
  leave?(node: OperatorNode, scope: Readonly<ScopeModel>, ctx: VisitorContext): void;
  finalize?(scope: Readonly<ScopeModel>, ast: ScriptNode, ctx: VisitorContext): void;
}

/** Registry: collects rules, runs them all (R-0033) */
export class RuleRegistry {
  private visitorRules: VisitorRule[] = [];
  private standaloneRules: ValidationRule[] = [];

  registerVisitor(rule: VisitorRule): void {
    this.visitorRules.push(rule);
  }

  registerStandalone(rule: ValidationRule): void {
    this.standaloneRules.push(rule);
  }

  runAll(ast: ScriptNode, dialect: DialectTable): ValidationDiagnostic[] {
    const { scope, diagnostics } = scopeWalk(ast, this.visitorRules, dialect);
    for (const rule of this.standaloneRules) {
      diagnostics.push(...rule.run(ast, scope, dialect));
    }
    return diagnostics;
  }
}

/**
 * Create a fresh registry with all built-in rules (R-0033).
 * Called on every validate() to ensure stateful rules get fresh state.
 */
function createDefaultRegistry(): RuleRegistry {
  const registry = new RuleRegistry();
  // Standalone rules — use topLevelOps, no AST walk needed
  registry.registerStandalone(exitRequired);
  registry.registerStandalone(unreachableAfterExit);
  // Visitor rules — participate in single AST walk
  registry.registerVisitor(unsupportedOperator);
  registry.registerVisitor(undeclaredParticipant);
  registry.registerVisitor(undeclaredTool);
  registry.registerVisitor(undefinedVariable);
  registry.registerVisitor(createDuplicateDefine());
  registry.registerVisitor(setWithoutDefine);
  registry.registerVisitor(undefinedPromise);
  registry.registerVisitor(createUseBeforeWait());
  registry.registerVisitor(resultSchemaRule);
  registry.registerVisitor(expressionRules);
  return registry;
}

/**
 * Validate AST semantics (R-0007, R-0033).
 * Single AST walk with visitor rules, then standalone rules.
 */
export function validate(ast: ScriptNode, dialect: DialectTable): ValidationResult {
  const registry = createDefaultRegistry();
  const diagnostics = registry.runAll(ast, dialect);
  return { diagnostics };
}
