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
  exampleSecretRewardRegistry,
  validateSecretRewards,
  EXAMPLE_SECRET_REWARDS,
  rollSecretQuests,
  validateSecretQuestTemplates,
  type SecretQuestTemplate,
} from "../src";

// The tower has 100 floors (Nut 2026-10-06); tower goals are checked against it.
const content = { ...exampleContentMaps(), maps: exampleMapRegistry(), frontierFloors: R.confirmed.frontierFloors.value, rewards: exampleSecretRewardRegistry() };
const seed = (s: string) => s.repeat(64).slice(0, 64);
const who = { element: "FIRE", raceId: "race:human" } as const;

describe("secret quest templates (EXAMPLE pool)", () => {
  it("parse, are marked EXAMPLE/draft and pass the content check", () => {
    for (const t of T) {
      expect(SecretQuestTemplateSchema.safeParse(t).success, t.id).toBe(true);
      expect(t).toMatchObject({ example: true, status: "draft" });
    }
    expect(validateSecretQuestTemplates(R, T, content)).toEqual([]);
    expect(T.filter((t) => t.kind === "personal").length).toBeGreaterThanOrEqual(20);
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
    for (const want of ["no element template for SHADOW", "no race template for race:veilborn", "personal templates, a set needs 7", "sqt:element_fire template id used twice", "sqt:bad_range count range", "sqt:no_species defeat needs a species slot", "sqt:boss_defeat defeat goals pick normal species"])
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

  it("v2 rolls challenge parameters inside their ranges from content", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const set = rollSecretQuests(R, seed(i.toString(16).padStart(2, "0") + "5a"), who, T, content);
      for (const q of set.quests) {
        const t = T.find((x) => x.id === q.templateId)!;
        seen.add(q.goal);
        for (const k of ["rounds", "hpBelowPct", "bondTier", "floor"] as const) {
          const r = t.slots[k];
          if (r === undefined) expect(q.params[k]).toBeUndefined();
          else {
            expect(q.params[k]).toBeGreaterThanOrEqual(r[0]);
            expect(q.params[k]).toBeLessThanOrEqual(r[1]);
          }
        }
        if (q.goal === "tower") expect(q.params.floor).toBeLessThanOrEqual(100);
        // Elite leaders come from the maps' ELITE spawns (the mole pack in the dawn field).
        if (q.goal === "elite_capture") expect(["species:bell_bird", "species:supply_mole"]).toContain(q.params.speciesId);
      }
    }
    for (const g of ["tower", "elite_capture", "boss", "win"]) expect(seen.has(g), g).toBe(true);
  });

  it("checks challenge slots: a numbered condition needs its slot, alone; tower floors fit the tower", () => {
    const base = T.find((t) => t.id === "sqt:personal_swift_end")!;
    const tower = T.find((t) => t.id === "sqt:personal_spire_climber")!;
    const bad: SecretQuestTemplate[] = [
      ...T,
      { ...base, id: "sqt:no_rounds", slots: { count: [1, 2], conditions: ["within_rounds"] } },
      { ...base, id: "sqt:two_conds", slots: { count: [1, 2], conditions: ["within_rounds", "solo"], rounds: [2, 3] } },
      { ...base, id: "sqt:stray_hp", slots: { count: [1, 2], hpBelowPct: [10, 20] } },
      { ...base, id: "sqt:bond_high", slots: { count: [1, 2], conditions: ["bond_tier"], bondTier: [3, 7] } },
      { ...tower, id: "sqt:too_high", slots: { count: [1, 1], floor: [90, 120] } },
      { ...base, id: "sqt:elite_wrong", goal: "capture", slots: { species: "elite_leader", count: [1, 1] } },
    ];
    const msgs = validateSecretQuestTemplates(R, bad, content).map((i) => `${i.templateId} ${i.message}`);
    for (const want of ["sqt:no_rounds within_rounds needs a rounds slot", "sqt:two_conds within_rounds must be the template's only condition", "sqt:stray_hp hpBelowPct slot without", "sqt:bond_high bond tier 7 is above the top tier 4", "sqt:too_high floor 120 is above the tower's 100 floors", "sqt:elite_wrong elite_capture goals (and only they)"])
      expect(msgs.some((m) => m.includes(want)), want).toBe(true);
    const { frontierFloors: _f, ...noTower } = content;
    expect(validateSecretQuestTemplates(R, T, noTower).map((i) => i.message)).toContain("tower goals need the tower's floor count");
  });

  it("a stored v1 set (3 personal quests, no challenge params) still parses as it was", () => {
    const v1 = {
      generatorVersion: 1,
      quests: [
        { id: "sq:element:element_fire", kind: "element", templateId: "sqt:element_fire", goal: "defeat", params: { count: 77, element: "FIRE", speciesId: "species:ember_fox" } },
        { id: "sq:race:race_human", kind: "race", templateId: "sqt:race_human", goal: "win", params: { count: 61, condition: "full_team" } },
        { id: "sq:personal:personal_offering", kind: "personal", templateId: "sqt:personal_offering", goal: "deliver", params: { count: 33, itemId: "item:mole_fur" } },
        { id: "sq:personal:personal_homecoming", kind: "personal", templateId: "sqt:personal_homecoming", goal: "explore", params: { count: 9, mapId: "map:dawn_town" } },
        { id: "sq:personal:personal_old_rival", kind: "personal", templateId: "sqt:personal_old_rival", goal: "defeat", params: { count: 101, speciesId: "species:armor_crab" } },
      ],
    };
    expect(SecretQuestSetSchema.parse(v1)).toEqual(v1);
    // v2 shape (challenge params, no rewards) parses as it was as well; a v3 set without rewards does not.
    const v2 = { generatorVersion: 2, quests: [...v1.quests.slice(0, 2), { id: "sq:personal:personal_spire_climber", kind: "personal", templateId: "sqt:personal_spire_climber", goal: "tower", params: { count: 1, floor: 44 } }] };
    expect(SecretQuestSetSchema.parse(v2)).toEqual(v2);
    expect(SecretQuestSetSchema.safeParse({ ...v2, generatorVersion: 3 }).success).toBe(false);
    expect(SECRET_QUEST_GENERATOR_VERSION).toBe(3);
  });

  it("refuses a short or non-hex seed and a pool without the character's element", () => {
    expect(() => rollSecretQuests(R, "abcd", who, T, content)).toThrow(/128 bits/);
    expect(() => rollSecretQuests(R, "zz".repeat(32), who, T, content)).toThrow(/hex/);
    expect(() => rollSecretQuests(R, seed("ab"), who, T.filter((t) => t.element !== "FIRE"), content)).toThrow(/element FIRE/);
  });
});

describe("v3: rewards and much harder quests (Nut 2026-10-06)", () => {
  const rewards = exampleSecretRewardRegistry();

  it("every quest carries rewards of its template's kinds: element gear, race fashion + title, personal one kind", () => {
    const kindsSeen = new Set<string>();
    for (const element of PLAYER_ELEMENTS)
      for (const race of RACE_DEFINITIONS) {
        const set = rollSecretQuests(R, seed("d3"), { element, raceId: race.id }, T, content);
        const given = new Set<string>();
        for (const q of set.quests) {
          const t = T.find((x) => x.id === q.templateId)!;
          const got = q.rewards!;
          if (t.reward.pick === "all") expect(got.map((r) => r.kind)).toEqual(t.reward.kinds);
          else expect(got).toHaveLength(1);
          if (q.kind === "element") expect(got.map((r) => r.kind)).toEqual(["gear"]);
          if (q.kind === "race") expect(got.map((r) => r.kind)).toEqual(["fashion", "title"]);
          for (const r of got) {
            kindsSeen.add(r.kind);
            expect(t.reward.kinds).toContain(r.kind);
            const def = rewards.get(r.rewardId)!;
            expect(def.kind).toBe(r.kind);
            if (def.kind === "companion") expect(def.innateOptions).toContain(r.innateId);
            else expect(r.innateId).toBeUndefined();
            // Within one set a reward is not given twice while the pool has unused ones.
            expect(given.has(r.rewardId), r.rewardId).toBe(false);
            given.add(r.rewardId);
          }
          if (t.slots.require !== undefined) expect(q.params.require).toEqual(t.slots.require);
        }
      }
    for (const k of ["title", "fashion", "companion", "gear"]) expect(kindsSeen.has(k), k).toBe(true);
  });

  it("rewards are personal: same seed same variants, another seed other variants", () => {
    const a = rollSecretQuests(R, seed("e1"), who, T, content);
    expect(rollSecretQuests(R, seed("e1"), who, T, content)).toEqual(a);
    const b = rollSecretQuests(R, seed("e2"), who, T, content);
    const va = a.quests.flatMap((q) => q.rewards!.map((r) => r.variantId));
    const vb = new Set(b.quests.flatMap((q) => q.rewards!.map((r) => r.variantId)));
    expect(va.filter((v) => vb.has(v))).toEqual([]);
  });

  it("are much harder: combined conditions, big counts, tower 80+ with a one-element team", () => {
    const personal = T.filter((t) => t.kind === "personal");
    expect(personal.filter((t) => (t.slots.require?.length ?? 0) >= 2).length).toBeGreaterThanOrEqual(10);
    const summit = T.find((t) => t.id === "sqt:personal_spire_summit")!;
    expect(summit.slots.floor![0]).toBeGreaterThanOrEqual(80);
    expect(summit.slots.require).toContain("mono_element_team");
    const swift = T.find((t) => t.id === "sqt:personal_swift_end")!;
    expect(swift.slots.require).toEqual(expect.arrayContaining(["solo", "no_items", "within_rounds"]));
    for (const t of T.filter((x) => x.goal === "defeat")) expect(t.slots.count[0], t.id).toBeGreaterThanOrEqual(200);
  });

  it("the reward pool is EXAMPLE, has every kind, and checks no-power rules", () => {
    for (const r of EXAMPLE_SECRET_REWARDS) expect(r).toMatchObject({ example: true, status: "draft" });
    expect(validateSecretRewards(content)).toEqual([]);
    const bad = new Map(rewards);
    bad.set("srw:companion_boss", { ...(rewards.get("srw:companion_gilded_mole") as Extract<(typeof EXAMPLE_SECRET_REWARDS)[number], { kind: "companion" }>), id: "srw:companion_boss", baseSpeciesId: "species:crystal_crab_lord", innateOptions: ["skill:lord_innate_last_stand"] });
    bad.set("srw:gear_ghost", { ...(rewards.get("srw:gear_oathblade") as Extract<(typeof EXAMPLE_SECRET_REWARDS)[number], { kind: "gear" }>), id: "srw:gear_ghost", baseEquipmentId: "equip:nothing_here" });
    const msgs = validateSecretRewards({ ...content, rewards: bad });
    for (const want of ["a unique monster is a NORMAL species variant", "innate skill:lord_innate_last_stand is not one a NORMAL species carries", "unknown equipment equip:nothing_here"])
      expect(msgs.some((m) => m.includes(want)), want).toBe(true);
    const noGear = new Map([...rewards].filter(([, r]) => r.kind !== "gear"));
    const tmsgs = validateSecretQuestTemplates(R, T, { ...content, rewards: noGear }).map((i) => `${i.templateId} ${i.message}`);
    expect(tmsgs.some((m) => m.includes("sqt:element_fire no gear reward in the pool"))).toBe(true);
    expect(tmsgs.some((m) => m.includes("* no gear reward in the pool"))).toBe(true);
  });

  it("checks required conditions: no repeats, not also rolled, solo never with full_team", () => {
    const base = T.find((t) => t.id === "sqt:personal_lone_wolf")!;
    const bad: SecretQuestTemplate[] = [
      ...T,
      { ...base, id: "sqt:twice", slots: { count: [1, 2], require: ["solo", "solo"] } },
      { ...base, id: "sqt:both", slots: { count: [1, 2], require: ["solo"], conditions: ["solo"] } },
      { ...base, id: "sqt:clash", slots: { count: [1, 2], require: ["solo", "full_team"] } },
      { ...base, id: "sqt:no_rounds_req", slots: { count: [1, 2], require: ["within_rounds", "solo"] } },
      { ...base, id: "sqt:bad_kind", reward: { kinds: ["title", "title"], pick: "one" } },
    ];
    const msgs = validateSecretQuestTemplates(R, bad, content).map((i) => `${i.templateId} ${i.message}`);
    for (const want of ["sqt:twice a required condition is listed twice", "sqt:both solo is both required and rolled", "sqt:clash solo and full_team cannot hold together", "sqt:no_rounds_req within_rounds needs a rounds slot", "sqt:bad_kind a reward kind is listed twice"])
      expect(msgs.some((m) => m.includes(want)), want).toBe(true);
  });
});
