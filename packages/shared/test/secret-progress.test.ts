import { describe, expect, it } from "vitest";
import { createBattle, secretFightFacts, secretQuestCredit, type BattleState, type SecretFightFacts, type SecretQuest } from "../src";
import { baseSetup, companion, content, rules } from "./fixtures";

const c = content();
const isCapture = (id: string) => c.items.get(id)?.kind === "capture";

const start = (over: Parameters<typeof baseSetup>[0] = {}): BattleState => {
  const r = createBattle(rules, c, baseSetup(over));
  if (!r.ok) throw new Error(r.code);
  return r.state;
};

const facts = (over: Partial<SecretFightFacts> = {}): SecretFightFacts => ({
  won: true,
  round: 4,
  companions: [],
  characterHpPct: 60,
  itemsUsed: 0,
  knockedOut: false,
  defeated: [{ speciesId: "species:armor_crab", element: "EARTH" }],
  captured: [],
  ...over,
});
const quest = (goal: SecretQuest["goal"], params: SecretQuest["params"]): SecretQuest => ({ id: "sq:personal:t", kind: "personal", templateId: "sqt:personal_old_rival", goal, params });

describe("secretFightFacts (from the final server state)", () => {
  it("reads outcome, map, round, team, HP %, items, knockouts and what happened to each enemy", () => {
    const s = start({ mapId: "map:dawn_field", companions: [{ instance: { ...companion("m1", "species:lantern_snail", "WATER"), bond: 9999 }, row: "back", slot: 0 }] });
    const player = s.units.find((u) => u.kind === "player")!;
    player.hp = player.stats.maxHp / 4;
    s.units.find((u) => u.kind === "companion")!.fell = true;
    s.status = "victory";
    s.round = 6;
    s.consumed = { "item:small_potion": 1, "item:armor_crab_capture": 2 };
    s.resolutions = { e1: "captured", e2: "defeated" };
    const f = secretFightFacts(s, isCapture);
    expect(f).toMatchObject({
      won: true,
      mapId: "map:dawn_field",
      round: 6,
      companions: [{ element: "WATER", bondTier: rules.provisional.bondTierBonusPercent.value.length - 1 }],
      characterHpPct: 25,
      itemsUsed: 1,
      knockedOut: true,
      defeated: [{ speciesId: "species:ember_fox", element: "FIRE" }],
      captured: [{ speciesId: "species:armor_crab", element: "EARTH", elite: false }],
    });
    expect(f.towerFloor).toBeUndefined();
  });
});

describe("secretQuestCredit", () => {
  it("counts matching defeats and captures (species and element)", () => {
    const f = facts({ defeated: [{ speciesId: "species:armor_crab", element: "EARTH" }, { speciesId: "species:armor_crab", element: "WATER" }], captured: [{ speciesId: "species:armor_crab", element: "EARTH", elite: true }] });
    expect(secretQuestCredit(rules, quest("defeat", { count: 99, speciesId: "species:armor_crab" }), f)).toBe(2);
    expect(secretQuestCredit(rules, quest("defeat", { count: 99, speciesId: "species:armor_crab", element: "WATER" }), f)).toBe(1);
    expect(secretQuestCredit(rules, quest("capture", { count: 99, speciesId: "species:armor_crab" }), f)).toBe(1);
    expect(secretQuestCredit(rules, quest("elite_capture", { count: 99, speciesId: "species:armor_crab" }), f)).toBe(1);
    expect(secretQuestCredit(rules, quest("elite_capture", { count: 99, speciesId: "species:armor_crab" }), facts())).toBe(0);
  });

  it("only won fights count, and never past the count", () => {
    expect(secretQuestCredit(rules, quest("win", { count: 3 }), facts({ won: false }))).toBe(0);
    expect(secretQuestCredit(rules, quest("win", { count: 3 }), facts(), 2)).toBe(1);
    expect(secretQuestCredit(rules, quest("win", { count: 3 }), facts(), 3)).toBe(0);
    expect(secretQuestCredit(rules, quest("win", { count: 3, mapId: "map:dawn_field" }), facts({ mapId: "map:other" }))).toBe(0);
    expect(secretQuestCredit(rules, quest("win", { count: 3, mapId: "map:dawn_field" }), facts({ mapId: "map:dawn_field" }))).toBe(1);
  });

  it("every condition must hold: the rolled one and each `require`", () => {
    const team = (n: number, el: "FIRE" | "WATER" = "FIRE", bondTier = 0) => Array.from({ length: n }, () => ({ element: el, bondTier }));
    const win = (over: Partial<SecretQuest["params"]>, f: Partial<SecretFightFacts>) => secretQuestCredit(rules, quest("win", { count: 9, ...over }), facts(f));
    expect(win({ condition: "solo" }, {})).toBe(1);
    expect(win({ condition: "solo" }, { companions: team(1) })).toBe(0);
    expect(win({ require: ["no_items"] }, { itemsUsed: 1 })).toBe(0);
    expect(win({ require: ["full_team"] }, { companions: team(rules.confirmed.maxCompanions.value - 1) })).toBe(0);
    expect(win({ require: ["full_team"] }, { companions: team(rules.confirmed.maxCompanions.value) })).toBe(1);
    expect(win({ require: ["mono_element_team"] }, {})).toBe(0);
    expect(win({ require: ["mono_element_team"] }, { companions: [...team(2), ...team(1, "WATER")] })).toBe(0);
    expect(win({ require: ["mono_element_team"], element: "WATER" }, { companions: team(2) })).toBe(0);
    expect(win({ require: ["mono_element_team"], element: "WATER" }, { companions: team(2, "WATER") })).toBe(1);
    expect(win({ require: ["no_knockout"] }, { knockedOut: true })).toBe(0);
    expect(win({ require: ["within_rounds"], rounds: 3 }, { round: 4 })).toBe(0);
    expect(win({ require: ["within_rounds"], rounds: 4 }, { round: 4 })).toBe(1);
    expect(win({ require: ["low_hp_finish"], hpBelowPct: 10 }, { characterHpPct: 10 })).toBe(0);
    expect(win({ require: ["low_hp_finish"], hpBelowPct: 10 }, { characterHpPct: 9 })).toBe(1);
    expect(win({ require: ["bond_tier"], bondTier: 4 }, { companions: team(1, "FIRE", 3) })).toBe(0);
    expect(win({ require: ["bond_tier"], bondTier: 4 }, { companions: team(1, "FIRE", 4) })).toBe(1);
    expect(win({ condition: "solo", require: ["no_items", "within_rounds"], rounds: 5 }, { itemsUsed: 0, round: 6 })).toBe(0);
  });

  it("boss and tower goals; explore and deliver are never fight credit", () => {
    expect(secretQuestCredit(rules, quest("boss", { count: 9, speciesId: "species:boss_a" }), facts({ bossSpeciesId: "species:boss_a" }))).toBe(1);
    expect(secretQuestCredit(rules, quest("boss", { count: 9, speciesId: "species:boss_a" }), facts({ bossSpeciesId: "species:boss_b" }))).toBe(0);
    expect(secretQuestCredit(rules, quest("tower", { count: 1, floor: 60 }), facts({ towerFloor: 59 }))).toBe(0);
    expect(secretQuestCredit(rules, quest("tower", { count: 1, floor: 60 }), facts({ towerFloor: 61 }))).toBe(1);
    expect(secretQuestCredit(rules, quest("explore", { count: 9, mapId: "map:dawn_field" }), facts({ mapId: "map:dawn_field" }))).toBe(0);
    expect(secretQuestCredit(rules, quest("deliver", { count: 9, itemId: "item:crab_shell" }), facts())).toBe(0);
  });
});
