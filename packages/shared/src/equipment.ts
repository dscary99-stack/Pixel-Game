/**
 * Character equipment (chapter 05 §1, C21, C23). Twelve slots; a weapon fits either hand, an
 * off-hand item only the off hand, a two-hand weapon leaves the off hand empty (O09 keeps dual-wield
 * class rules open, so any class may hold two one-hand weapons for now).
 *
 * Gear changes happen outside fights (P15). Gear adds derived stats only (`GearBonuses`); affixes,
 * rarity, refining and Sigil effects are later work.
 */
import { z } from "zod";
import { EquipSlotSchema, type EquipSlot, type EquipmentDefinition, type EquipmentInstance, type SigilDefinition } from "./schemas";
import type { RulesConfig } from "./rules";
import type { GearBonuses } from "./stats";
import type { Range } from "./battle/types";
import { SLOT_FOR_CATEGORY, validateLoadout, type ValidationIssue } from "./validators";

export const GEAR_STAT_KEYS = [
  "HP",
  "MP",
  "PATK",
  "MATK",
  "SUPPORT",
  "PDEF",
  "MDEF",
  "SPD",
  "ACCURACY_PCT",
  "EVASION_PCT",
  "CRIT_PCT",
  "CRIT_DAMAGE",
  "EFFECT_HIT_PCT",
  "EFFECT_RES_PCT",
] as const satisfies readonly (keyof GearBonuses)[];

export const EQUIP_SLOTS = EquipSlotSchema.options;

export const EquipRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    slot: EquipSlotSchema,
    /** The instance to put in the slot, or null to take off what is there. */
    instanceId: z.string().min(1).max(120).nullable(),
  })
  .strict();
export type EquipRequest = z.infer<typeof EquipRequestSchema>;

/** Which instance sits in which slot. */
export type Loadout = Partial<Record<EquipSlot, string>>;

/** Content check: equipment only grants stats the formulas know about. */
export function validateEquipmentDefinitions(defs: readonly EquipmentDefinition[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const d of defs) {
    for (const [k, v] of Object.entries(d.baseStats)) {
      if (!(GEAR_STAT_KEYS as readonly string[]).includes(k)) out.push({ code: "INVALID_COMMAND", message: `${d.id} has unknown stat ${k}`, path: d.id });
      if (!Number.isInteger(v)) out.push({ code: "INVALID_COMMAND", message: `${d.id} ${k} is not a whole number`, path: d.id });
    }
  }
  return out;
}

export type EquipPlan =
  | { ok: true; loadout: Loadout; removed: string[] }
  | { ok: false; code: "SLOT_MISMATCH" | "LEVEL_TOO_LOW" | "MISSING_REFERENCE" | "TWO_HAND_BLOCKS_OFFHAND"; message: string };

/**
 * The loadout after putting `instanceId` in `slot` (or emptying it). Moving an equipped piece to
 * another slot frees its old slot; a two-hand weapon takes off whatever is in the off hand.
 */
export function planEquip(
  rules: RulesConfig,
  current: Loadout,
  slot: EquipSlot,
  instanceId: string | null,
  instances: ReadonlyMap<string, Pick<EquipmentInstance, "id" | "definitionId" | "sigilSockets">>,
  defs: ReadonlyMap<string, EquipmentDefinition>,
  sigils: ReadonlyMap<string, SigilDefinition>,
  characterLevel: number,
): EquipPlan {
  const next: Loadout = { ...current };
  const removed: string[] = [];
  const take = (s: EquipSlot) => {
    const id = next[s];
    if (id !== undefined) removed.push(id);
    delete next[s];
  };
  if (instanceId === null) {
    take(slot);
    return { ok: true, loadout: next, removed };
  }
  const inst = instances.get(instanceId);
  const def = inst === undefined ? undefined : defs.get(inst.definitionId);
  if (inst === undefined || def === undefined) return { ok: false, code: "MISSING_REFERENCE", message: "unknown equipment" };
  if (!SLOT_FOR_CATEGORY[def.category].includes(slot)) return { ok: false, code: "SLOT_MISMATCH", message: `${def.category} cannot go in ${slot}` };
  if (def.handedness === "two_hand" && slot !== "MAIN_HAND") return { ok: false, code: "SLOT_MISMATCH", message: "a two-hand weapon goes in MAIN_HAND" };
  if (characterLevel < def.requiredLevel) return { ok: false, code: "LEVEL_TOO_LOW", message: `needs Lv${def.requiredLevel}` };
  const mainDef = next.MAIN_HAND === undefined ? undefined : defs.get(instances.get(next.MAIN_HAND)?.definitionId ?? "");
  if (slot === "OFF_HAND" && mainDef?.handedness === "two_hand" && next.MAIN_HAND !== instanceId) {
    return { ok: false, code: "TWO_HAND_BLOCKS_OFFHAND", message: "take off the two-hand weapon first" };
  }
  // Already worn elsewhere: move it.
  for (const s of EQUIP_SLOTS) if (next[s] === instanceId && s !== slot) delete next[s];
  if (next[slot] !== instanceId) take(slot);
  next[slot] = instanceId;
  if (def.handedness === "two_hand") take("OFF_HAND");
  const full = Object.fromEntries(
    Object.entries(next).map(([s, id]) => {
      const i = instances.get(id)!;
      return [s, { ...i, ownerId: "", refineLevel: 0, rolledAffixes: [], lockState: "free" } as EquipmentInstance];
    }),
  ) as Partial<Record<EquipSlot, EquipmentInstance>>;
  const issues = validateLoadout(rules, full, defs, sigils);
  if (issues.length > 0) return { ok: false, code: "SLOT_MISMATCH", message: issues.map((i) => i.message).join("; ") };
  return { ok: true, loadout: next, removed };
}

/** Summed gear stats. A two-hand weapon already keeps the off hand empty, so nothing is skipped. */
export function gearBonuses(defs: readonly EquipmentDefinition[]): GearBonuses {
  const out: Record<string, number> = {};
  for (const d of defs) for (const [k, v] of Object.entries(d.baseStats)) out[k] = (out[k] ?? 0) + v;
  return out as GearBonuses;
}

/** Basic attack reach: the main-hand weapon decides; bare-handed uses the class default. */
export function weaponRange(main: EquipmentDefinition | undefined, classDefault: Range): Range {
  if (main?.weaponKind === undefined) return classDefault;
  return main.weaponKind === "physical_melee" ? "melee" : "ranged";
}

/** One owned piece as the client sees it: where it is worn (or null) and whether a fight holds it. */
export interface EquipmentView {
  id: string;
  definitionId: string;
  refineLevel: number;
  lockState: EquipmentInstance["lockState"];
  slot: EquipSlot | null;
  /** Installed Sigil ids, in socket order. */
  sigils: string[];
}

/** The worn pieces' definitions and the main-hand weapon, for `playerSetup` and the HUD. */
export function wornGear(
  owned: readonly EquipmentView[],
  defs: ReadonlyMap<string, EquipmentDefinition>,
): { defs: EquipmentDefinition[]; mainHand?: EquipmentDefinition; sigilIds: string[] } {
  const worn = owned.filter((e) => e.slot !== null);
  const main = worn.find((e) => e.slot === "MAIN_HAND");
  const mainHand = main === undefined ? undefined : defs.get(main.definitionId);
  return {
    defs: worn.map((e) => defs.get(e.definitionId)).filter((d): d is EquipmentDefinition => d !== undefined),
    // Every Sigil in the worn pieces, one entry per copy: their effects go into fights.
    sigilIds: worn.flatMap((e) => e.sigils),
    ...(mainHand === undefined ? {} : { mainHand }),
  };
}
