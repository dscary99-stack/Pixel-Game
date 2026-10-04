import { describe, expect, it } from "vitest";
import {
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  skillLevelCap,
  type ActiveStatus,
  type BattleEvent,
  type BattleState,
  type KernelResult,
  type RulesConfig,
} from "../src/index";
import { baseSetup, content, fixtureRules, rules as productionRules } from "./fixtures";

const withAi = (base: RulesConfig, skillChancePct: number): RulesConfig => {
  const r = structuredClone(base);
  (r.provisional.enemyAi as { value: { skillChancePct: number; healBelowHpPct: number } }).value = { skillChancePct, healBelowHpPct: 50 };
  (r.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];
  return r;
};

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const st = (statusId: ActiveStatus["statusId"]): ActiveStatus => ({ statusId, sourceId: null, turnsLeft: 3, stacks: 1, fresh: false });

/** One enemy of `speciesId`, optionally with only these skills; the player is up first. */
function duel(rules: RulesConfig, speciesId: string, skillIds?: string[]) {
  const c = content();
  const base = c.species.get(speciesId)!;
  const sp = skillIds === undefined ? base : { ...base, id: "species:t_wild", skillIds };
  c.species.set(sp.id, sp);
  const setup = baseSetup();
  setup.player.primaryStats = { STR: 35, VIT: 60, INT: 10, DEX: 17, AGI: 20, SPI: 10 };
  setup.enemies = [{ unitId: "e1", speciesId: sp.id, element: base.allowedElements[0]!, row: "front", slot: 0 }];
  let s = ok(createBattle(rules, c, setup)).state;
  for (let i = 0; i < 20 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
  /** The player guards; returns what the enemy did before the player is up again. */
  const enemyTurn = (state: BattleState) => {
    const r = ok(applyCommand(rules, c, state, { type: "guard", actorId: "player" }, { source: "player" }));
    return { r, acts: of(r.events, "ActionResolved").filter((e) => e.actorId === "e1") };
  };
  return { c, s, enemyTurn };
}
const edit = (s: BattleState, f: (e1: BattleState["units"][number]) => void) => {
  const next = structuredClone(s);
  f(next.units.find((u) => u.unitId === "e1")!);
  return next;
};

describe("wild enemies use their species' skills (P15 enemyAi)", () => {
  it("carry the species' active skills at the level cap their wild level allows", () => {
    const { s } = duel(productionRules, "species:armor_crab");
    const crab = s.units.find((u) => u.unitId === "e1")!;
    expect(crab.skillIds).toEqual(["skill:crab_take_hit", "skill:crab_shield_bash"]);
    expect(crab.skillLevels).toEqual({ "skill:crab_take_hit": skillLevelCap(productionRules, 6), "skill:crab_shield_bash": skillLevelCap(productionRules, 6) });
  });

  it("use a damage skill through the same checks as a player (MP spent); at 0% they only attack", () => {
    const always = duel(withAi(productionRules, 100), "species:armor_crab");
    const mp = always.s.units.find((u) => u.unitId === "e1")!.mp;
    const { r, acts } = always.enemyTurn(always.s);
    // Protect needs another ally to guard, so the bash is the only option.
    expect(acts[0]).toMatchObject({ action: "skill", skillId: "skill:crab_shield_bash", targetId: "player" });
    expect(r.state.units.find((u) => u.unitId === "e1")!.mp).toBe(mp - 6);
    const never = duel(withAi(productionRules, 0), "species:armor_crab");
    expect(never.enemyTurn(never.s).acts[0]).toMatchObject({ action: "attack" });
  });

  it("heal only when hurt below the line, and skip a buff the target already has", () => {
    const healer = duel(withAi(productionRules, 100), "species:supply_mole", ["skill:mole_light_heal"]);
    expect(healer.enemyTurn(healer.s).acts[0]).toMatchObject({ action: "attack" });
    const hurt = edit(healer.s, (e) => (e.hp = Math.floor(e.stats.maxHp / 4)));
    expect(healer.enemyTurn(hurt).acts[0]).toMatchObject({ action: "skill", skillId: "skill:mole_light_heal", targetId: "e1" });
    const haste = duel(withAi(productionRules, 100), "species:bell_bird", ["skill:bird_haste"]);
    expect(haste.enemyTurn(haste.s).acts[0]).toMatchObject({ action: "skill", skillId: "skill:bird_haste", targetId: "e1" });
    expect(haste.enemyTurn(edit(haste.s, (e) => (e.statuses = [st("spd_up")]))).acts[0]).toMatchObject({ action: "attack" });
  });

  it("disarmed, they still use a skill; disarmed and silenced, they guard", () => {
    const d = duel(withAi(productionRules, 0), "species:armor_crab");
    expect(d.enemyTurn(edit(d.s, (e) => (e.statuses = [st("disarm")]))).acts[0]).toMatchObject({ action: "skill", skillId: "skill:crab_shield_bash" });
    expect(d.enemyTurn(edit(d.s, (e) => (e.statuses = [st("disarm"), st("silence")]))).acts[0]).toMatchObject({ action: "guard" });
  });

  it("never pick a skill the validator would refuse: cooldown skills wait for the OPEN tick rule", () => {
    const prod = duel(withAi(productionRules, 100), "species:ember_fox", ["skill:fox_consume_mark"]);
    expect(prod.enemyTurn(prod.s).acts[0]).toMatchObject({ action: "attack" });
    const dev = duel(withAi(fixtureRules, 100), "species:ember_fox", ["skill:fox_consume_mark"]);
    expect(dev.enemyTurn(dev.s).acts[0]).toMatchObject({ action: "skill", skillId: "skill:fox_consume_mark" });
    const broke = duel(withAi(productionRules, 100), "species:armor_crab");
    expect(broke.enemyTurn(edit(broke.s, (e) => (e.mp = 0))).acts[0]).toMatchObject({ action: "attack" });
  });

  it("their statuses land on the player's side", () => {
    const fox = duel(withAi(productionRules, 100), "species:ember_fox", ["skill:fox_mark_bite"]);
    const { r } = fox.enemyTurn(fox.s);
    const changes = of(r.events, "StatusChanged").filter((e) => e.unitId === "player");
    expect(changes.map((e) => e.statusId)).toContain("mark");
  });
});
