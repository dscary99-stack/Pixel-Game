/**
 * Content and instance contracts (chapter 12 §1–§3).
 * Definitions are versioned content; instances are player assets owned by the server.
 * Display names are never primary keys.
 */
import { z } from "zod";
import { RULES } from "./rules";

const C = RULES.confirmed;

export const ElementSchema = z.enum(["FIRE", "WATER", "EARTH", "WIND", "LIGHT", "SHADOW", "NEUTRAL"]);
export type Element = z.infer<typeof ElementSchema>;

export const RankSchema = z.enum(["NORMAL", "ELITE", "BOSS"]);
export const ContentStatusSchema = z.enum(["draft", "validated", "published", "retired"]);
export const ArchetypeSchema = z.enum(["tank", "physical", "magic", "support", "control"]);
export type Archetype = z.infer<typeof ArchetypeSchema>;

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}:[a-z0-9_]+$`), `expected id like "${prefix}:snake_case"`);

export const SpeciesId = id("species");
export const SkillId = id("skill");
export const ItemId = id("item");
export const SigilId = id("sigil");
export const LootTableId = id("loot");
export const EquipmentDefinitionId = id("equip");

const LocalizedName = z.object({ th: z.string().min(1), en: z.string().min(1).optional() }).strict();

export const PrimaryStatsSchema = z
  .object({
    STR: z.number().int().min(0),
    VIT: z.number().int().min(0),
    INT: z.number().int().min(0),
    DEX: z.number().int().min(0),
    AGI: z.number().int().min(0),
    SPI: z.number().int().min(0),
  })
  .strict();
export type PrimaryStats = z.infer<typeof PrimaryStatsSchema>;

const contentMeta = {
  version: z.number().int().min(1),
  status: ContentStatusSchema,
  /** EXAMPLE content is illustration only (chapter 00) and must not be published. */
  example: z.boolean(),
};

// ---------------------------------------------------------------- skills

export const DamageEffectSchema = z
  .object({
    kind: z.literal("damage"),
    damageType: z.enum(["physical", "magic"]),
    coefficient: z.number().positive(),
    flat: z.number().min(0),
    element: ElementSchema,
    // Optional primitives (docs/design/SKILL_PRIMITIVES_CATALOG.md). None needs a status or tick rule.
    /** Ignore this % of the target's defense (capped by P04 armorPenetrationCapPct). */
    penetrationPct: z.number().int().min(1).max(100).optional(),
    /** Added to the hit chance before the clamp. */
    accuracyBonusPct: z.number().int().min(1).max(100).optional(),
    /** Added to the crit chance before the clamp. */
    critBonusPct: z.number().int().min(1).max(100).optional(),
    /** Extra damage % when the target's HP share before the hit is below `belowHpPct`. */
    execute: z.object({ belowHpPct: z.number().int().min(1).max(99), bonusPct: z.number().int().min(1).max(200) }).strict().optional(),
    /** The user heals this % of the damage dealt. */
    lifestealPct: z.number().int().min(1).max(100).optional(),
    /** The user loses this % of the damage dealt, never below 1 HP. */
    recoilPct: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type DamageEffect = z.infer<typeof DamageEffectSchema>;

export const HealEffectSchema = z
  .object({
    kind: z.literal("heal"),
    coefficient: z.number().positive(),
    flat: z.number().min(0),
    /** Also restores this much MP to each healed target. */
    restoreMp: z.number().int().min(1).optional(),
  })
  .strict();

/**
 * What one skill level adds (chapter 04 §5; Nut 2026-10-03: "หลากหลาย ขึ้นอยู่กับ skill ของแต่ละตัว").
 * power: +% on the coefficient; mp_cost / cooldown: change (negative = cheaper / faster);
 * extra_targets: more targets of the same side, each resolved on its own.
 */
export const SkillLevelStepSchema = z
  .object({
    atLevel: z.number().int().min(2).max(10),
    kind: z.enum(["power", "mp_cost", "cooldown", "extra_targets"]),
    value: z.number().int(),
  })
  .strict();
export type SkillLevelStep = z.infer<typeof SkillLevelStepSchema>;

export const SkillDefinitionSchema = z
  .object({
    id: SkillId,
    ...contentMeta,
    name: LocalizedName,
    kind: z.enum(["active", "passive"]),
    ownerKind: z.enum(["player", "companion", "enemy"]),
    /** Phase A supports single-target actives only; AoE waits for O15 (evade vs AoE). */
    targetRule: z.enum(["single_enemy", "single_ally", "self", "none"]),
    range: z.enum(["melee", "ranged"]),
    mpCost: z.number().int().min(0),
    /** Owner turns before reuse. Tick point is O15. */
    cooldown: z.number().int().min(0),
    effectSequence: z.array(z.discriminatedUnion("kind", [DamageEffectSchema, HealEffectSchema])),
    tags: z.array(z.string()),
    /** One step per level 2–10 when present; absent = the default power step (rules). */
    levelSteps: z.array(SkillLevelStepSchema).optional(),
    /** A Rebirth variant of this base skill (chapter 04 §7): same role, played differently. */
    variantOf: SkillId.optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.levelSteps !== undefined) {
      const levels = s.levelSteps.map((x) => x.atLevel).sort((a, b) => a - b);
      if (levels.join(",") !== "2,3,4,5,6,7,8,9,10") ctx.addIssue({ code: "custom", message: "levelSteps needs exactly one step for each level 2–10" });
      const sum = (k: SkillLevelStep["kind"]) => s.levelSteps!.filter((x) => x.kind === k).reduce((n, x) => n + x.value, 0);
      if (s.mpCost + sum("mp_cost") < 0) ctx.addIssue({ code: "custom", message: "levelSteps would take MP cost below 0" });
      if (s.cooldown + sum("cooldown") < 0) ctx.addIssue({ code: "custom", message: "levelSteps would take cooldown below 0" });
      for (const x of s.levelSteps) {
        const ok = x.kind === "power" || x.kind === "extra_targets" ? x.value > 0 : x.value < 0;
        if (!ok) ctx.addIssue({ code: "custom", message: `level ${x.atLevel} ${x.kind} step must ${x.kind === "power" || x.kind === "extra_targets" ? "add" : "reduce"}` });
      }
      if (sum("extra_targets") > 4) ctx.addIssue({ code: "custom", message: "at most 4 extra targets" });
    }
    if (s.kind === "passive" && (s.effectSequence.length > 0 || s.mpCost > 0)) {
      ctx.addIssue({ code: "custom", message: "passive skills have no direct effect sequence or MP cost in Phase A" });
    }
    if (s.kind === "active" && s.effectSequence.length === 0) {
      ctx.addIssue({ code: "custom", message: "active skill needs at least one effect" });
    }
  });
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

// ---------------------------------------------------------------- species

/** One Rebirth stage's two branches (chapter 04 §7): R1 a skill, R2 the innate, R3 another skill. */
export const RebirthVariantSchema = z
  .object({
    stage: z.number().int().min(1).max(3),
    replaces: SkillId,
    options: z.array(z.object({ branch: z.enum(["A", "B"]), skillId: SkillId }).strict()).length(2),
  })
  .strict();
export type RebirthVariant = z.infer<typeof RebirthVariantSchema>;
export type RebirthBranch = "A" | "B";

/** The stage-3 look (Nut 2026-10-03: with an effect). `effect` is an art key the client draws. */
export const RebirthCosmeticSchema = z
  .object({
    id: z.string().min(1),
    name: LocalizedName,
    effect: z.enum(["aura", "sparkle", "flame", "ripple", "leaf"]),
    /** #rrggbb tint for the effect. */
    color: z.string().regex(/^#[0-9a-f]{6}$/),
  })
  .strict();
export type RebirthCosmetic = z.infer<typeof RebirthCosmeticSchema>;

export const SpeciesDefinitionSchema = z
  .object({
    id: SpeciesId,
    ...contentMeta,
    name: LocalizedName,
    /** Same on every map (C29). There is no per-map override anywhere in the contracts. */
    fixedWildLevel: z.number().int().min(1).max(C.playerMaxLevel.value),
    rank: RankSchema,
    archetype: ArchetypeSchema,
    allowedElements: z.array(ElementSchema).min(1),
    /** Exactly 3 skills (C06), separate from the innate passive. */
    skillIds: z.array(SkillId).length(C.speciesSkillCount.value),
    innatePassiveId: SkillId,
    captureItemId: ItemId,
    /** Base capture rate before HP/status/item factors (O07 table still open). */
    captureBaseRate: z.number().min(0).max(1),
    lootTableId: LootTableId,
    sigilId: SigilId,
    petEquipmentPoolId: z.string().min(1),
    artId: z.string().min(1),
    /** Wild combat stat block at fixedWildLevel. Prototype numbers, not balance targets. */
    wildPrimaryStats: PrimaryStatsSchema,
    basicAttackRange: z.enum(["melee", "ranged"]),
    /** Rebirth variants, one entry per stage that has them (validator checks the kit rules). */
    rebirthVariants: z.array(RebirthVariantSchema).max(3).optional(),
    rebirthCosmetic: RebirthCosmeticSchema.optional(),
  })
  .strict();
export type SpeciesDefinition = z.infer<typeof SpeciesDefinitionSchema>;

/** A map spawn entry. `.strict()` rejects any wildLevel override (C29, chapter 12 validator 6). */
export const SpawnEntrySchema = z
  .object({
    speciesId: SpeciesId,
    weight: z.number().int().positive(),
    elementWeights: z.partialRecord(ElementSchema, z.number().int().min(0)),
    groupRules: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }).strict(),
  })
  .strict();
export type SpawnEntry = z.infer<typeof SpawnEntrySchema>;

// ---------------------------------------------------------------- monster instance

export const MonsterInstanceSchema = z
  .object({
    id: z.string().min(1),
    speciesId: SpeciesId,
    ownerId: z.string().min(1),
    currentLevel: z.number().int().min(1).max(RULES.provisional.companionMaxLevel.value),
    xp: z.number().int().min(0),
    rebirthStage: z.number().int().min(0),
    element: ElementSchema,
    /** Server-rolled growth results at the current level; the client never picks a seed. */
    primaryStats: PrimaryStatsSchema,
    /** 1 = flat start stats (before growth); 2 = stats from growthSeed (companion-growth.ts). */
    growthHistoryVersion: z.number().int().min(1),
    /** Picked by the server when the companion is created; the whole growth path follows from it. */
    growthSeed: z.string().min(1),
    /** Branch picked per Rebirth stage that has variants ("1" → "A"); changeable at the NPC for coins. */
    rebirthChoices: z.partialRecord(z.enum(["1", "2", "3"]), z.enum(["A", "B"])),
    /** Trained level per skill (3 skills + innate); missing = 1. A fight caps it by level (skill-training.ts). */
    trainedSkillLevels: z.record(SkillId, z.number().int().min(1).max(10)),
    /** Unspent mastery from won fights, spent on the skill the player picks (chapter 04 §5). */
    skillMastery: z.number().int().min(0),
    bond: z.number().int().min(0).max(1000),
    originRecord: z
      .object({ kind: z.enum(["capture", "starter", "event"]), battleId: z.string().optional(), at: z.string() })
      .strict(),
    ownershipVersion: z.number().int().min(1),
    lockState: z.enum(["free", "in_battle", "in_escrow"]),
  })
  .strict();
export type MonsterInstance = z.infer<typeof MonsterInstanceSchema>;

// ---------------------------------------------------------------- items

export const ItemDefinitionSchema = z
  .object({
    id: ItemId,
    ...contentMeta,
    name: LocalizedName,
    kind: z.enum(["heal", "capture", "support", "attack", "revive", "material", "sigil"]),
    /** heal: flat HP restored. */
    healHp: z.number().int().min(0).optional(),
    /** capture: the one species this item captures (species-specific capture items, chapter 04 §3). */
    captureSpeciesId: SpeciesId.optional(),
    captureQuality: z.number().positive().optional(),
    /** sigil: the Sigil this item installs (chapter 05 §4). */
    sigilId: SigilId.optional(),
    /** Coins an NPC pays per unit (chapter 06); 0 = the NPC does not buy it. */
    vendorPrice: z.number().int().min(0),
  })
  .strict()
  .superRefine((it, ctx) => {
    if (it.kind === "capture" && (it.captureSpeciesId === undefined || it.captureQuality === undefined)) {
      ctx.addIssue({ code: "custom", message: "capture item needs captureSpeciesId and captureQuality" });
    }
    if ((it.kind === "sigil") !== (it.sigilId !== undefined)) {
      ctx.addIssue({ code: "custom", message: "sigil items, and only they, name a sigilId" });
    }
    if (it.kind === "heal" && it.healHp === undefined) {
      ctx.addIssue({ code: "custom", message: "heal item needs healHp" });
    }
  });
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;

// ---------------------------------------------------------------- equipment & sigils

/** The 12 character equipment slots (C21). */
export const EquipSlotSchema = z.enum([
  "HEAD_TOP",
  "HEAD_MID",
  "HEAD_LOW",
  "ARMS",
  "ARMOR",
  "FEET",
  "MAIN_HAND",
  "OFF_HAND",
  "ACCESSORY_1",
  "ACCESSORY_2",
  "BACK",
  "AURA",
]);
export type EquipSlot = z.infer<typeof EquipSlotSchema>;

export const EquipCategorySchema = z.enum([
  "HEAD_TOP",
  "HEAD_MID",
  "HEAD_LOW",
  "ARMS",
  "ARMOR",
  "FEET",
  "WEAPON",
  "OFFHAND",
  "ACCESSORY",
  "BACK",
  "AURA",
]);
export type EquipCategory = z.infer<typeof EquipCategorySchema>;

export const WeaponKindSchema = z.enum(["physical_melee", "physical_ranged", "magic", "support"]);
export const OffhandKindSchema = z.enum(["shield", "book", "charm"]);

/** Sigil compatibility groups. HEADGEAR is shared by all three head slots (C24). */
export const SigilGroupSchema = z.enum([
  "HEADGEAR",
  "ARMS",
  "ARMOR",
  "FEET",
  "WEAPON_PHYSICAL_MELEE",
  "WEAPON_PHYSICAL_RANGED",
  "WEAPON_MAGIC",
  "WEAPON_SUPPORT",
  "WEAPON_PHYSICAL",
  "WEAPON_ANY",
  "SHIELD",
  "OFFHAND_OTHER",
  "ACCESSORY",
  "BACK",
  "AURA",
]);
export type SigilGroup = z.infer<typeof SigilGroupSchema>;

export const EquipmentDefinitionSchema = z
  .object({
    id: EquipmentDefinitionId,
    ...contentMeta,
    name: LocalizedName,
    category: EquipCategorySchema,
    weaponKind: WeaponKindSchema.optional(),
    handedness: z.enum(["one_hand", "two_hand"]).optional(),
    offhandKind: OffhandKindSchema.optional(),
    requiredLevel: z.number().int().min(1).max(C.playerMaxLevel.value),
    baseStats: z.record(z.string(), z.number()),
    maxSigilSlots: z.number().int().min(0),
    affixPoolId: z.string().min(1),
    visualSetId: z.string().min(1),
  })
  .strict()
  .superRefine((d, ctx) => {
    const isWeapon = d.category === "WEAPON";
    const cap = isWeapon ? C.maxSigilsPerWeapon.value : C.maxSigilsPerNonWeapon.value;
    if (d.maxSigilSlots > cap) {
      ctx.addIssue({ code: "custom", message: `maxSigilSlots ${d.maxSigilSlots} exceeds cap ${cap} (C23)` });
    }
    if (isWeapon && (d.weaponKind === undefined || d.handedness === undefined)) {
      ctx.addIssue({ code: "custom", message: "weapon needs weaponKind and handedness" });
    }
    if (!isWeapon && (d.weaponKind !== undefined || d.handedness !== undefined)) {
      ctx.addIssue({ code: "custom", message: "only weapons have weaponKind/handedness" });
    }
    if ((d.category === "OFFHAND") !== (d.offhandKind !== undefined)) {
      ctx.addIssue({ code: "custom", message: "offhandKind is required for OFFHAND and only for OFFHAND" });
    }
  });
export type EquipmentDefinition = z.infer<typeof EquipmentDefinitionSchema>;

export const EquipmentInstanceSchema = z
  .object({
    id: z.string().min(1),
    definitionId: EquipmentDefinitionId,
    ownerId: z.string().min(1),
    refineLevel: z.number().int().min(0).max(10),
    rolledAffixes: z.array(z.object({ stat: z.string(), value: z.number() }).strict()).max(3),
    /** Socket index -> installed sigil definition id, or null for empty. Duplicate ids allowed (C24). */
    sigilSockets: z.array(SigilId.nullable()),
    lockState: z.enum(["free", "in_battle", "in_escrow"]),
  })
  .strict();
export type EquipmentInstance = z.infer<typeof EquipmentInstanceSchema>;

export const SigilDefinitionSchema = z
  .object({
    id: SigilId,
    ...contentMeta,
    name: LocalizedName,
    sourceSpeciesId: SpeciesId,
    equipGroups: z.array(SigilGroupSchema).min(1),
    effectIds: z.array(z.string()).min(1),
    stackingGroup: z.string().min(1),
    scope: z.enum(["global", "weapon_local"]),
    /** Probability 0–1 (0.00005 = 0.005%). Never a percent (chapter 12 §3). */
    baseDropProbability: z.number().min(C.sigilBaseDropRange.value[0]).max(C.sigilBaseDropRange.value[1]),
  })
  .strict();
export type SigilDefinition = z.infer<typeof SigilDefinitionSchema>;

// ---------------------------------------------------------------- loot

export const LootEntrySchema = z
  .object({
    /** A stackable item, or an equipment definition (each drop becomes its own instance). */
    itemId: z.union([ItemId, EquipmentDefinitionId]),
    weight: z.number().int().positive(),
    minQty: z.number().int().min(1),
    maxQty: z.number().int().min(1),
  })
  .strict()
  .refine((e) => e.maxQty >= e.minQty, "maxQty < minQty");

export const LootPoolSchema = z
  .object({
    id: z.string().min(1),
    /** Weight of this pool when an ordinary slot picks a pool. */
    weight: z.number().int().positive(),
    entries: z.array(LootEntrySchema).min(1),
  })
  .strict();

export const LootTableSchema = z
  .object({
    id: LootTableId,
    ...contentMeta,
    speciesId: SpeciesId,
    sigilRoll: z.object({ sigilId: SigilId, itemId: ItemId, probability: z.number().min(0).max(1) }).strict(),
    /** Each ordinary slot: weight of rolling nothing, vs. the summed pool weights. */
    emptySlotWeight: z.number().int().min(0),
    pools: z.array(LootPoolSchema).min(1),
    maxTypesPerEnemy: z.literal(C.maxLootTypesPerEnemy.value),
  })
  .strict();
export type LootTable = z.infer<typeof LootTableSchema>;
