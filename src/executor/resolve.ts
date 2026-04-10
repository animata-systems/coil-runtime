/**
 * Value resolution utilities for the executor (R-0037, R-0036).
 */

import type { SourceSpan, TypedRef } from '../common/types.js';
import type { BodyValue, TemplateNode, RefPart } from '../ast/nodes.js';
import type { Scope } from './scope.js';
import { ExecutionError } from './executor.js';

/**
 * Strict field path traversal (R-0037).
 * Every step must produce a non-null, non-undefined value.
 * Missing property or non-object intermediate → ExecutionError.
 */
export function resolveFieldPath(root: unknown, path: string[], span: SourceSpan): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || current === undefined) {
      throw new ExecutionError(
        `cannot access .${key} on ${current === null ? 'null' : 'undefined'}`,
        span,
      );
    }
    if (typeof current !== 'object') {
      throw new ExecutionError(
        `cannot access .${key} on ${typeof current}`,
        span,
      );
    }
    const obj = current as Record<string, unknown>;
    if (!(key in obj)) {
      throw new ExecutionError(
        `property .${key} does not exist`,
        span,
      );
    }
    current = obj[key];
  }
  return current;
}

/**
 * Resolve a variable reference with optional field path.
 */
export function resolveVar(name: string, path: string[], scope: Scope, span: SourceSpan): unknown {
  const value = scope.get(name);
  if (value === undefined && !scope.has(name)) {
    throw new ExecutionError(`undefined variable: $${name}`, span);
  }
  if (path.length === 0) return value;
  return resolveFieldPath(value, path, span);
}

/**
 * Interpolate a TemplateNode with $-references from scope.
 */
export function interpolate(template: TemplateNode, scope: Scope): string {
  let result = '';
  for (const part of template.parts) {
    if (part.type === 'text') {
      result += part.value;
    } else {
      const ref = part as RefPart;
      const value = resolveVar(ref.name, ref.path, scope, ref.span);
      result += typeof value === 'object' && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value);
    }
  }
  return result.trim();
}

/**
 * Resolve a TypedRef to a string name at runtime (R-0057).
 * Literal refs return value as-is; dynamic refs resolve via scope.
 */
export function resolveTypedRef(ref: TypedRef, scope: Scope, span: SourceSpan): string {
  if (ref.kind === 'literal') return ref.value;
  const value = resolveVar(ref.name, ref.path, scope, span);
  const result = String(value);
  if (result === '' || result === 'undefined' || result === 'null') {
    throw new ExecutionError(
      `dynamic ref $${ref.name}${ref.path.map(p => `.${p}`).join('')} resolved to invalid value: ${JSON.stringify(value)}`,
      span,
    );
  }
  return result;
}

/**
 * Resolve BodyValue to a runtime value (R-0036).
 * Used by DEFINE and SET.
 */
export function resolveBodyValue(body: BodyValue, scope: Scope): unknown {
  switch (body.type) {
    case 'template':
      return interpolate(body as TemplateNode, scope);
    case 'ref':
      return resolveVar(body.name, body.path, scope, body.span);
    case 'number':
      return body.value;
    case 'string':
      return body.value;
    case 'boolean':
      return body.value;
  }
}
