/**
 * Abstract identifiers from SPEC.md § 4.
 * Every dialect must map all of these.
 */

// § 4.1 Core operators
export type CoreOpId =
  | 'Op.Actors'
  | 'Op.Tools'
  | 'Op.Define'
  | 'Op.Set'
  | 'Op.Receive'
  | 'Op.Think'
  | 'Op.Execute'
  | 'Op.Send'
  | 'Op.Wait'
  | 'Op.Exit';

// § 4.2 Extended operators
export type ExtOpId =
  | 'Op.If'
  | 'Op.Repeat'
  | 'Op.Each'
  | 'Op.Gather'
  | 'Op.Signal';

export type OpId = CoreOpId | ExtOpId;

// § 4.3 Terminators
export type KwId = 'Kw.End';

// § 4.4–4.8 Modifiers
export type ModId =
  | 'Mod.Via'
  | 'Mod.As'
  | 'Mod.Using'
  | 'Mod.Goal'
  | 'Mod.Input'
  | 'Mod.Context'
  | 'Mod.Result'
  | 'Mod.To'
  | 'Mod.For'
  | 'Mod.ReplyTo'
  | 'Mod.Await'
  | 'Mod.Timeout'
  | 'Mod.On'
  | 'Mod.Mode'
  | 'Mod.Until'
  | 'Mod.Limit'
  | 'Mod.From';

// § 4.9 Policies
export type PolId =
  | 'Pol.None'
  | 'Pol.Any'
  | 'Pol.All';

// § 4.10 Result types
export type TypId =
  | 'Typ.Text'
  | 'Typ.Number'
  | 'Typ.Flag'
  | 'Typ.Choice'
  | 'Typ.List';

// § 4.11 Duration suffixes
export type DurId =
  | 'Dur.Seconds'
  | 'Dur.Minutes'
  | 'Dur.Hours';

/** Union of all abstract identifiers */
export type AbstractId = OpId | KwId | ModId | PolId | TypId | DurId;

/** Category of an abstract identifier */
export type Category = 'operator' | 'terminator' | 'modifier' | 'policy' | 'resultType' | 'durationSuffix';

/**
 * Dialect table: machine-readable mapping from abstract IDs to keyword phrases.
 * JSON format per R-0008.
 */
export interface DialectTable {
  name: string;
  label: string;
  operators: Record<OpId, string>;
  terminators: Record<KwId, string>;
  modifiers: Record<ModId, string>;
  policies: Record<PolId, string>;
  resultTypes: Record<TypId, string>;
  durationSuffixes: Record<DurId, string>;
}

/** All operator IDs that must be present in every dialect */
export const ALL_OP_IDS: readonly OpId[] = [
  'Op.Actors', 'Op.Tools', 'Op.Define', 'Op.Set', 'Op.Receive',
  'Op.Think', 'Op.Execute', 'Op.Send', 'Op.Wait', 'Op.Exit',
  'Op.If', 'Op.Repeat', 'Op.Each', 'Op.Gather', 'Op.Signal',
] as const;

export const ALL_KW_IDS: readonly KwId[] = ['Kw.End'] as const;

export const ALL_MOD_IDS: readonly ModId[] = [
  'Mod.Via', 'Mod.As', 'Mod.Using',
  'Mod.Goal', 'Mod.Input', 'Mod.Context', 'Mod.Result',
  'Mod.To', 'Mod.For', 'Mod.ReplyTo', 'Mod.Await', 'Mod.Timeout',
  'Mod.On', 'Mod.Mode',
  'Mod.Until', 'Mod.Limit', 'Mod.From',
] as const;

export const ALL_POL_IDS: readonly PolId[] = ['Pol.None', 'Pol.Any', 'Pol.All'] as const;

export const ALL_TYP_IDS: readonly TypId[] = [
  'Typ.Text', 'Typ.Number', 'Typ.Flag', 'Typ.Choice', 'Typ.List',
] as const;

export const ALL_DUR_IDS: readonly DurId[] = ['Dur.Seconds', 'Dur.Minutes', 'Dur.Hours'] as const;
