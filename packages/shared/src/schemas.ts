/**
 * Content and instance contracts (chapter 12 §1–§3).
 * Definitions are versioned content; instances are player assets owned by the server.
 * Display names are never primary keys.
 */
import { z } from "zod";
import { STATUS_DEFINITIONS, STATUS_IDS } from "./status";
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
export const BossId = id("boss");

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

/**
 * A status a skill effect tries to put on its target (status.ts). Harmful statuses go with enemy-target
 * effects and roll against resistance; helpful ones go with ally effects and use `chancePct` as is.
 */
export const StatusApplicationSchema = z
  .object({
    statusId: z.enum(STATUS_IDS),
    /** The skill's own chance (Nut 2026-10-04: a status is not 100% unless the skill says so). */
    chancePct: z.number().int().min(1).max(100),
    /** The affected unit's own turns. */
    turns: z.number().int().min(1).max(10),
    stacks: z.number().int().min(1).max(5).optional(),
    /** imbue / element_ward: the element. */
    element: ElementSchema.optional(),
    /** shield: its size as a % of the target's max HP. */
    shieldPct: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if ((STATUS_DEFINITIONS[a.statusId].needsAmount === true) !== (a.shieldPct !== undefined)) {
      ctx.addIssue({ code: "custom", message: `${a.statusId} ${a.shieldPct === undefined ? "needs" : "takes no"} shieldPct` });
    }
    if ((STATUS_DEFINITIONS[a.statusId].needsElement === true) !== (a.element !== undefined)) {
      ctx.addIssue({ code: "custom", message: `${a.statusId} ${a.element === undefined ? "needs" : "takes no"} element` });
    }
  });
export type StatusApplication = z.infer<typeof StatusApplicationSchema>;

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
    /** Tried on the target after a hit that lands. */
    statuses: z.array(StatusApplicationSchema).max(3).optional(),
    /** Extra damage % against a target with this status; `consume` removes the status with the hit. */
    bonusVsStatus: z.object({ statusId: z.enum(STATUS_IDS), bonusPct: z.number().int().min(1).max(200), consume: z.boolean() }).strict().optional(),
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
    statuses: z.array(StatusApplicationSchema).max(3).optional(),
  })
  .strict();

/** A skill whose whole effect is statuses: debuffs on an enemy (no hit roll) or buffs on an ally/self. */
export const StatusEffectSchema = z
  .object({
    kind: z.literal("status"),
    statuses: z.array(StatusApplicationSchema).min(1).max(3),
  })
  .strict();

// ---------------------------------------------------------------- passives (catalog §4)

/** Who a passive's effect lands on: the owner, the other unit of the event, or the owner's side. */
export const PassiveTargetSchema = z.enum(["self", "other", "allies", "lowest_ally"]);
export type PassiveTarget = z.infer<typeof PassiveTargetSchema>;

export const PassiveActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), target: PassiveTargetSchema, statuses: z.array(StatusApplicationSchema).min(1).max(3) }).strict(),
  /** Heals this % of the target's max HP. */
  z.object({ kind: z.literal("heal"), target: PassiveTargetSchema, pctMaxHp: z.number().int().min(1).max(50) }).strict(),
  z.object({ kind: z.literal("restore_mp"), target: PassiveTargetSchema, amount: z.number().int().min(1).max(200) }).strict(),
]);
export type PassiveAction = z.infer<typeof PassiveActionSchema>;

/**
 * When a passive fires (catalog §4 triggers). "other" is the unit on the other end of the event: the
 * target hit, the attacker, the unit knocked out, the ally fallen or protected, the skill's target.
 */
export const PASSIVE_EVENTS = [
  "battle_start",
  "turn_start",
  "turn_end",
  "dealt_damage",
  "took_damage",
  "kill",
  "ally_down",
  "hp_below",
  "protected_ally",
  "used_skill",
  /** A shield this unit put on someone ran out of time without breaking (other = the shielded unit). */
  "shield_expired",
] as const;
export type PassiveEvent = (typeof PASSIVE_EVENTS)[number];

export const PassiveTriggerSchema = z
  .object({
    on: z.enum(PASSIVE_EVENTS),
    /** dealt_damage / took_damage / kill: only from basic attacks, or only from skills. */
    action: z.enum(["attack", "skill"]).optional(),
    /** The other unit had this status at the moment of the event (e.g. a kill on a marked target). */
    otherHas: z.enum(STATUS_IDS).optional(),
    /** used_skill: only skills that apply this status (e.g. cleanse). */
    skillApplies: z.enum(STATUS_IDS).optional(),
    /** hp_below: fires when the owner's HP drops under this % of max. */
    hpBelowPct: z.number().int().min(1).max(99).optional(),
    chancePct: z.number().int().min(1).max(100).default(100),
    oncePerBattle: z.boolean().default(false),
    then: z.array(PassiveActionSchema).min(1).max(3),
  })
  .strict()
  .superRefine((t, ctx) => {
    if ((t.on === "hp_below") !== (t.hpBelowPct !== undefined)) ctx.addIssue({ code: "custom", message: "hpBelowPct goes with hp_below only" });
    if (t.skillApplies !== undefined && t.on !== "used_skill") ctx.addIssue({ code: "custom", message: "skillApplies goes with used_skill only" });
    const noOther = t.on === "battle_start" || t.on === "turn_start" || t.on === "turn_end" || t.on === "hp_below";
    if (noOther && t.otherHas !== undefined) ctx.addIssue({ code: "custom", message: `${t.on} has no other unit` });
    // Harmful statuses only on an enemy "other"; helpful ones, heals and MP only on the owner's side.
    // used_skill's other can be either side: the kernel checks that one when it fires.
    const enemyOther = t.on === "dealt_damage" || t.on === "took_damage" || t.on === "kill";
    const mayBeEnemy = enemyOther || t.on === "used_skill";
    for (const a of t.then) {
      if (noOther && a.target === "other") ctx.addIssue({ code: "custom", message: `${t.on} has no other unit to target` });
      const harmfulList = a.kind === "status" ? a.statuses.map((x) => STATUS_DEFINITIONS[x.statusId].harmful) : [false];
      if (harmfulList.some((h) => h) && harmfulList.some((h) => !h)) ctx.addIssue({ code: "custom", message: "one action cannot mix harmful and helpful statuses" });
      if (harmfulList[0] === true && !(a.target === "other" && mayBeEnemy)) ctx.addIssue({ code: "custom", message: "harmful statuses only go on the enemy of the event" });
      if (harmfulList[0] === false && a.target === "other" && enemyOther) ctx.addIssue({ code: "custom", message: "helpful effects never go on an enemy" });
      if (a.kind === "status") {
        for (const x of a.statuses) if ((x.stacks ?? 1) > STATUS_DEFINITIONS[x.statusId].maxStacks) ctx.addIssue({ code: "custom", message: `${x.statusId} stacks above its cap` });
      }
    }
  });
export type PassiveTrigger = z.infer<typeof PassiveTriggerSchema>;

/** Always-on changes while the passive's owner fights. */
export const PassiveModifierSchema = z.discriminatedUnion("kind", [
  /** More damage against a target with this status (e.g. the fox Sigil idea: burned targets). */
  z.object({ kind: z.literal("damage_vs_status"), statusId: z.enum(STATUS_IDS), bonusPct: z.number().int().min(1).max(100) }).strict(),
  /** While guarding, takes this % less again (the crab Sigil idea: guard, then a smaller hit). */
  z.object({ kind: z.literal("guard_reduction"), reductionPct: z.number().int().min(1).max(50) }).strict(),
  /** Heals more on a target below this HP share (the snail Sigil idea). */
  z.object({ kind: z.literal("heal_low_hp"), belowHpPct: z.number().int().min(1).max(99), bonusPct: z.number().int().min(1).max(100) }).strict(),
]);
export type PassiveModifier = z.infer<typeof PassiveModifierSchema>;

export const PassiveSchema = z
  .object({
    triggers: z.array(PassiveTriggerSchema).max(3).default([]),
    modifiers: z.array(PassiveModifierSchema).max(3).default([]),
  })
  .strict();
export type Passive = z.infer<typeof PassiveSchema>;

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

/**
 * Who a skill can aim at. Area skills (Nut 2026-10-04 "ทำระบบ AOE ได้เลย") hit every unit they
 * cover, each with its own hit and crit roll: all enemies in reach, the row of the chosen enemy, or the
 * whole own side. A melee area skill reaches the front row only while it stands (same reach rule).
 */
export const TARGET_RULES = ["single_enemy", "all_enemies", "enemy_row", "single_ally", "all_allies", "self", "none"] as const;
export type TargetRule = (typeof TARGET_RULES)[number];
export const targetsEnemies = (r: TargetRule) => r === "single_enemy" || r === "all_enemies" || r === "enemy_row";
export const isAreaRule = (r: TargetRule) => r === "all_enemies" || r === "enemy_row" || r === "all_allies";

export const SkillDefinitionSchema = z
  .object({
    id: SkillId,
    ...contentMeta,
    name: LocalizedName,
    kind: z.enum(["active", "passive"]),
    ownerKind: z.enum(["player", "companion", "enemy"]),
    targetRule: z.enum(TARGET_RULES),
    range: z.enum(["melee", "ranged"]),
    mpCost: z.number().int().min(0),
    /** Owner turns before reuse. Tick point is O15. */
    cooldown: z.number().int().min(0),
    effectSequence: z.array(z.discriminatedUnion("kind", [DamageEffectSchema, HealEffectSchema, StatusEffectSchema])),
    tags: z.array(z.string()),
    /** One step per level 2–10 when present; absent = the default power step (rules). */
    levelSteps: z.array(SkillLevelStepSchema).optional(),
    /** A Rebirth variant of this base skill (chapter 04 §7): same role, played differently. */
    variantOf: SkillId.optional(),
    /** What a passive or innate does (catalog §4); absent = not built yet (waits for shield etc.). */
    passive: PassiveSchema.optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.passive !== undefined && s.kind !== "passive") ctx.addIssue({ code: "custom", message: "only passive skills carry passive effects" });
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
    for (const e of s.effectSequence) {
      const onEnemy = targetsEnemies(s.targetRule);
      if (s.kind === "active" && e.kind === "damage" && !onEnemy) ctx.addIssue({ code: "custom", message: "damage skills aim at enemies" });
      if (s.kind === "active" && e.kind === "heal" && onEnemy) ctx.addIssue({ code: "custom", message: "heal skills aim at allies" });
      if (s.kind === "active" && s.targetRule === "none") ctx.addIssue({ code: "custom", message: "an active skill needs a target rule" });
      for (const a of e.statuses ?? []) {
        if (STATUS_DEFINITIONS[a.statusId].harmful !== onEnemy) {
          ctx.addIssue({ code: "custom", message: `${a.statusId} is ${onEnemy ? "helpful" : "harmful"} and cannot go on ${onEnemy ? "an enemy" : "an ally"}` });
        }
        if ((a.stacks ?? 1) > STATUS_DEFINITIONS[a.statusId].maxStacks) ctx.addIssue({ code: "custom", message: `${a.statusId} stacks above its cap` });
      }
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
    /** Wild bosses only: actions per round (chapter 03 exception). Never used for companions. */
    bossActionsPerRound: z.number().int().min(2).max(RULES.provisional.bossActions.value.maxPerRound).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.bossActionsPerRound !== undefined && s.rank !== "BOSS") {
      ctx.addIssue({ code: "custom", path: ["bossActionsPerRound"], message: "only BOSS species act more than once a round" });
    }
  });
export type SpeciesDefinition = z.infer<typeof SpeciesDefinitionSchema>;

// ---------------------------------------------------------------- bosses (chapter 07 §5, P17)

/** What moves a boss into a phase. Any one of a phase's triggers is enough. */
export const BossPhaseTriggerSchema = z.discriminatedUnion("kind", [
  /** The boss's HP share drops below this %. */
  z.object({ kind: z.literal("hp_below"), pct: z.number().int().min(1).max(99) }).strict(),
  /** A shield on the boss was broken by damage (the crystal shell). */
  z.object({ kind: z.literal("shield_broken") }).strict(),
]);

/**
 * A heavy move the boss warns about at the start of a round and uses on its first action of the next
 * round, so every unit gets a turn to answer it (chapter 07 §5: never warn and fire before anyone can
 * respond). `hint` tells the player what answers it.
 */
export const BossTelegraphSchema = z
  .object({ skillId: SkillId, everyRounds: z.number().int().min(2).max(10), hint: LocalizedName })
  .strict();

export const BossPhaseSchema = z
  .object({
    id: z.string().min(1),
    name: LocalizedName,
    /** Empty for the first phase (the fight starts in it); later phases need at least one trigger. */
    enterWhen: z.array(BossPhaseTriggerSchema).max(3),
    /** Put on the boss when the phase starts; they cannot be resisted. */
    onEnter: z.array(StatusApplicationSchema).max(4),
    /** Taken off the boss when the phase starts. */
    removeStatuses: z.array(z.enum(STATUS_IDS)).max(4),
    telegraph: BossTelegraphSchema.optional(),
    /** In this phase the boss can be captured once its HP share is below this %. */
    captureBelowHpPct: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type BossPhase = z.infer<typeof BossPhaseSchema>;

export const BossDefinitionSchema = z
  .object({
    id: BossId,
    ...contentMeta,
    name: LocalizedName,
    speciesId: SpeciesId,
    element: ElementSchema,
    /** Wild only: the boss's max HP is its species' HP times this. A captured boss never has it (chapter 07 §5). */
    hpMultiplier: z.number().min(1).max(20),
    /** Monsters that start the fight with it; boss + adds ≤ 10 (C05). Adds without loot give EXP only. */
    adds: z.array(z.object({ speciesId: SpeciesId, element: ElementSchema, row: z.enum(["front", "back"]), lootEligible: z.boolean() }).strict()).max(9),
    /** Early phase teaches the pattern, later ones change it (chapter 07 §5: a low boss needs 2 phases). */
    phases: z.array(BossPhaseSchema).min(1).max(3),
  })
  .strict()
  .superRefine((b, ctx) => {
    b.phases.forEach((ph, i) => {
      if ((i === 0) !== (ph.enterWhen.length === 0)) {
        ctx.addIssue({ code: "custom", path: ["phases", i, "enterWhen"], message: i === 0 ? "the first phase starts the fight and has no trigger" : "a later phase needs a trigger" });
      }
    });
    if (!b.phases.some((ph) => ph.captureBelowHpPct !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["phases"], message: "every boss has a capture path (C08): some phase needs captureBelowHpPct" });
    }
  });
export type BossDefinition = z.infer<typeof BossDefinitionSchema>;

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

/** Gear rarity (chapter 05 §2): sets how many random affixes a piece carries. */
export const RaritySchema = z.enum(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]);
export type Rarity = z.infer<typeof RaritySchema>;

/** One rolled option on a piece of gear. */
export const RolledAffixSchema = z.object({ stat: z.string(), value: z.number() }).strict();
export type RolledAffix = z.infer<typeof RolledAffixSchema>;

/**
 * Random option pool for a type of gear (chapter 05 §3): which stats can roll and their range at
 * item Lv1 (scaled by the piece's level). Never drop, EXP or capture bonuses.
 */
export const AffixPoolSchema = z
  .object({
    id: z.string().regex(/^affix:[a-z0-9_]+$/),
    ...contentMeta,
    entries: z
      .array(z.object({ stat: z.string().min(1), weight: z.number().int().positive(), min: z.number().int().min(1), max: z.number().int().min(1) }).strict())
      .min(1),
  })
  .strict();
export type AffixPool = z.infer<typeof AffixPoolSchema>;

export const EquipmentInstanceSchema = z
  .object({
    id: z.string().min(1),
    definitionId: EquipmentDefinitionId,
    ownerId: z.string().min(1),
    refineLevel: z.number().int().min(0).max(10),
    rarity: RaritySchema.default("COMMON"),
    rolledAffixes: z.array(RolledAffixSchema).max(3),
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
    /** Shown before the equipment's name once installed (Nut 2026-10-04), e.g. "กระดอง" ดาบไม้. */
    prefix: LocalizedName,
    /**
     * What it does when worn (catalog §4 passive format). Copies of the same Sigil each add their %
     * modifiers, multiplied together (Nut 2026-10-04: % on %); a trigger fires once per Sigil kind.
     * Absent = no effect built yet.
     */
    effect: PassiveSchema.optional(),
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
