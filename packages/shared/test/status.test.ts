import { describe, expect, it } from "vitest";
import {
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  deriveStats,
  SkillDefinitionSchema,
  STATUS_DEFINITIONS,
  statsWithStatuses,
  statusChancePct,
  statusResistancePct,
  type ActiveStatus,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type KernelResult,
  type SkillDefinition,
  type StatusApplication,
} from "../src/index";
import { baseSetup, content, rules, speciesAtLevel } from "./fixtures";

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};

const meta = { version: 1, status: "draft" as const, example: true };
const strikeWith = (id: string, statuses: StatusApplication[]): SkillDefinition => ({
  id,
  ...meta,
  name: { th: id },
  kind: "active",
  ownerKind: "player",
  targetRule: "single_enemy",
  range: "melee",
  mpCost: 1,
  cooldown: 0,
  effectSequence: [{ kind: "damage", damageType: "physical", coefficient: 0.1, flat: 0, element: "NEUTRAL", statuses }],
  tags: [],
});
const selfBuff = (id: string, statuses: StatusApplication[]): SkillDefinition => ({
  ...strikeWith(id, []),
  targetRule: "self",
  effectSequence: [{ kind: "status", statuses }],
});

function world(skills: SkillDefinition[], over: (s: BattleSetup) => void = () => {}) {
  const c = content();
  for (const s of skills) c.skills.set(s.id, s);
  const setup = baseSetup();
  setup.player.skillIds = skills.map((s) => s.id);
  // Hit +100 cancels any resistance, so a 100% skill always lands.
  setup.player.gear = { PATK: 70, ACCURACY_PCT: 100, EFFECT_HIT_PCT: 100 };
  setup.enemies = [{ unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 }];
  over(setup);
  let s: BattleState = ok(createBattle(rules, c, setup)).state;
  return { c, get s() { return s; }, set s(v) { s = v; } };
}

/** Plays enemy turns away until the player is up (enemy turns resolve inside the kernel). */
function playerTurn(c: ReturnType<typeof content>, s: BattleState): BattleState {
  for (let i = 0; i < 50 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
  return s;
}

const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe("status chance (Nut 2026-10-04)", () => {
  it("effect hit offsets resistance but never lifts the chance above the skill's own", () => {
    expect(statusChancePct(60, 20, 30)).toBeCloseTo(54, 9); // chapter 03 §6 example
    expect(statusChancePct(60, 50, 30)).toBe(60);
    expect(statusChancePct(100, 0, 10)).toBe(90); // even a 100% skill is resisted
    expect(statusChancePct(100, 10, 10)).toBe(100);
    expect(statusChancePct(40, 0, 150)).toBe(0);
  });

  it("the stat that resists a status adds to effect resistance; stat-downs use effect resistance only", () => {
    const stats = deriveStats(10, { STR: 10, VIT: 50, INT: 10, DEX: 10, AGI: 10, SPI: 10 }, { EFFECT_RES_PCT: 5 });
    const primary = { STR: 10, VIT: 50, INT: 10, DEX: 10, AGI: 10, SPI: 10 };
    expect(statusResistancePct(rules, STATUS_DEFINITIONS.stun, stats, primary)).toBe(15);
    expect(statusResistancePct(rules, STATUS_DEFINITIONS.sleep, stats, primary)).toBe(7);
    expect(statusResistancePct(rules, STATUS_DEFINITIONS.atk_down, stats, primary)).toBe(5);
  });

  it("ups and downs of one stat add up, then stay within the cap", () => {
    const base = deriveStats(10, { STR: 30, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 });
    const st = (statusId: ActiveStatus["statusId"], stacks = 1): ActiveStatus => ({ statusId, sourceId: null, turnsLeft: 2, stacks, fresh: false });
    expect(statsWithStatuses(rules, base, [st("atk_up"), st("atk_down")]).patk).toBe(base.patk);
    expect(statsWithStatuses(rules, base, [st("atk_down"), st("burn")]).patk).toBe(Math.floor((base.patk * 70) / 100));
    expect(statsWithStatuses(rules, base, [st("atk_down", 4)]).patk).toBe(Math.floor((base.patk * 50) / 100));
    expect(statsWithStatuses(rules, base, [st("blind")]).accuracyPct).toBe(base.accuracyPct - 30);
    expect(statsWithStatuses(rules, base, [st("res_up")]).effectResPct).toBe(20);
  });

  it("skill data cannot put a harmful status on an ally or a buff on an enemy", () => {
    expect(SkillDefinitionSchema.safeParse(selfBuff("skill:x", [{ statusId: "stun", chancePct: 50, turns: 1 }])).success).toBe(false);
    expect(SkillDefinitionSchema.safeParse(strikeWith("skill:x", [{ statusId: "atk_up", chancePct: 50, turns: 1 }])).success).toBe(false);
    expect(SkillDefinitionSchema.safeParse(strikeWith("skill:x", [{ statusId: "stun", chancePct: 50, turns: 1, stacks: 2 }])).success).toBe(false);
    expect(SkillDefinitionSchema.safeParse(selfBuff("skill:x", [{ statusId: "atk_up", chancePct: 100, turns: 2 }])).success).toBe(true);
  });
});

describe("statuses in a fight", () => {
  it("a stunned enemy loses its next turn, then the stun runs out (no immunity turn)", () => {
    const w = world([strikeWith("skill:test_stun", [{ statusId: "stun", chancePct: 100, turns: 1 }])]);
    w.s = playerTurn(w.c, w.s);
    const r = ok(applyCommand(rules, w.c, w.s, { type: "skill", actorId: "player", skillId: "skill:test_stun", targetId: "e1" }, { source: "player" }));
    const changes = of(r.events, "StatusChanged");
    expect(changes[0]).toMatchObject({ unitId: "e1", statusId: "stun", change: "applied", turnsLeft: 1, chancePct: null });
    expect(of(r.events, "TurnSkipped")).toEqual([expect.objectContaining({ unitId: "e1", statusId: "stun" })]);
    expect(changes.at(-1)).toMatchObject({ unitId: "e1", statusId: "stun", change: "expired" });
    expect(r.state.units.find((u) => u.unitId === "e1")!.statuses).toEqual([]);
    // Stun again right away: it lands again, no immunity.
    const again = ok(applyCommand(rules, w.c, playerTurn(w.c, r.state), { type: "skill", actorId: "player", skillId: "skill:test_stun", targetId: "e1" }, { source: "player" }));
    expect(of(again.events, "TurnSkipped")).toHaveLength(1);
  });

  it("rolls the resisted chance and reports it; the resisting stat lowers it", () => {
    const w = world([strikeWith("skill:test_poison", [{ statusId: "poison", chancePct: 60, turns: 3 }])], (s) => {
      s.player.gear = { PATK: 70, ACCURACY_PCT: 100 };
    });
    w.s = playerTurn(w.c, w.s);
    const crab = w.s.units.find((u) => u.unitId === "e1")!;
    const r = ok(applyCommand(rules, w.c, w.s, { type: "skill", actorId: "player", skillId: "skill:test_poison", targetId: "e1" }, { source: "player" }));
    const ev = of(r.events, "StatusChanged")[0]!;
    expect(["applied", "resisted"]).toContain(ev.change);
    expect(ev.chancePct).toBeCloseTo(60 * (1 - (crab.primaryStats!.VIT * 0.2) / 100), 9);
  });

  it("poison ticks at the start of the poisoned unit's turn", () => {
    const w = world([strikeWith("skill:test_poison", [{ statusId: "poison", chancePct: 100, turns: 2 }])]);
    w.s = playerTurn(w.c, w.s);
    const r = ok(applyCommand(rules, w.c, w.s, { type: "skill", actorId: "player", skillId: "skill:test_poison", targetId: "e1" }, { source: "player" }));
    const crab = r.state.units.find((u) => u.unitId === "e1")!;
    const tick = of(r.events, "StatusTick")[0]!;
    expect(tick).toMatchObject({ unitId: "e1", statusId: "poison", hp: -Math.floor((crab.stats.maxHp * 5) / 100) });
  });

  it("bosses are immune to hard control but not to other statuses", () => {
    const boss = speciesAtLevel(content().species.get("species:armor_crab")!, "species:boss_crab", 5, "BOSS");
    const w = world([strikeWith("skill:test_stun", [{ statusId: "stun", chancePct: 100, turns: 1 }, { statusId: "def_down", chancePct: 100, turns: 2 }])]);
    w.c.species.set(boss.id, boss);
    const setup = baseSetup();
    setup.player.skillIds = ["skill:test_stun"];
    setup.player.gear = { PATK: 70, ACCURACY_PCT: 100, EFFECT_HIT_PCT: 100 };
    setup.enemies = [{ unitId: "b1", speciesId: boss.id, element: "EARTH", row: "front", slot: 0 }];
    const s = playerTurn(w.c, ok(createBattle(rules, w.c, setup)).state);
    const r = ok(applyCommand(rules, w.c, s, { type: "skill", actorId: "player", skillId: "skill:test_stun", targetId: "b1" }, { source: "player" }));
    const changes = of(r.events, "StatusChanged");
    expect(changes.map((e) => [e.statusId, e.change])).toEqual(expect.arrayContaining([["stun", "immune"], ["def_down", "applied"]]));
    expect(of(r.events, "TurnSkipped")).toEqual([]);
  });

  it("a buff put on during your own turn does not count that turn; it ends with the fight", () => {
    const w = world([selfBuff("skill:test_rally", [{ statusId: "atk_up", chancePct: 100, turns: 1 }])]);
    w.s = playerTurn(w.c, w.s);
    const r = ok(applyCommand(rules, w.c, w.s, { type: "skill", actorId: "player", skillId: "skill:test_rally", targetId: "player" }, { source: "player" }));
    const me = () => r.state.units.find((u) => u.unitId === "player")!;
    expect(me().statuses).toEqual([expect.objectContaining({ statusId: "atk_up", turnsLeft: 1 })]);
    let s = playerTurn(w.c, r.state);
    const hit = ok(applyCommand(rules, w.c, s, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" }));
    const ev = of(hit.events, "ActionResolved").find((e) => e.actorId === "player")!;
    if (ev.hit) expect(ev.breakdown!.base).toBeGreaterThan(0);
    expect(of(hit.events, "StatusChanged").find((e) => e.unitId === "player")).toMatchObject({ statusId: "atk_up", change: "expired" });
    s = hit.state;
    for (let i = 0; i < 300 && s.status === "active"; i++) s = ok(applyCommand(rules, w.c, s, chooseAutoCommand(s)!, { source: "auto" })).state;
    expect(s.units.every((u) => (u.statuses ?? []).length === 0)).toBe(true);
  });

  it("silence blocks MP skills; sleep ends when the sleeper is hit; fire thaws freeze", () => {
    const w = world([strikeWith("skill:test_hit", [])]);
    let s = playerTurn(w.c, w.s);
    const withStatus = (state: BattleState, unitId: string, statusId: ActiveStatus["statusId"]) => {
      const next = structuredClone(state);
      next.units.find((u) => u.unitId === unitId)!.statuses = [{ statusId, sourceId: null, turnsLeft: 3, stacks: 1, fresh: false }];
      return next;
    };
    const silenced = applyCommand(rules, w.c, withStatus(s, "player", "silence"), { type: "skill", actorId: "player", skillId: "skill:test_hit", targetId: "e1" }, { source: "player" });
    expect(silenced).toMatchObject({ ok: false, code: "SILENCED" });
    // Basic attacks still work while silenced.
    expect(applyCommand(rules, w.c, withStatus(s, "player", "silence"), { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" }).ok).toBe(true);
    s = withStatus(s, "e1", "sleep");
    const r = ok(applyCommand(rules, w.c, s, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" }));
    expect(of(r.events, "StatusChanged")[0]).toMatchObject({ unitId: "e1", statusId: "sleep", change: "removed" });
    expect(of(r.events, "TurnSkipped")).toEqual([]);
    // A neutral hit leaves freeze alone; a fire hit thaws it.
    const fire: SkillDefinition = { ...strikeWith("skill:test_fire", []), effectSequence: [{ kind: "damage", damageType: "physical", coefficient: 0.1, flat: 0, element: "FIRE" }] };
    w.c.skills.set(fire.id, fire);
    const frozen = withStatus(s, "e1", "freeze");
    frozen.units.find((u) => u.unitId === "player")!.skillIds.push(fire.id);
    const plain = ok(applyCommand(rules, w.c, frozen, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" }));
    expect(of(plain.events, "StatusChanged").some((e) => e.change === "removed")).toBe(false);
    const thawed = ok(applyCommand(rules, w.c, frozen, { type: "skill", actorId: "player", skillId: fire.id, targetId: "e1" }, { source: "player" }));
    expect(of(thawed.events, "StatusChanged")[0]).toMatchObject({ statusId: "freeze", change: "removed" });
  });
});
