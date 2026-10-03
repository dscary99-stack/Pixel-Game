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
  })
  .strict();

export const HealEffectSchema = z
  .object({ kind: z.literal("heal"), coefficient: z.number().positive(), flat: z.number().min(0) })
  .strict();

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
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.kind === "passive" && (s.effectSequence.length > 0 || s.mpCost > 0)) {
      ctx.addIssue({ code: "custom", message: "passive skills have no direct effect sequence or MP cost in Phase A" });
    }
    if (s.kind === "active" && s.effectSequence.length === 0) {
      ctx.addIssue({ code: "custom", message: "active skill needs at least one effect" });
    }
  });
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

// ---------------------------------------------------------------- species

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
    /** Server-rolled growth results; the client never picks a seed. */
    primaryStats: PrimaryStatsSchema,
    growthHistoryVersion: z.number().int().min(1),
    trainedSkillLevels: z.record(SkillId, z.number().int().min(1).max(10)),
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
    vendorPrice: z.number().int().min(0),
  })
  .strict()
  .superRefine((it, ctx) => {
    if (it.kind === "capture" && (it.captureSpeciesId === undefined || it.captureQuality === undefined)) {
      ctx.addIssue({ code: "custom", message: "capture item needs captureSpeciesId and captureQuality" });
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
    itemId: ItemId,
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
