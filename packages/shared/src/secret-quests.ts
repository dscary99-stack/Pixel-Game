/**
 * Secret quests (Nut 2026-10-05: the game has no ending).
 *
 * - At Lv200 an awakening quest (เควสบรรลุ) opens the secret quests. Each character has its own set:
 *   one for its element, one for its race and `personalCount` personal ones (P16).
 * - The set is rolled once, when the character is created, from a seed the server derives from the
 *   account id and character name with a server-only key (HMAC), so players cannot work it out from
 *   public inputs. The same seed and templates always give the same set.
 * - The set stays hidden: nothing about it (not even how many there are) reaches the client until
 *   the server unlocks it. The awakening quest does not exist yet, so nothing unlocks in normal play.
 * - Parameters (species, map, item, count, condition, and a challenge's rounds / HP line / Bond tier /
 *   tower floor) come from content, chosen by the seeded RNG.
 * - Generator v2 (2026-10-06): challenge templates and more personal quests per set. A stored set keeps
 *   its own generator version and is never rerolled, so v1 sets read back unchanged.
 * - Generator v3 (Nut 2026-10-06, 04:37Z): every quest carries rewards rolled with it (any kind:
 *   unique title, unique fashion, a unique monster, special gear) and the templates are much harder:
 *   bigger counts and conditions that must all hold together (`require`). A reward is personal: its
 *   variant id comes from the character's seed. Rewards are only rolled and stored here; granting
 *   them (through the ledger) waits for progress tracking.
 * Templates here are the contract; the pool itself is EXAMPLE content (content/secret-quests.ts).
 * Progress from fights: secret-progress.ts (counted only once the set is revealed).
 */
import { z } from "zod";
import { PLAYER_ELEMENTS, RACE_DEFINITIONS } from "./character";
import { Rng, seedRng } from "./rng";
import type { RulesConfig } from "./rules";
import {
  ElementSchema,
  EquipmentDefinitionId,
  ItemId,
  RebirthCosmeticSchema,
  SkillId,
  SpeciesId,
  type Element,
  type EquipmentDefinition,
  type ItemDefinition,
  type SkillDefinition,
  type SpeciesDefinition,
} from "./schemas";
import type { MapDefinition } from "./world/map";

/** Bump when the roll changes; stored with every set so old sets keep their meaning. */
export const SECRET_QUEST_GENERATOR_VERSION = 3;

export const SecretQuestKindSchema = z.enum(["element", "race", "personal"]);
export type SecretQuestKind = z.infer<typeof SecretQuestKindSchema>;

/**
 * What the quest asks. defeat/capture name a species; boss a boss species; explore a map to reach;
 * win a number of won fights (on a map when one is given); deliver an item to hand in;
 * elite_capture an elite-pack leader of a species to catch (by hand, C15); tower a floor of the weekly
 * tower to reach.
 */
export const SecretQuestGoalSchema = z.enum(["defeat", "capture", "boss", "explore", "win", "deliver", "elite_capture", "tower"]);
export type SecretQuestGoal = z.infer<typeof SecretQuestGoalSchema>;

/**
 * Extra rule a fight must follow to count. solo: no companions; mono_element_team: every companion
 * (and the element param when one is rolled) of one element; within_rounds: won by round `rounds`;
 * low_hp_finish: the character ends under `hpBelowPct`% HP; bond_tier: a companion at Bond tier
 * `bondTier` or above fights in it.
 */
export const SecretQuestConditionSchema = z.enum(["solo", "no_items", "full_team", "mono_element_team", "no_knockout", "within_rounds", "low_hp_finish", "bond_tier"]);
export type SecretQuestCondition = z.infer<typeof SecretQuestConditionSchema>;

// ---------------------------------------------------------------- rewards (generator v3)

/** Reward kinds (Nut 2026-10-06, RULES.confirmed.secretQuestRewardKinds). */
export const SecretRewardKindSchema = z.enum(["title", "fashion", "companion", "gear"]);
export type SecretRewardKind = z.infer<typeof SecretRewardKindSchema>;

const rewardMeta = {
  id: z.string().regex(/^srw:[a-z0-9_]+$/),
  version: z.number().int().min(1),
  status: z.enum(["draft", "validated", "published", "retired"]),
  example: z.boolean(),
  name: z.object({ th: z.string().min(1), en: z.string().min(1).optional() }).strict(),
};

/**
 * What a secret quest can give. Everything is a one-of-a-kind look or a sidegrade, never raw power
 * (no premium/collection power, chapter 09):
 * - title: a unique title; the character's variant id makes it theirs.
 * - fashion: a cosmetic outfit layer with an effect and tint (no stats).
 * - companion: a unique monster, a variant of a NORMAL species with a cosmetic marker and an innate
 *   passive picked from `innateOptions` (passives that NORMAL species already carry, so no power above
 *   normal budgets). Like any capture it starts at Lv1 (companions never keep a wild level).
 * - gear: special equipment on an existing base piece; its unique effect is a placeholder (`null`)
 *   until unique effects are designed (chapter 05 §3).
 */
export const SecretRewardDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ ...rewardMeta, kind: z.literal("title") }).strict(),
  z.object({ ...rewardMeta, kind: z.literal("fashion"), layer: z.enum(["head", "body", "back", "aura"]), look: RebirthCosmeticSchema.omit({ id: true, name: true }) }).strict(),
  z
    .object({
      ...rewardMeta,
      kind: z.literal("companion"),
      baseSpeciesId: SpeciesId,
      marker: RebirthCosmeticSchema.omit({ id: true, name: true }),
      innateOptions: z.array(SkillId).min(1).max(6),
    })
    .strict(),
  z.object({ ...rewardMeta, kind: z.literal("gear"), baseEquipmentId: EquipmentDefinitionId, uniqueEffect: z.null() }).strict(),
]);
export type SecretRewardDefinition = z.infer<typeof SecretRewardDefinitionSchema>;

/** A template's rewards: "all" gives one of each kind listed, "one" rolls one kind of the list. */
export const SecretQuestRewardSlotSchema = z
  .object({
    kinds: z.array(SecretRewardKindSchema).min(1).max(4),
    pick: z.enum(["all", "one"]),
  })
  .strict();

/** A rolled reward: the definition plus the character's own variant (from the seed). */
export const SecretQuestRewardSchema = z
  .object({
    kind: SecretRewardKindSchema,
    rewardId: z.string().regex(/^srw:[a-z0-9_]+$/),
    /** Per-character variant (8 hex from the seeded roll): the title/look/monster is this character's own. */
    variantId: z.string().regex(/^v[0-9a-f]{8}$/),
    /** companion only: the innate passive picked from the reward's options. */
    innateId: SkillId.optional(),
  })
  .strict()
  .refine((r) => (r.kind === "companion") === (r.innateId !== undefined), "companion rewards (and only they) pick an innate");
export type SecretQuestReward = z.infer<typeof SecretQuestRewardSchema>;

/** of_element: a normal species of the rolled element; elite_leader: one that leads an ELITE spawn in the maps. */
const SpeciesSlotSchema = z.enum(["any", "normal", "boss", "of_element", "elite_leader"]);
const range = (max: number) => z.tuple([z.number().int().min(1).max(max), z.number().int().min(1).max(max)]);

/** A condition's number comes from its own slot. */
const CONDITION_SLOT = { within_rounds: "rounds", low_hp_finish: "hpBelowPct", bond_tier: "bondTier" } as const;

export const SecretQuestTemplateSchema = z
  .object({
    id: z.string().regex(/^sqt:[a-z0-9_]+$/),
    version: z.number().int().min(1),
    status: z.enum(["draft", "validated", "published", "retired"]),
    example: z.boolean(),
    kind: SecretQuestKindSchema,
    /** element kind: the character element this template is for. */
    element: ElementSchema.optional(),
    /** race kind: the race this template is for. */
    raceId: z.string().regex(/^race:[a-z0-9_]+$/).optional(),
    goal: SecretQuestGoalSchema,
    /**
     * Shown only after the quest is revealed; `{species}`, `{element}`, `{map}`, `{item}`, `{count}`,
     * `{rounds}`, `{hpPct}`, `{bondTier}`, `{floor}` are filled in.
     */
    text: z.object({ th: z.string().min(1) }).strict(),
    slots: z
      .object({
        /** "template": the template's own element; "any": one of the six player elements. */
        element: z.enum(["template", "any"]).optional(),
        /** "of_element": a normal species that can appear in the rolled element. */
        species: SpeciesSlotSchema.optional(),
        map: z.enum(["field", "town", "any"]).optional(),
        item: z.literal("material").optional(),
        count: range(9999),
        conditions: z.array(SecretQuestConditionSchema).min(1).max(5).optional(),
        /** within_rounds: the round the fight must be won by. */
        rounds: range(50).optional(),
        /** low_hp_finish: the character's HP % to end under. */
        hpBelowPct: range(99).optional(),
        /** bond_tier: the lowest Bond tier (0-based, rules bondTierSize) a companion in the fight needs. */
        bondTier: range(9).optional(),
        /** tower goals: the floor to reach (at most the tower's floors). */
        floor: range(999).optional(),
        /** v3: conditions that must all hold together (on top of the one rolled from `conditions`). */
        require: z.array(SecretQuestConditionSchema).min(1).max(5).optional(),
      })
      .strict(),
    /** v3: what finishing it gives. */
    reward: SecretQuestRewardSlotSchema,
  })
  .strict()
  .refine((t) => (t.kind === "element") === (t.element !== undefined), "element templates (and only they) name an element")
  .refine((t) => (t.kind === "race") === (t.raceId !== undefined), "race templates (and only they) name a race");
export type SecretQuestTemplate = z.infer<typeof SecretQuestTemplateSchema>;

export const SecretQuestParamsSchema = z
  .object({
    count: z.number().int().min(1).max(9999),
    element: ElementSchema.optional(),
    speciesId: z.string().regex(/^species:[a-z0-9_]+$/).optional(),
    mapId: z.string().regex(/^map:[a-z0-9_]+$/).optional(),
    itemId: ItemId.optional(),
    condition: SecretQuestConditionSchema.optional(),
    rounds: z.number().int().min(1).max(50).optional(),
    hpBelowPct: z.number().int().min(1).max(99).optional(),
    bondTier: z.number().int().min(1).max(9).optional(),
    floor: z.number().int().min(1).max(999).optional(),
    /** v3: conditions that must all hold. */
    require: z.array(SecretQuestConditionSchema).min(1).max(5).optional(),
  })
  .strict();
export type SecretQuestParams = z.infer<typeof SecretQuestParamsSchema>;

export const SecretQuestSchema = z
  .object({
    id: z.string().regex(/^sq:(element|race|personal):[a-z0-9_]+$/),
    kind: SecretQuestKindSchema,
    templateId: z.string().regex(/^sqt:[a-z0-9_]+$/),
    goal: SecretQuestGoalSchema,
    params: SecretQuestParamsSchema,
    /** v3 sets: what finishing it gives (absent in stored v1/v2 sets). */
    rewards: z.array(SecretQuestRewardSchema).min(1).max(4).optional(),
  })
  .strict();
export type SecretQuest = z.infer<typeof SecretQuestSchema>;

export const SecretQuestSetSchema = z
  .object({
    generatorVersion: z.number().int().min(1),
    quests: z.array(SecretQuestSchema).min(2),
  })
  .strict()
  .refine((s) => s.generatorVersion < 3 || s.quests.every((q) => q.rewards !== undefined), "v3 sets carry a reward on every quest");
export type SecretQuestSet = z.infer<typeof SecretQuestSetSchema>;

/** What the client may see: a locked set says nothing else (no count, no hints). */
export type SecretQuestView =
  | { locked: true }
  | {
      locked: false;
      quests: SecretQuest[];
      /** Quest id → progress so far (secret-progress.ts); a quest not listed has none yet. */
      progress?: Record<string, { progress: number; completed: boolean }>;
    };

export interface SecretQuestContent {
  species: ReadonlyMap<string, SpeciesDefinition>;
  maps: ReadonlyMap<string, MapDefinition>;
  items: ReadonlyMap<string, ItemDefinition>;
  /** Floors of the weekly tower; tower goals need it. */
  frontierFloors?: number;
  /** v3 reward pool (EXAMPLE content/secret-quests.ts). */
  rewards?: ReadonlyMap<string, SecretRewardDefinition>;
  /** For the reward check: companion innates and gear bases must exist. */
  skills?: ReadonlyMap<string, SkillDefinition>;
  equipment?: ReadonlyMap<string, EquipmentDefinition>;
}

const byId = <T extends { id: string }>(xs: Iterable<T>): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Candidates for each slot, sorted so the roll never depends on content order. */
function speciesPool(content: SecretQuestContent, slot: z.infer<typeof SpeciesSlotSchema>, element: Element | undefined): string[] {
  return byId(content.species.values())
    .filter((s) => {
      if (slot === "boss") return s.rank === "BOSS";
      if (slot === "any") return true;
      if (slot === "elite_leader") return eliteLeaders(content).has(s.id);
      if (s.rank !== "NORMAL") return false;
      return slot === "normal" || (element !== undefined && s.allowedElements.includes(element));
    })
    .map((s) => s.id);
}
/** Species that can lead an ELITE spawn (any entry may roll as the leader). */
function eliteLeaders(content: SecretQuestContent): Set<string> {
  return new Set([...content.maps.values()].flatMap((m) => m.spawns.filter((sp) => sp.rank === "ELITE").flatMap((sp) => sp.entries.map((e) => e.speciesId))));
}
function mapPool(content: SecretQuestContent, slot: "field" | "town" | "any"): string[] {
  return byId(content.maps.values())
    .filter((m) => slot === "any" || m.kind === slot)
    .map((m) => m.id);
}
function itemPool(content: SecretQuestContent): string[] {
  return byId(content.items.values())
    .filter((i) => i.kind === "material")
    .map((i) => i.id);
}

function elementChoices(t: SecretQuestTemplate): Element[] {
  if (t.slots.element === "template") return t.element === undefined ? [] : [t.element];
  if (t.slots.element === "any") return [...PLAYER_ELEMENTS];
  return [];
}

const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng.nextInt(hi - lo + 1);
const pick = <T>(rng: Rng, list: readonly T[]): T => {
  if (list.length === 0) throw new Error("secret quest slot has no candidates");
  return list[rng.nextInt(list.length)]!;
};

function rewardPool(content: SecretQuestContent, kind: SecretRewardKind): SecretRewardDefinition[] {
  return byId(content.rewards?.values() ?? []).filter((r) => r.kind === kind);
}

/**
 * Roll a template's rewards. Within one set a reward definition is not given twice while unused ones of
 * that kind remain (`used`), so a set's rewards differ; the variant makes each one the character's own.
 */
function rollRewards(t: SecretQuestTemplate, content: SecretQuestContent, rng: Rng, used: Set<string>): SecretQuestReward[] {
  const kinds = t.reward.pick === "all" ? t.reward.kinds : [pick(rng, t.reward.kinds)];
  return kinds.map((kind) => {
    const pool = rewardPool(content, kind);
    const fresh = pool.filter((r) => !used.has(r.id));
    const def = pick(rng, fresh.length > 0 ? fresh : pool);
    used.add(def.id);
    const variantId = `v${rng.nextUint32().toString(16).padStart(8, "0")}`;
    const out: SecretQuestReward = { kind, rewardId: def.id, variantId };
    if (def.kind === "companion") out.innateId = pick(rng, [...def.innateOptions].sort());
    return out;
  });
}

function rollOne(t: SecretQuestTemplate, content: SecretQuestContent, rng: Rng, used: Set<string>): SecretQuest {
  const s = t.slots;
  const params: SecretQuestParams = { count: between(rng, s.count) };
  if (s.element !== undefined) params.element = pick(rng, elementChoices(t));
  if (s.species !== undefined) params.speciesId = pick(rng, speciesPool(content, s.species, params.element));
  if (s.map !== undefined) params.mapId = pick(rng, mapPool(content, s.map));
  if (s.item !== undefined) params.itemId = pick(rng, itemPool(content));
  if (s.conditions !== undefined) params.condition = pick(rng, s.conditions);
  // Generator v2 slots, rolled after the v1 ones in a fixed order.
  if (s.rounds !== undefined) params.rounds = between(rng, s.rounds);
  if (s.hpBelowPct !== undefined) params.hpBelowPct = between(rng, s.hpBelowPct);
  if (s.bondTier !== undefined) params.bondTier = between(rng, s.bondTier);
  if (s.floor !== undefined) params.floor = between(rng, s.floor);
  // Generator v3: fixed conditions, then the rewards.
  if (s.require !== undefined) params.require = [...s.require];
  const rewards = rollRewards(t, content, rng, used);
  return { id: `sq:${t.kind}:${t.id.slice("sqt:".length)}`, kind: t.kind, templateId: t.id, goal: t.goal, params, rewards };
}

/** Lowercase hex of the seed bytes; a hex string is taken as is. */
function seedHex(seed: Uint8Array | string): string {
  if (typeof seed !== "string") return [...seed].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!/^[0-9a-fA-F]+$/.test(seed)) throw new Error("secret quest seed must be bytes or hex");
  return seed.toLowerCase();
}

/**
 * The character's whole set: its element quest, its race quest, then `personalCount` different
 * personal quests. Deterministic in (seed, element, race, templates, content). The seed must come
 * from the server (HMAC of account id + name with a server key); at least 128 bits.
 */
export function rollSecretQuests(
  rules: RulesConfig,
  seed: Uint8Array | string,
  character: { element: Element; raceId: string },
  templates: readonly SecretQuestTemplate[],
  content: SecretQuestContent,
): SecretQuestSet {
  const hex = seedHex(seed);
  if (hex.length < 32) throw new Error("secret quest seed must be at least 128 bits");
  const rng = new Rng(seedRng(`secret-quests:v${SECRET_QUEST_GENERATOR_VERSION}:${hex}`));
  const pool = byId(templates);
  const forElement = pool.filter((t) => t.kind === "element" && t.element === character.element);
  const forRace = pool.filter((t) => t.kind === "race" && t.raceId === character.raceId);
  const personal = pool.filter((t) => t.kind === "personal");
  const n = rules.provisional.secretQuests.value.personalCount;
  if (forElement.length === 0) throw new Error(`no secret quest template for element ${character.element}`);
  if (forRace.length === 0) throw new Error(`no secret quest template for race ${character.raceId}`);
  if (personal.length < n) throw new Error(`need ${n} personal secret quest templates, have ${personal.length}`);
  const used = new Set<string>();
  const quests = [rollOne(pick(rng, forElement), content, rng, used), rollOne(pick(rng, forRace), content, rng, used)];
  // Personal templates without replacement, so no quest appears twice in one set.
  const left = [...personal];
  for (let i = 0; i < n; i++) quests.push(rollOne(left.splice(rng.nextInt(left.length), 1)[0]!, content, rng, used));
  return { generatorVersion: SECRET_QUEST_GENERATOR_VERSION, quests };
}

export interface SecretQuestTemplateIssue {
  templateId: string;
  message: string;
}

/** Slots each goal needs to mean anything. */
const GOAL_NEEDS: Record<SecretQuestGoal, ("species" | "map" | "item" | "floor")[]> = {
  defeat: ["species"],
  capture: ["species"],
  boss: ["species"],
  explore: ["map"],
  win: [],
  deliver: ["item"],
  elite_capture: ["species"],
  tower: ["floor"],
};

/**
 * Content check: every player element and every race has a template, there are enough personal
 * ones for a set, ids are unique, each goal has the slots it needs, and every slot can be filled
 * from this content (for every element an "any" element slot can roll).
 */
export function validateSecretQuestTemplates(rules: RulesConfig, templates: readonly SecretQuestTemplate[], content: SecretQuestContent): SecretQuestTemplateIssue[] {
  const out: SecretQuestTemplateIssue[] = [];
  const ids = new Set<string>();
  for (const t of templates) {
    const issue = (message: string) => out.push({ templateId: t.id, message });
    const parsed = SecretQuestTemplateSchema.safeParse(t);
    if (!parsed.success) issue(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    if (ids.has(t.id)) issue("template id used twice");
    ids.add(t.id);
    const s = t.slots;
    if (s.count[0] > s.count[1]) issue(`count range ${s.count[0]}–${s.count[1]} is upside down`);
    if (t.kind === "element" && t.element !== undefined && !(PLAYER_ELEMENTS as readonly string[]).includes(t.element)) issue(`${t.element} is not a player element`);
    if (t.kind === "race" && !RACE_DEFINITIONS.some((r) => r.id === t.raceId)) issue(`unknown race ${t.raceId}`);
    for (const need of GOAL_NEEDS[t.goal]) if (s[need] === undefined) issue(`${t.goal} needs a ${need} slot`);
    if (t.goal === "boss" && s.species !== "boss") issue("boss goals pick a boss species");
    if ((t.goal === "defeat" || t.goal === "capture") && s.species === "boss") issue(`${t.goal} goals pick normal species (use goal boss)`);
    if ((t.goal === "elite_capture") !== (s.species === "elite_leader")) issue("elite_capture goals (and only they) pick an elite_leader species");
    if (t.goal !== "tower" && s.floor !== undefined) issue("only tower goals have a floor");
    for (const [cond, slot] of Object.entries(CONDITION_SLOT) as [keyof typeof CONDITION_SLOT, (typeof CONDITION_SLOT)[keyof typeof CONDITION_SLOT]][]) {
      const rolled = s.conditions?.includes(cond) === true;
      const has = rolled || s.require?.includes(cond) === true;
      if (has && s[slot] === undefined) issue(`${cond} needs a ${slot} slot`);
      if (!has && s[slot] !== undefined) issue(`${slot} slot without the ${cond} condition`);
      // Every condition of the list may roll, so a numbered one must be the only one.
      if (rolled && s.conditions!.length > 1) issue(`${cond} must be the template's only condition`);
    }
    if (s.require !== undefined) {
      if (new Set(s.require).size !== s.require.length) issue("a required condition is listed twice");
      for (const c of s.require) if (s.conditions?.includes(c) === true) issue(`${c} is both required and rolled`);
      const all = [...s.require, ...(s.conditions?.length === 1 ? s.conditions : [])];
      if (all.includes("solo") && all.includes("full_team")) issue("solo and full_team cannot hold together");
    }
    const kinds = t.reward?.kinds ?? [];
    if (new Set(kinds).size !== kinds.length) issue("a reward kind is listed twice");
    const allowed = rules.confirmed.secretQuestRewardKinds.value as readonly string[];
    for (const k of kinds) {
      if (!allowed.includes(k)) issue(`reward kind ${k} is not allowed`);
      else if (rewardPool(content, k).length === 0) issue(`no ${k} reward in the pool`);
    }
    for (const slot of ["rounds", "hpBelowPct", "bondTier", "floor"] as const) {
      const r = s[slot];
      if (r !== undefined && r[0] > r[1]) issue(`${slot} range ${r[0]}–${r[1]} is upside down`);
    }
    const tiers = rules.provisional.bondTierBonusPercent.value.length;
    if (s.bondTier !== undefined && s.bondTier[1] > tiers - 1) issue(`bond tier ${s.bondTier[1]} is above the top tier ${tiers - 1}`);
    if (t.goal === "tower" && s.floor !== undefined) {
      if (content.frontierFloors === undefined) issue("tower goals need the tower's floor count");
      else if (s.floor[1] > content.frontierFloors) issue(`floor ${s.floor[1]} is above the tower's ${content.frontierFloors} floors`);
    }
    if (s.species === "of_element" && s.element === undefined) issue("of_element species needs an element slot");
    if (s.element === "template" && t.element === undefined) issue("element slot 'template' needs the template's element");
    if (s.species !== undefined) {
      const elements: (Element | undefined)[] = s.species === "of_element" ? elementChoices(t) : [undefined];
      for (const e of elements) if (speciesPool(content, s.species, e).length === 0) issue(`no ${s.species} species${e === undefined ? "" : ` for ${e}`}`);
    }
    if (s.map !== undefined && mapPool(content, s.map).length === 0) issue(`no ${s.map} map`);
    if (s.item !== undefined && itemPool(content).length === 0) issue("no material item");
  }
  const general = (message: string) => out.push({ templateId: "*", message });
  for (const i of validateSecretRewards(content)) general(i);
  for (const e of PLAYER_ELEMENTS) if (!templates.some((t) => t.kind === "element" && t.element === e)) general(`no element template for ${e}`);
  for (const r of RACE_DEFINITIONS) if (!templates.some((t) => t.kind === "race" && t.raceId === r.id)) general(`no race template for ${r.id}`);
  const n = rules.provisional.secretQuests.value.personalCount;
  const personal = templates.filter((t) => t.kind === "personal").length;
  if (personal < n) general(`${personal} personal templates, a set needs ${n}`);
  return out;
}

/**
 * Reward pool check: each entry parses, companion variants sit on a NORMAL species and only offer
 * innates that NORMAL species already carry (no power beyond normal budgets), gear sits on a real base
 * piece, and every kind has at least one entry.
 */
export function validateSecretRewards(content: SecretQuestContent): string[] {
  const out: string[] = [];
  const rewards = [...(content.rewards?.values() ?? [])];
  const normalInnates = new Set([...content.species.values()].filter((s) => s.rank === "NORMAL").map((s) => s.innatePassiveId));
  for (const r of rewards) {
    const parsed = SecretRewardDefinitionSchema.safeParse(r);
    if (!parsed.success) out.push(`${r.id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (r.kind === "companion") {
      const base = content.species.get(r.baseSpeciesId);
      if (base === undefined) out.push(`${r.id}: unknown species ${r.baseSpeciesId}`);
      else if (base.rank !== "NORMAL") out.push(`${r.id}: a unique monster is a NORMAL species variant, not ${base.rank}`);
      for (const sk of r.innateOptions) {
        if (content.skills !== undefined && !content.skills.has(sk)) out.push(`${r.id}: unknown skill ${sk}`);
        else if (!normalInnates.has(sk)) out.push(`${r.id}: innate ${sk} is not one a NORMAL species carries (no power above normal budgets)`);
      }
      if (new Set(r.innateOptions).size !== r.innateOptions.length) out.push(`${r.id}: an innate option is listed twice`);
    }
    if (r.kind === "gear" && content.equipment !== undefined && !content.equipment.has(r.baseEquipmentId)) out.push(`${r.id}: unknown equipment ${r.baseEquipmentId}`);
  }
  for (const k of SecretRewardKindSchema.options) if (!rewards.some((r) => r.kind === k)) out.push(`no ${k} reward in the pool`);
  return out;
}
