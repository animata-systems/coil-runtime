export { validate, RuleRegistry } from './validator.js';
export type { ValidationDiagnostic, ValidationResult, Severity, ValidationRule } from './validator.js';
export type { ScopeModel, ScopeEntry, VariableEntry } from './scope.js';
export { buildScope, createScopeModel } from './scope.js';
export { walkOperators, topLevelOps } from './walk.js';
export type { WalkContext, OperatorVisitor } from './walk.js';
export { collectVariableRefs, collectRefsFromBody, collectRefsFromTemplate } from './refs.js';
