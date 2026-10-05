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
 * - Parameters (species, map, item, count, condition) come from content, chosen by the seeded RNG.
 * Templates here are the contract; the pool itself is EXAMPLE content (content/secret-quests.ts).
 */
import { z } from "zod";
import { PLAYER_ELEMENTS, RACE_DEFINITIONS } from "./character";
import { Rng, seedRng } from "./rng";
import type { RulesConfig } from "./rules";
import { ElementSchema, ItemId, type Element, type ItemDefinition, type SpeciesDefinition } from "./schemas";
import type { MapDefinition } from "./world/map";

/** Bump when the roll changes; stored with every set so old sets keep their meaning. */
export const SECRET_QUEST_GENERATOR_VERSION = 1;

export const SecretQuestKindSchema = z.enum(["element", "race", "personal"]);
export type SecretQuestKind = z.infer<typeof SecretQuestKindSchema>;

/**
 * What the quest asks. defeat/capture name a species; boss a boss species; explore a map to reach;
 * win a number of won fights (on a map when one is given); deliver an item to hand in.
 */
export const SecretQuestGoalSchema = z.enum(["defeat", "capture", "boss", "explore", "win", "deliver"]);
export type SecretQuestGoal = z.infer<typeof SecretQuestGoalSchema>;

/** Extra rule a fight must follow to count. */
export const SecretQuestConditionSchema = z.enum(["solo", "no_items", "full_team", "mono_element_team", "no_knockout"]);
export type SecretQuestCondition = z.infer<typeof SecretQuestConditionSchema>;

const SpeciesSlotSchema = z.enum(["any", "normal", "boss", "of_element"]);

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
    /** Shown only after the quest is revealed; `{species}`, `{element}`, `{map}`, `{item}`, `{count}` are filled in. */
    text: z.object({ th: z.string().min(1) }).strict(),
    slots: z
      .object({
        /** "template": the template's own element; "any": one of the six player elements. */
        element: z.enum(["template", "any"]).optional(),
        /** "of_element": a normal species that can appear in the rolled element. */
        species: SpeciesSlotSchema.optional(),
        map: z.enum(["field", "town", "any"]).optional(),
        item: z.literal("material").optional(),
        count: z.tuple([z.number().int().min(1).max(9999), z.number().int().min(1).max(9999)]),
        conditions: z.array(SecretQuestConditionSchema).min(1).max(5).optional(),
      })
      .strict(),
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
  })
  .strict();
export type SecretQuest = z.infer<typeof SecretQuestSchema>;

export const SecretQuestSetSchema = z
  .object({
    generatorVersion: z.number().int().min(1),
    quests: z.array(SecretQuestSchema).min(2),
  })
  .strict();
export type SecretQuestSet = z.infer<typeof SecretQuestSetSchema>;

/** What the client may see: a locked set says nothing else (no count, no hints). */
export type SecretQuestView = { locked: true } | { locked: false; quests: SecretQuest[] };

export interface SecretQuestContent {
  species: ReadonlyMap<string, SpeciesDefinition>;
  maps: ReadonlyMap<string, MapDefinition>;
  items: ReadonlyMap<string, ItemDefinition>;
}

const byId = <T extends { id: string }>(xs: Iterable<T>): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Candidates for each slot, sorted so the roll never depends on content order. */
function speciesPool(content: SecretQuestContent, slot: z.infer<typeof SpeciesSlotSchema>, element: Element | undefined): string[] {
  return byId(content.species.values())
    .filter((s) => {
      if (slot === "boss") return s.rank === "BOSS";
      if (slot === "any") return true;
      if (s.rank !== "NORMAL") return false;
      return slot === "normal" || (element !== undefined && s.allowedElements.includes(element));
    })
    .map((s) => s.id);
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

const pick = <T>(rng: Rng, list: readonly T[]): T => {
  if (list.length === 0) throw new Error("secret quest slot has no candidates");
  return list[rng.nextInt(list.length)]!;
};

function rollOne(t: SecretQuestTemplate, content: SecretQuestContent, rng: Rng): SecretQuest {
  const s = t.slots;
  const params: SecretQuestParams = { count: s.count[0] + rng.nextInt(s.count[1] - s.count[0] + 1) };
  if (s.element !== undefined) params.element = pick(rng, elementChoices(t));
  if (s.species !== undefined) params.speciesId = pick(rng, speciesPool(content, s.species, params.element));
  if (s.map !== undefined) params.mapId = pick(rng, mapPool(content, s.map));
  if (s.item !== undefined) params.itemId = pick(rng, itemPool(content));
  if (s.conditions !== undefined) params.condition = pick(rng, s.conditions);
  return { id: `sq:${t.kind}:${t.id.slice("sqt:".length)}`, kind: t.kind, templateId: t.id, goal: t.goal, params };
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
  const quests = [rollOne(pick(rng, forElement), content, rng), rollOne(pick(rng, forRace), content, rng)];
  // Personal templates without replacement, so no quest appears twice in one set.
  const left = [...personal];
  for (let i = 0; i < n; i++) quests.push(rollOne(left.splice(rng.nextInt(left.length), 1)[0]!, content, rng));
  return { generatorVersion: SECRET_QUEST_GENERATOR_VERSION, quests };
}

export interface SecretQuestTemplateIssue {
  templateId: string;
  message: string;
}

/** Slots each goal needs to mean anything. */
const GOAL_NEEDS: Record<SecretQuestGoal, ("species" | "map" | "item")[]> = {
  defeat: ["species"],
  capture: ["species"],
  boss: ["species"],
  explore: ["map"],
  win: [],
  deliver: ["item"],
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
  for (const e of PLAYER_ELEMENTS) if (!templates.some((t) => t.kind === "element" && t.element === e)) general(`no element template for ${e}`);
  for (const r of RACE_DEFINITIONS) if (!templates.some((t) => t.kind === "race" && t.raceId === r.id)) general(`no race template for ${r.id}`);
  const n = rules.provisional.secretQuests.value.personalCount;
  const personal = templates.filter((t) => t.kind === "personal").length;
  if (personal < n) general(`${personal} personal templates, a set needs ${n}`);
  return out;
}
