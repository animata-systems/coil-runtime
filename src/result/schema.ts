import type { SourceSpan } from '../common/types.js';

// ─── ResultSchema: discriminated union by kind (R-0026) ────

export interface TextSchema {
  kind: 'text';
}

export interface NumberSchema {
  kind: 'number';
}

export interface FlagSchema {
  kind: 'flag';
}

export interface ChoiceSchema {
  kind: 'choice';
  options: string[];
}

export interface ListSchema {
  kind: 'list';
  itemFields: ResultSchemaField[];
}

export interface ObjectSchema {
  kind: 'object';
  fields: ResultSchemaField[];
}

/** Discriminated union — one variant per RESULT type (spec § 5.4) */
export type ResultSchema =
  | TextSchema
  | NumberSchema
  | FlagSchema
  | ChoiceSchema
  | ListSchema
  | ObjectSchema;

/** A named field in the result tree */
export interface ResultSchemaField {
  name: string;
  description: string;
  schema: ResultSchema;
  span: SourceSpan;
}
