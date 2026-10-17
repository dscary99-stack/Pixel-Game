/**
 * Multi-hit and bounce damage (Nut 2026-10-09 item 5): a multi-hit effect strikes its target again with
 * its own rolls, statuses only on the first hit, and stops when the target falls; a bounce jumps from the
 * chosen target to enemies not hit yet, server-picked, weaker each jump.
 */
import { describe, expect, it } from "vitest";
import { SkillDefinitionSchema, applyCommand, createBattle, currentActor, skillValue, strikesWorth, type BattleEvent, type BattleState, type KernelResult, type SkillDefinition } from "../src/index";
import { baseSetup, content, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const sk = (id: string) => c.skills.get(id)!;
const three = [
  { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH" as const, row: "front" as const, slot: 0 },
  { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE" as const, row: "front" as const, slot: 1 },
  { unitId: "e3", speciesId: "species:lantern_snail", element: "WATER" as const, row: "back" as const, slot: 0 },
];

function cast(skillId: string, seed: string, over: { hp?: number; target?: string } = {}): { events: BattleEvent[]; state: BattleState } {
  const setup = baseSetup({ battleId: `battle:mh:${skillId}:${seed}`, seed, enemies: three });
  setup.player = { ...setup.player, skillIds: [skillId], mp: 200, primaryStats: { ...setup.player.primaryStats, INT: 40, DEX: 60 } };
  let s: BattleState = ok(createBattle(rules, c, setup)).state;
  for (let i = 0; i < 30 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
  if (over.hp !== undefined) for (const u of s.units) if (u.side === "enemy") u.hp = over.hp;
  return ok(applyCommand(rules, c, s, { type: "skill", actorId: "player", skillId, targetId: over.target ?? "e2" }, { source: "player" }));
}
const strikes = (events: BattleEvent[], skillId: string) => events.filter((e): e is Extract<BattleEvent, { type: "ActionResolved" }> => e.type === "ActionResolved" && e.actorId === "player" && e.skillId === skillId && (e.targetId ?? "").startsWith("e"));

describe("multi-hit", () => {
  const id = "skill:c2_beast_marshal_maul";

  it("strikes the same target its number of times, each with its own roll", () => {
    expect(sk(id).effectSequence[0]).toMatchObject({ kind: "damage", hits: 3 });
    const r = cast(id, "s1", { hp: 99999 });
    const hits = strikes(r.events, id);
    expect(hits.map((h) => h.targetId)).toEqual(["e2", "e2", "e2"]);
  });

  it("tries its statuses on the first hit only", () => {
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const r = cast(id, seed, { hp: 99999 });
      const tries = r.events.filter((e) => e.type === "StatusChanged" && e.unitId === "e2" && e.statusId === "vulnerable");
      expect(tries.length).toBeLessThanOrEqual(1);
    }
  });

  it("stops when the target falls", () => {
    const r = cast(id, "s1", { hp: 1 });
    const hits = strikes(r.events, id);
    const landed = hits.findIndex((h) => h.hit);
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(hits).toHaveLength(landed + 1);
    expect(r.state.units.find((u) => u.unitId === "e2")!.ko).toBe(true);
  });
});

describe("bounce", () => {
  const id = "skill:c2_elementalist_thunder";

  it("jumps from the chosen target to each other enemy once, weaker each jump", () => {
    expect(sk(id).effectSequence[0]).toMatchObject({ kind: "damage", bounce: { jumps: 3, falloffPct: 25 } });
    const r = cast(id, "s1", { hp: 99999 });
    const hits = strikes(r.events, id);
    // Three enemies: the chosen one, then the two others (the third jump finds nobody new).
    expect(hits[0]!.targetId).toBe("e2");
    expect(new Set(hits.map((h) => h.targetId))).toEqual(new Set(["e1", "e2", "e3"]));
    expect(hits).toHaveLength(3);
    const coef = hits.filter((h) => h.hit && h.breakdown !== null).map((h) => h.breakdown!.base);
    for (let i = 1; i < coef.length; i++) expect(coef[i]!).toBeLessThan(coef[i - 1]!);
  });

  it("picks the jumps with the battle RNG: the same seed jumps the same way", () => {
    const order = (seed: string) => strikes(cast(id, seed, { hp: 99999 }).events, id).map((h) => h.targetId).join();
    expect(order("s7")).toBe(order("s7"));
  });

  it("with one enemy left there is nothing to jump to", () => {
    const setup = baseSetup({ battleId: "battle:mh:solo", enemies: [three[1]!] });
    setup.player = { ...setup.player, skillIds: [id], mp: 200 };
    let s = ok(createBattle(rules, c, setup)).state;
    for (let i = 0; i < 30 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
    s.units.find((u) => u.unitId === "e2")!.hp = 99999;
    const r = ok(applyCommand(rules, c, s, { type: "skill", actorId: "player", skillId: id, targetId: "e2" }, { source: "player" }));
    expect(strikes(r.events, id)).toHaveLength(1);
  });
});

describe("schema and budget", () => {
  const base = sk("skill:c2_elementalist_thunder");
  const first = base.effectSequence[0]! as Extract<SkillDefinition["effectSequence"][number], { kind: "damage" }>;
  it("refuses a bounce with multi-hit, a bounce on an area skill, and a bounce on a later effect", () => {
    expect(SkillDefinitionSchema.safeParse({ ...base, effectSequence: [{ ...first, hits: 2 }] }).success).toBe(false);
    expect(SkillDefinitionSchema.safeParse({ ...base, targetRule: "all_enemies" }).success).toBe(false);
    const { bounce: _b, ...plain } = first;
    expect(SkillDefinitionSchema.safeParse({ ...base, effectSequence: [plain, { ...plain, target: "all_enemies", bounce: { jumps: 1, falloffPct: 10 } }] }).success).toBe(false);
    expect(SkillDefinitionSchema.safeParse({ ...base, effectSequence: [{ ...plain, hits: 6 }] }).success).toBe(false);
  });

  it("values more strikes at what they add: all hits fully, bounces less and less", () => {
    expect(strikesWorth({ hits: 3 })).toBe(3);
    expect(strikesWorth({})).toBe(1);
    expect(strikesWorth({ bounce: { jumps: 2, falloffPct: 0 } })).toBeCloseTo(2.5, 6);
    expect(strikesWorth({ bounce: { jumps: 2, falloffPct: 50 } })).toBeCloseTo(1 + 0.75 * 0.5 + 0.75 * 0.25, 6);
    // A skill with no statuses and its strikes taken away is worth less by exactly that factor.
    const flask = sk("skill:alchemist_element_flask");
    const f0 = flask.effectSequence[0]! as typeof first;
    expect(f0.statuses).toBeUndefined();
    const { bounce: _f, ...flat } = f0;
    expect(skillValue(flask) / skillValue({ ...flask, effectSequence: [flat, ...flask.effectSequence.slice(1)] })).toBeGreaterThan(1.3);
    expect(skillValue({ ...flask, effectSequence: [f0] }) / skillValue({ ...flask, effectSequence: [flat] })).toBeCloseTo(strikesWorth(f0), 6);
  });
});
