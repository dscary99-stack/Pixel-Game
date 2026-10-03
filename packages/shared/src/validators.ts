/**
 * Content and loadout validators (chapter 12 §5). Each returns a list of issues; empty means valid.
 * Issues on `draft` content are expected; publishing requires zero issues.
 */
import type { RulesConfig } from "./rules";
import type {
  EquipmentDefinition,
  EquipmentInstance,
  EquipSlot,
  LootTable,
  SigilDefinition,
  SigilGroup,
  SkillDefinition,
  SpeciesDefinition,
} from "./schemas";

export type ErrorCode =
  | "STALE_STATE"
  | "NOT_OWNER"
  | "ASSET_LOCKED"
  | "LEVEL_INELIGIBLE"
  | "DUPLICATE_SPECIES"
  | "SIGIL_INCOMPATIBLE"
  | "NO_VALID_CAPTURE_WINDOW"
  | "UNRESOLVED_RULE"
  // Additional codes used by Phase A validators / kernel.
  | "TEAM_TOO_LARGE"
  | "TOO_MANY_ENEMIES"
  | "SIGIL_SLOTS_EXCEEDED"
  | "SLOT_MISMATCH"
  | "MISSING_REFERENCE"
  | "SPECIES_KIT_INVALID"
  | "LOOT_CANDIDATE_COUNT"
  | "LOOT_SIGIL_SOURCE"
  | "BAG_INVALID"
  | "FORMATION_INVALID"
  | "INVALID_COMMAND"
  | "INVALID_TARGET"
  | "NOT_YOUR_TURN"
  | "BATTLE_OVER"
  | "INSUFFICIENT_RESOURCE"
  | "ON_COOLDOWN"
  | "AUTO_CAPTURE_FORBIDDEN"
  | "SESSION_REVOKED"
  | "FIXTURE_RULES_IN_PRODUCTION"
  // Battle reservation lifecycle (chapter 11 §3).
  | "RESERVATION_RELEASED";

export interface ValidationIssue {
  code: ErrorCode;
  message: string;
  path?: string;
}

const issue = (code: ErrorCode, message: string, path?: string): ValidationIssue =>
  path === undefined ? { code, message } : { code, message, path };

// ---------------------------------------------------------------- team (validator 4)

export interface TeamMember {
  instanceId: string;
  speciesId: string;
}

export function validateTeam(rules: RulesConfig, companions: readonly TeamMember[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const max = rules.confirmed.maxCompanions.value;
  if (companions.length > max) out.push(issue("TEAM_TOO_LARGE", `${companions.length} companions > ${max} (C04)`));
  if (!rules.confirmed.allowDuplicateSpeciesInTeam.value) {
    const seen = new Set<string>();
    for (const c of companions) {
      if (seen.has(c.speciesId)) out.push(issue("DUPLICATE_SPECIES", `${c.speciesId} appears twice (C04)`, c.instanceId));
      seen.add(c.speciesId);
    }
  }
  return out;
}

export function validateEnemyCount(rules: RulesConfig, enemyUnits: number): ValidationIssue[] {
  const max = rules.confirmed.maxEnemyUnits.value;
  return enemyUnits > max ? [issue("TOO_MANY_ENEMIES", `${enemyUnits} enemy units > ${max} (C05)`)] : [];
}

// ---------------------------------------------------------------- equipment & sigils (validator 5)

/** Sigil groups an equipment definition accepts. */
export function sigilGroupsOf(def: EquipmentDefinition): SigilGroup[] {
  switch (def.category) {
    case "HEAD_TOP":
    case "HEAD_MID":
    case "HEAD_LOW":
      return ["HEADGEAR"];
    case "ARMS":
    case "ARMOR":
    case "FEET":
    case "BACK":
    case "AURA":
      return [def.category];
    case "ACCESSORY":
      return ["ACCESSORY"];
    case "OFFHAND":
      return def.offhandKind === "shield" ? ["SHIELD"] : ["OFFHAND_OTHER"];
    case "WEAPON": {
      const groups: SigilGroup[] = ["WEAPON_ANY"];
      switch (def.weaponKind) {
        case "physical_melee":
          groups.push("WEAPON_PHYSICAL", "WEAPON_PHYSICAL_MELEE");
          break;
        case "physical_ranged":
          groups.push("WEAPON_PHYSICAL", "WEAPON_PHYSICAL_RANGED");
          break;
        case "magic":
          groups.push("WEAPON_MAGIC");
          break;
        case "support":
          groups.push("WEAPON_SUPPORT");
          break;
      }
      return groups;
    }
  }
}

/** Every socket must be within the item's slot count and compatible. Duplicate names are fine (C24). */
export function validateSigilSockets(
  rules: RulesConfig,
  def: EquipmentDefinition,
  inst: EquipmentInstance,
  sigils: ReadonlyMap<string, SigilDefinition>,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const cap = def.category === "WEAPON" ? rules.confirmed.maxSigilsPerWeapon.value : rules.confirmed.maxSigilsPerNonWeapon.value;
  const slots = Math.min(def.maxSigilSlots, cap);
  if (inst.sigilSockets.length > slots) {
    out.push(issue("SIGIL_SLOTS_EXCEEDED", `${inst.sigilSockets.length} sockets > ${slots} on ${def.id}`, inst.id));
  }
  const accepted = new Set(sigilGroupsOf(def));
  inst.sigilSockets.forEach((sid, i) => {
    if (sid === null) return;
    const s = sigils.get(sid);
    if (s === undefined) {
      out.push(issue("MISSING_REFERENCE", `unknown sigil ${sid}`, `${inst.id}.sigilSockets[${i}]`));
      return;
    }
    if (!s.equipGroups.some((g) => accepted.has(g))) {
      out.push(issue("SIGIL_INCOMPATIBLE", `${sid} does not fit ${def.category}`, `${inst.id}.sigilSockets[${i}]`));
    }
  });
  return out;
}

export const SLOT_FOR_CATEGORY: Record<EquipmentDefinition["category"], readonly EquipSlot[]> = {
  HEAD_TOP: ["HEAD_TOP"],
  HEAD_MID: ["HEAD_MID"],
  HEAD_LOW: ["HEAD_LOW"],
  ARMS: ["ARMS"],
  ARMOR: ["ARMOR"],
  FEET: ["FEET"],
  WEAPON: ["MAIN_HAND", "OFF_HAND"],
  OFFHAND: ["OFF_HAND"],
  ACCESSORY: ["ACCESSORY_1", "ACCESSORY_2"],
  BACK: ["BACK"],
  AURA: ["AURA"],
};

/**
 * 12-slot loadout placement. Dual weapons (4+4 = 8 Sigils) are allowed by slot rules;
 * class eligibility for dual wield is not modelled yet (O09).
 */
export function validateLoadout(
  rules: RulesConfig,
  loadout: Partial<Record<EquipSlot, EquipmentInstance>>,
  defs: ReadonlyMap<string, EquipmentDefinition>,
  sigils: ReadonlyMap<string, SigilDefinition>,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const [slot, inst] of Object.entries(loadout) as [EquipSlot, EquipmentInstance][]) {
    const def = defs.get(inst.definitionId);
    if (def === undefined) {
      out.push(issue("MISSING_REFERENCE", `unknown equipment ${inst.definitionId}`, slot));
      continue;
    }
    if (!SLOT_FOR_CATEGORY[def.category].includes(slot)) {
      out.push(issue("SLOT_MISMATCH", `${def.category} cannot go in ${slot}`, slot));
    }
    if (slot === "OFF_HAND" && def.category === "WEAPON" && def.handedness === "two_hand") {
      out.push(issue("SLOT_MISMATCH", "two-hand weapon goes in MAIN_HAND", slot));
    }
    out.push(...validateSigilSockets(rules, def, inst, sigils));
  }
  const main = loadout.MAIN_HAND && defs.get(loadout.MAIN_HAND.definitionId);
  if (main?.handedness === "two_hand" && loadout.OFF_HAND !== undefined) {
    out.push(issue("SLOT_MISMATCH", "two-hand main weapon leaves OFF_HAND empty", "OFF_HAND"));
  }
  return out;
}

// ---------------------------------------------------------------- species kit (validator 2)

export function validateSpecies(
  rules: RulesConfig,
  sp: SpeciesDefinition,
  skills: ReadonlyMap<string, SkillDefinition>,
  sigils: ReadonlyMap<string, SigilDefinition>,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const n = rules.confirmed.speciesSkillCount.value;
  if (new Set(sp.skillIds).size !== n) out.push(issue("SPECIES_KIT_INVALID", `${sp.id} needs ${n} distinct skills (C06)`));
  if (sp.skillIds.includes(sp.innatePassiveId)) {
    out.push(issue("SPECIES_KIT_INVALID", `${sp.id} innate must be separate from the 3 skills (C06)`));
  }
  for (const sid of [...sp.skillIds, sp.innatePassiveId]) {
    if (!skills.has(sid)) out.push(issue("MISSING_REFERENCE", `${sp.id} references missing skill ${sid}`));
  }
  const innate = skills.get(sp.innatePassiveId);
  if (innate !== undefined && innate.kind !== "passive") {
    out.push(issue("SPECIES_KIT_INVALID", `${sp.id} innate ${innate.id} must be passive`));
  }
  const sigil = sigils.get(sp.sigilId);
  if (sigil === undefined) out.push(issue("MISSING_REFERENCE", `${sp.id} references missing sigil ${sp.sigilId}`));
  else if (sigil.sourceSpeciesId !== sp.id) out.push(issue("LOOT_SIGIL_SOURCE", `${sp.sigilId} source is ${sigil.sourceSpeciesId}`));
  if (new Set(sp.allowedElements).size !== sp.allowedElements.length) {
    out.push(issue("SPECIES_KIT_INVALID", `${sp.id} lists an element twice`));
  }
  return out;
}

// ---------------------------------------------------------------- loot (validator 3)

export function lootCandidateIds(table: LootTable): Set<string> {
  const ids = new Set<string>([table.sigilRoll.itemId]);
  for (const pool of table.pools) for (const e of pool.entries) ids.add(e.itemId);
  return ids;
}

export function validateLootTable(rules: RulesConfig, table: LootTable, sigils: ReadonlyMap<string, SigilDefinition>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const [lo, hi] = rules.confirmed.lootCandidateRange.value;
  const count = lootCandidateIds(table).size;
  if (count < lo || count > hi) {
    out.push(issue("LOOT_CANDIDATE_COUNT", `${table.id} has ${count} unique candidates; needs ${lo}–${hi} (C19)`));
  }
  const sigil = sigils.get(table.sigilRoll.sigilId);
  if (sigil === undefined) {
    out.push(issue("MISSING_REFERENCE", `${table.id} references missing sigil ${table.sigilRoll.sigilId}`));
  } else {
    if (sigil.sourceSpeciesId !== table.speciesId) {
      out.push(issue("LOOT_SIGIL_SOURCE", `${table.id} drops ${sigil.id} from the wrong species (C22)`));
    }
    if (table.sigilRoll.probability !== sigil.baseDropProbability) {
      out.push(issue("LOOT_SIGIL_SOURCE", `${table.id} sigil probability differs from the sigil definition`));
    }
  }
  return out;
}
