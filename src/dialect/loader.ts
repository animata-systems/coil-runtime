import { readFile } from 'node:fs/promises';
import type {
  DialectTable, OpId, KwId, ModId, PolId, TypId, DurId,
} from './types.js';
import {
  ALL_OP_IDS, ALL_KW_IDS, ALL_MOD_IDS, ALL_POL_IDS, ALL_TYP_IDS, ALL_DUR_IDS,
} from './types.js';

export class DialectLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DialectLoadError';
  }
}

function checkCategory<T extends string>(
  section: Record<string, unknown> | undefined,
  sectionName: string,
  requiredIds: readonly T[],
  missing: string[],
): void {
  if (!section || typeof section !== 'object') {
    missing.push(...requiredIds.map(id => `${sectionName}.${id}`));
    return;
  }
  for (const id of requiredIds) {
    if (typeof section[id] !== 'string' || section[id] === '') {
      missing.push(`${sectionName}.${id}`);
    }
  }
}

/**
 * Load and validate a dialect table from a JSON file.
 * Throws DialectLoadError if the file is missing, malformed, or incomplete.
 */
export async function loadDialect(path: string): Promise<DialectTable> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new DialectLoadError(`dialect file not found: ${path}`);
    }
    throw new DialectLoadError(`cannot read dialect file: ${path} (${code})`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new DialectLoadError(`invalid JSON in dialect file: ${path}`);
  }

  if (!data || typeof data !== 'object') {
    throw new DialectLoadError(`dialect file must contain a JSON object: ${path}`);
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name === '') {
    throw new DialectLoadError(`dialect file missing required field "name": ${path}`);
  }
  if (typeof obj.label !== 'string' || obj.label === '') {
    throw new DialectLoadError(`dialect file missing required field "label": ${path}`);
  }

  const missing: string[] = [];

  checkCategory<OpId>(obj.operators as Record<string, unknown>, 'operators', ALL_OP_IDS, missing);
  checkCategory<KwId>(obj.terminators as Record<string, unknown>, 'terminators', ALL_KW_IDS, missing);
  checkCategory<ModId>(obj.modifiers as Record<string, unknown>, 'modifiers', ALL_MOD_IDS, missing);
  checkCategory<PolId>(obj.policies as Record<string, unknown>, 'policies', ALL_POL_IDS, missing);
  checkCategory<TypId>(obj.resultTypes as Record<string, unknown>, 'resultTypes', ALL_TYP_IDS, missing);
  checkCategory<DurId>(obj.durationSuffixes as Record<string, unknown>, 'durationSuffixes', ALL_DUR_IDS, missing);

  if (missing.length > 0) {
    throw new DialectLoadError(
      `dialect "${obj.name}" is incomplete — missing mappings:\n  ${missing.join('\n  ')}`,
    );
  }

  return {
    name: obj.name as string,
    label: obj.label as string,
    operators: obj.operators as Record<OpId, string>,
    terminators: obj.terminators as Record<KwId, string>,
    modifiers: obj.modifiers as Record<ModId, string>,
    policies: obj.policies as Record<PolId, string>,
    resultTypes: obj.resultTypes as Record<TypId, string>,
    durationSuffixes: obj.durationSuffixes as Record<DurId, string>,
  };
}
