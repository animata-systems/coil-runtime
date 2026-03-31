import type { ResultField } from '../ast/nodes.js';
import type { DialectTable } from '../dialect/types.js';
import type { ValidationDiagnostic } from '../validator/validator.js';
import { formatMessage } from '../validator/messages.js';
import type { ListSchema, ObjectSchema, ResultSchema, ResultSchemaField } from './schema.js';

/** Output of tolerant compilation (R-0026) */
export interface CompileResultOutput {
  fields: ResultSchemaField[];
  diagnostics: ValidationDiagnostic[];
}

/**
 * Map a ResultField's typeId to a ResultSchema.
 * Assumes typeId is valid (parser rejects unknown types).
 */
function fieldToSchema(field: ResultField): ResultSchema {
  switch (field.typeId) {
    case 'Typ.Text':
      return { kind: 'text' };
    case 'Typ.Number':
      return { kind: 'number' };
    case 'Typ.Flag':
      return { kind: 'flag' };
    case 'Typ.Choice':
      return { kind: 'choice', options: [...field.typeArgs] };
    case 'Typ.List':
      return { kind: 'list', itemFields: [] };
    case 'Typ.Object':
      return { kind: 'object', fields: [] };
    default:
      return { kind: 'text' };
  }
}

interface StackEntry {
  target: ResultSchemaField[];
  depth: number;
}

/**
 * Compile a flat ResultField[] (from parser) into a ResultSchemaField[] tree.
 *
 * Linear pass with a stack tracking parent containers by depth.
 * Tolerant compilation (R-0026): errors go to diagnostics, partial tree is preserved.
 *
 * Stack invariant: stack[i].depth < stack[i+1].depth.
 * stack[0] = { target: root, depth: 0 }.
 *
 * @param dialect — optional; when provided, messages are localised via formatMessage.
 */
export function compileResult(fields: ResultField[], dialect?: DialectTable): CompileResultOutput {
  const diagnostics: ValidationDiagnostic[] = [];
  const root: ResultSchemaField[] = [];

  const stack: StackEntry[] = [{ target: root, depth: 0 }];

  for (const field of fields) {
    const schemaField: ResultSchemaField = {
      name: field.name,
      description: field.description,
      schema: fieldToSchema(field),
      span: field.span,
    };

    // Unwind stack to find the container for this depth
    while (stack.length > 1 && stack[stack.length - 1].depth >= field.depth) {
      stack.pop();
    }

    const container = stack[stack.length - 1];

    if (field.depth === container.depth) {
      // Same level — sibling
      container.target.push(schemaField);
    } else {
      // field.depth > container.depth — nesting into the last field
      const lastField = container.target[container.target.length - 1];

      if (!lastField) {
        // Orphan depth: no parent field exists at all
        diagnostics.push({
          severity: 'error',
          ruleId: 'result-orphan-depth',
          message: dialect
            ? formatMessage('result-orphan-depth', dialect, field.name)
            : `field "${field.name}" has no parent field at the expected depth`,
          span: field.span,
        });
        // Tolerant: attach at container level
        container.target.push(schemaField);
      } else if (lastField.schema.kind !== 'list' && lastField.schema.kind !== 'object') {
        // Scalar with children → diagnostic, attach at container level (tolerant)
        diagnostics.push({
          severity: 'error',
          ruleId: 'result-leaf-with-children',
          message: dialect
            ? formatMessage('result-leaf-with-children', dialect, lastField.name)
            : `field "${lastField.name}" cannot have nested fields`,
          span: field.span,
        });
        container.target.push(schemaField);
      } else if (lastField.schema.kind === 'list') {
        // Valid nesting into LIST
        // NOTE: nested LIST is accepted here; result-nested-list validation is in rules.ts (R-0027)
        const listSchema = lastField.schema as ListSchema;
        listSchema.itemFields.push(schemaField);
        stack.push({ target: listSchema.itemFields, depth: field.depth });
      } else {
        // Valid nesting into OBJECT
        const objectSchema = lastField.schema as ObjectSchema;
        objectSchema.fields.push(schemaField);
        stack.push({ target: objectSchema.fields, depth: field.depth });
      }
    }
  }

  return { fields: root, diagnostics };
}
