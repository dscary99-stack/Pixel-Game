import { describe, expect, it } from "vitest";
import {
  EXAMPLE_SECRET_QUEST_TEMPLATES as T,
  PLAYER_ELEMENTS,
  PRODUCTION_RULES as R,
  RACE_DEFINITIONS,
  SECRET_QUEST_GENERATOR_VERSION,
  SecretQuestSetSchema,
  SecretQuestTemplateSchema,
  exampleContentMaps,
  exampleMapRegistry,
  rollSecretQuests,
  validateSecretQuestTemplates,
  type SecretQuestTemplate,
} from "../src";

const content = { ...exampleContentMaps(), maps: exampleMapRegistry() };
const seed = (s: string) => s.repeat(64).slice(0, 64);
const who = { element: "FIRE", raceId: "race:human" } as const;

describe("secret quest templates (EXAMPLE pool)", () => {
  it("parse, are marked EXAMPLE/draft and pass the content check", () => {
    for (const t of T) {
      expect(SecretQuestTemplateSchema.safeParse(t).success, t.id).toBe(true);
      expect(t).toMatchObject({ example: true, status: "draft" });
    }
    expect(validateSecretQuestTemplates(R, T, content)).toEqual([]);
    expect(T.filter((t) => t.kind === "personal").length).toBeGreaterThanOrEqual(8);
  });

  it("flags missing elements/races, too few personal ones, bad slots and duplicate ids", () => {
    const fire = T.find((t) => t.id === "sqt:element_fire")!;
    const bad: SecretQuestTemplate[] = [
      ...T.filter((t) => t.element !== "SHADOW" && t.raceId !== "race:veilborn" && t.kind !== "personal"),
      fire,
      { ...fire, id: "sqt:bad_range", slots: { ...fire.slots, count: [9, 3] } },
      { ...fire, id: "sqt:no_species", kind: "personal", element: undefined, slots: { count: [1, 2] } },
      { ...fire, id: "sqt:boss_defeat", kind: "personal", element: undefined, slots: { species: "boss", count: [1, 2] } },
    ];
    const msgs = validateSecretQuestTemplates(R, bad, content).map((i) => `${i.templateId} ${i.message}`);
    for (const want of ["no element template for SHADOW", "no race template for race:veilborn", "personal templates, a set needs 3", "sqt:element_fire template id used twice", "sqt:bad_range count range", "sqt:no_species defeat needs a species slot", "sqt:boss_defeat defeat goals pick normal species"])
      expect(msgs.some((m) => m.includes(want)), want).toBe(true);
  });
});

describe("rolling a character's secret quests", () => {
  it("gives 1 element + 1 race + N personal quests that fit the character, same inputs same set", () => {
    for (const element of PLAYER_ELEMENTS)
      for (const race of RACE_DEFINITIONS) {
        const set = rollSecretQuests(R, seed("ab"), { element, raceId: race.id }, T, content);
        expect(SecretQuestSetSchema.safeParse(set).success).toBe(true);
        expect(set.generatorVersion).toBe(SECRET_QUEST_GENERATOR_VERSION);
        expect(set.quests.map((q) => q.kind)).toEqual(["element", "race", ...Array(R.provisional.secretQuests.value.personalCount).fill("personal")]);
        expect(T.find((t) => t.id === set.quests[0]!.templateId)!.element).toBe(element);
        expect(T.find((t) => t.id === set.quests[1]!.templateId)!.raceId).toBe(race.id);
        expect(new Set(set.quests.map((q) => q.id)).size).toBe(set.quests.length);
        for (const q of set.quests) {
          if (q.params.speciesId !== undefined) expect(content.species.has(q.params.speciesId)).toBe(true);
          if (q.params.mapId !== undefined) expect(content.maps.has(q.params.mapId)).toBe(true);
          if (q.params.itemId !== undefined) expect(content.items.get(q.params.itemId)?.kind).toBe("material");
          const t = T.find((x) => x.id === q.templateId)!;
          expect(q.params.count).toBeGreaterThanOrEqual(t.slots.count[0]);
          expect(q.params.count).toBeLessThanOrEqual(t.slots.count[1]);
          if (t.slots.species === "of_element") expect(content.species.get(q.params.speciesId!)!.allowedElements).toContain(q.params.element);
        }
        expect(rollSecretQuests(R, seed("ab"), { element, raceId: race.id }, T, content)).toEqual(set);
      }
  });

  it("does not depend on template order, takes bytes or hex alike, and different seeds give different sets", () => {
    const hex = seed("c7");
    const bytes = Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
    const set = rollSecretQuests(R, hex, who, T, content);
    expect(rollSecretQuests(R, bytes, who, [...T].reverse(), content)).toEqual(set);
    const many = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(rollSecretQuests(R, seed(i.toString(16).padStart(2, "0") + "9e"), who, T, content).quests)));
    expect(many.size).toBeGreaterThanOrEqual(28);
  });

  it("refuses a short or non-hex seed and a pool without the character's element", () => {
    expect(() => rollSecretQuests(R, "abcd", who, T, content)).toThrow(/128 bits/);
    expect(() => rollSecretQuests(R, "zz".repeat(32), who, T, content)).toThrow(/hex/);
    expect(() => rollSecretQuests(R, seed("ab"), who, T.filter((t) => t.element !== "FIRE"), content)).toThrow(/element FIRE/);
  });
});
