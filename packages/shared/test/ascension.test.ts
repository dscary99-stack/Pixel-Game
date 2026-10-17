import { describe, expect, it } from "vitest";
import {
  ASCENSIONS,
  ASCENSION_PASSIVE_IDS,
  ASCENSION_TRIAL_BOSS_ID,
  RACE_DEFINITIONS,
  RACE_PASSIVES,
  RACE_TRIAL_GOALS,
  SkillDefinitionSchema,
  ascensionPassiveFor,
  ascensionPath,
  ascensionRefusal,
  ascensionView,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  playerKit,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type KernelResult,
  type RulesConfig,
} from "../src/index";
import { baseSetup, companion, content, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const asc = rules.provisional.ascension.value;
const withAscension = (patch: Record<string, number>): RulesConfig =>
  ({ ...rules, provisional: { ...rules.provisional, ascension: { ...rules.provisional.ascension, value: { ...asc, ...patch } } } }) as RulesConfig;

/** A fight where the enemies cannot fall or hurt anyone, so rounds can go by. */
function fight(ascensionId: string | undefined, over: Partial<BattleSetup> = {}, r: RulesConfig = rules): BattleState {
  const setup = baseSetup(over);
  if (ascensionId !== undefined) setup.player = { ...setup.player, ascensionId };
  const s = ok(createBattle(r, c, setup)).state;
  for (const u of s.units) {
    if (u.side !== "enemy") continue;
    u.stats = { ...u.stats, maxHp: 1_000_000, patk: 1, matk: 1 };
    u.hp = 1_000_000;
  }
  return s;
}
/** Let everyone but the player guard until it is the player's turn. */
function toPlayer(s: BattleState, r: RulesConfig = rules): { s: BattleState; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  for (let i = 0; i < 50 && s.status === "active" && currentActor(s)?.unitId !== "player"; i++) {
    const x = ok(applyCommand(r, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" }));
    events.push(...x.events);
    s = x.state;
  }
  return { s, events };
}
const player = (s: BattleState) => s.units.find((u) => u.unitId === "player")!;
const awakenEvents = (events: BattleEvent[]) => events.filter((e) => e.type === "AwakeningChanged");

describe("divine awakening content (chapter 02, P31)", () => {
  it("every race has an ascension with paths A and B, each with a valid evolved passive", () => {
    expect(ASCENSIONS.map((a) => a.raceId).sort()).toEqual(RACE_DEFINITIONS.map((d) => d.id).sort());
    for (const a of ASCENSIONS) {
      expect(a.paths.map((p) => p.key)).toEqual(["a", "b"]);
      for (const p of a.paths) {
        const sk = c.skills.get(p.passiveId);
        expect(sk, p.passiveId).toBeDefined();
        expect(SkillDefinitionSchema.safeParse(sk).success, p.passiveId).toBe(true);
        expect(sk!.tags).toContain("race");
        expect(ascensionPassiveFor(a.raceId, p.id)).toBe(p.passiveId);
        expect(ascensionPath(p.id)).toBe(p);
        expect(p.awakening.length).toBeGreaterThan(0);
      }
    }
    expect(ASCENSION_PASSIVE_IDS.size).toBe(16);
  });

  it("the evolved passive replaces the race passive, never next to it, and only for its own race", () => {
    const k = playerKit("class:guardian", "race:stonekin", null, {}, null, "ascend:stonekin:b");
    expect(k.passiveIds).toEqual(["skill:ascend_stonekin_b"]);
    expect(playerKit("class:guardian", "race:human", null, {}, null, "ascend:stonekin:b").passiveIds).toEqual([RACE_PASSIVES["race:human"]]);
    expect(playerKit("class:guardian", "race:human", null, {}, null, null).passiveIds).toEqual([RACE_PASSIVES["race:human"]]);
  });

  it("the trial needs Class3 and Lv200, for the character's own race, once", () => {
    const ready = { raceId: "race:sylvan", level: 200, class3Id: "class3:verdant_hierophant", ascensionId: null };
    expect(ascensionRefusal(rules, ready, "ascend:sylvan")).toBeNull();
    expect(ascensionRefusal(rules, ready, "ascend:human")).toBe("NOT_FOUND");
    expect(ascensionRefusal(rules, { ...ready, class3Id: null }, "ascend:sylvan")).toBe("NO_CLASS3");
    expect(ascensionRefusal(rules, { ...ready, level: 199 }, "ascend:sylvan")).toBe("LEVEL_TOO_LOW");
    expect(ascensionRefusal(rules, { ...ready, ascensionId: "ascend:sylvan:a" }, "ascend:sylvan")).toBe("ALREADY_ASCENDED");
    const v = ascensionView(rules, ready)!;
    expect(v).toMatchObject({ pathId: null, level: 200, trialStatPct: asc.trialStatPct, bossId: ASCENSION_TRIAL_BOSS_ID, cost: { coins: asc.coins }, switchCoins: asc.pathSwitchCoins, blocked: null });
    expect(v.ascension.paths.map((p) => p.passiveName)).toEqual(["ผลิบานนิรันดร์", "หนามพิทักษ์พฤกษา"]);
  });

  it("the trial boss gets the ascension stat %, only in a class trial", () => {
    const setup = baseSetup({ enemies: [], boss: { bossId: ASCENSION_TRIAL_BOSS_ID }, bag: {}, practice: true, classTrial: true, classTrialTier: "ascend" });
    expect(ok(createBattle(rules, c, setup)).state.enemyStatPct).toBe(asc.trialStatPct);
    expect(createBattle(rules, c, { ...setup, classTrial: undefined })).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
  });
});

describe("the awakening gauge in a fight (P31)", () => {
  it("starts at 0, only for an ascended character; an unknown path is refused", () => {
    expect(player(fight(undefined)).awakening).toBeUndefined();
    expect(player(fight("ascend:human:a")).awakening).toMatchObject({ pathId: "ascend:human:a", gauge: 0, used: false, turnsLeft: 0 });
    const bad = baseSetup();
    bad.player = { ...bad.player, ascensionId: "ascend:human:c" };
    expect(createBattle(rules, c, bad)).toMatchObject({ ok: false, code: "MISSING_REFERENCE" });
  });

  it("fills on an action that did something, at most the round cap, and not on guard", () => {
    let { s } = toPlayer(fight("ascend:human:a"));
    const guarded = ok(applyCommand(rules, c, s, { type: "guard", actorId: "player" }, { source: "player" }));
    expect(player(guarded.state).awakening!.gauge).toBe(0);
    s = toPlayer(guarded.state).s;
    // Keep attacking until a hit lands; each landed hit adds gainPerAction.
    let landed = 0;
    for (let i = 0; i < 12 && landed < 2; i++) {
      const r = ok(applyCommand(rules, c, s, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" }));
      const hit = r.events.some((e) => e.type === "ActionResolved" && (e.damage ?? 0) > 0);
      if (hit) landed += 1;
      expect(player(r.state).awakening!.gauge).toBe(landed * asc.gainPerAction);
      if (hit) expect(awakenEvents(r.events)).toMatchObject([{ change: "gauge", gauge: landed * asc.gainPerAction }]);
      s = toPlayer(r.state).s;
    }
    expect(landed).toBe(2);
    // A smaller round cap clips the gain.
    const capped = withAscension({ gainCapPerRound: 10 });
    let t = toPlayer(fight("ascend:human:a", {}, capped), capped).s;
    for (let i = 0; i < 12 && player(t).awakening!.gauge === 0; i++) {
      t = ok(applyCommand(capped, c, t, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" })).state;
      t = toPlayer(t, capped).s;
    }
    expect(player(t).awakening!.gauge).toBe(10);
  });

  it("awakening needs a full gauge, spends the action, puts the path up, lasts 3 own turns, once a fight", () => {
    let { s } = toPlayer(fight("ascend:sylvan:b", { companions: [] }));
    expect(applyCommand(rules, c, s, { type: "awaken", actorId: "player" }, { source: "player" })).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    player(s).awakening!.gauge = asc.gaugeMax;
    const r = ok(applyCommand(rules, c, s, { type: "awaken", actorId: "player" }, { source: "player" }));
    expect(awakenEvents(r.events)[0]).toMatchObject({ change: "awakened", turnsLeft: asc.awakenTurns, pathId: "ascend:sylvan:b" });
    expect(r.events.some((e) => e.type === "ActionResolved" && e.action === "awaken")).toBe(true);
    const me = player(r.state);
    expect(me.awakening).toMatchObject({ used: true, gauge: 0, turnsLeft: asc.awakenTurns });
    expect(me.statuses!.map((x) => x.statusId).sort()).toEqual(["def_up", "thorns"]);
    expect(me.statuses!.every((x) => x.turnsLeft === asc.awakenTurns)).toBe(true);
    s = toPlayer(r.state).s;
    // Once a fight, even with the gauge full again.
    player(s).awakening!.gauge = asc.gaugeMax;
    expect(applyCommand(rules, c, s, { type: "awaken", actorId: "player" }, { source: "player" })).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    // Three own turns later it ends.
    const ends: BattleEvent[] = [];
    for (let i = 0; i < asc.awakenTurns; i++) {
      const g = ok(applyCommand(rules, c, s, { type: "guard", actorId: "player" }, { source: "player" }));
      ends.push(...awakenEvents(g.events));
      s = toPlayer(g.state).s;
    }
    expect(ends).toMatchObject([{ change: "ended", turnsLeft: 0 }]);
    expect(player(s).awakening!.turnsLeft).toBe(0);
    // Used: no more gauge this fight.
    player(s).awakening!.gauge = 0;
    for (let i = 0; i < 4; i++) {
      s = ok(applyCommand(rules, c, s, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" })).state;
      s = toPlayer(s).s;
    }
    expect(player(s).awakening!.gauge).toBe(0);
  });

  it("a path that reaches the enemy rolls its statuses on every enemy", () => {
    const { s } = toPlayer(fight("ascend:stonekin:b"));
    player(s).awakening!.gauge = asc.gaugeMax;
    const r = ok(applyCommand(rules, c, s, { type: "awaken", actorId: "player" }, { source: "player" }));
    const tried = r.events.filter((e) => e.type === "StatusChanged" && e.statusId === "def_down").map((e) => (e as { unitId: string }).unitId);
    expect(tried.sort()).toEqual(["e1", "e2"]);
    expect(player(r.state).statuses!.some((x) => x.statusId === "atk_up")).toBe(true);
  });

  it("Auto awakens by the player's rule", () => {
    const { s } = toPlayer(fight("ascend:wildkin:a"));
    player(s).awakening!.gauge = asc.gaugeMax;
    expect(chooseAutoCommand(s, c, {}, rules)).toEqual({ type: "awaken", actorId: "player" });
    expect(chooseAutoCommand(s, c, { awaken: "never" }, rules)?.type).not.toBe("awaken");
    expect(chooseAutoCommand(s, c, { awaken: "strong" }, rules)?.type).not.toBe("awaken");
    expect(chooseAutoCommand(s, c, { awaken: "low_hp" }, rules)?.type).not.toBe("awaken");
    player(s).hp = 1;
    expect(chooseAutoCommand(s, c, { awaken: "low_hp" }, rules)).toEqual({ type: "awaken", actorId: "player" });
    s.units.find((u) => u.unitId === "e1")!.rank = "ELITE";
    expect(chooseAutoCommand(s, c, { awaken: "strong" }, rules)).toEqual({ type: "awaken", actorId: "player" });
    player(s).awakening!.gauge = asc.gaugeMax - 1;
    expect(chooseAutoCommand(s, c, {}, rules)?.type).not.toBe("awaken");
  });

  it("Stonekin's evolved passive fires on guard (the new guarded event)", () => {
    const setup = baseSetup();
    setup.player = { ...setup.player, passiveIds: ["skill:ascend_stonekin_a"], ascensionId: "ascend:stonekin:a" };
    let s = ok(createBattle(rules, c, setup)).state;
    s = toPlayer(s).s;
    const r = ok(applyCommand(rules, c, s, { type: "guard", actorId: "player" }, { source: "player" }));
    expect(r.events.some((e) => e.type === "PassiveTriggered" && e.sourceId === "skill:ascend_stonekin_a" && e.on === "guarded")).toBe(true);
    expect(player(r.state).statuses!.some((x) => x.statusId === "def_up")).toBe(true);
  });
});

describe("race goals in the trial (chapter 02: passable with many classes)", () => {
  const trial = (raceId: string, over: Partial<BattleSetup> = {}) =>
    baseSetup({ enemies: [], boss: { bossId: ASCENSION_TRIAL_BOSS_ID }, bag: {}, practice: true, classTrial: true, classTrialTier: "ascend", raceTrial: { raceId }, ...over });
  /** Auto for both sides at a 100% boss (the fixture team is low level); the end state and every event. */
  const soft = withAscension({ trialStatPct: 100 });
  const run = (setup: BattleSetup, steps: number) => {
    let s = ok(createBattle(soft, c, setup)).state;
    const events: BattleEvent[] = [];
    for (let i = 0; i < steps && s.status === "active"; i++) {
      const actor = currentActor(s)!;
      const x = ok(applyCommand(soft, c, s, chooseAutoCommand(s, c, {}, soft) ?? { type: "guard", actorId: actor.unitId }, { source: "auto" }));
      events.push(...x.events);
      s = x.state;
    }
    return { s, events };
  };

  it("every race has a goal; it belongs to the divine awakening trial only", () => {
    for (const r of RACE_DEFINITIONS) expect(RACE_TRIAL_GOALS[r.id]?.need, r.id).toBeGreaterThan(0);
    expect(ok(createBattle(rules, c, trial("race:sylvan"))).state.raceTrial).toEqual({ raceId: "race:sylvan", kind: "heals", need: RACE_TRIAL_GOALS["race:sylvan"]!.need, count: 0 });
    expect(createBattle(rules, c, trial("race:nope"))).toMatchObject({ ok: false, code: "MISSING_REFERENCE" });
    expect(createBattle(rules, c, trial("race:human", { classTrialTier: 3 }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(createBattle(rules, c, baseSetup({ raceTrial: { raceId: "race:human" } }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(ascensionView(rules, { raceId: "race:wildkin", level: 200, class3Id: "class3:x", ascensionId: null })?.goal).toEqual(RACE_TRIAL_GOALS["race:wildkin"]);
  });

  it("the whole team counts: hits are every ally hit on an enemy, skills one per turn however many targets", () => {
    const hits = run(trial("race:skyborn"), 120);
    const side = (id: string | null) => hits.s.units.find((u) => u.unitId === id)?.side;
    const expected = hits.events.filter((e) => e.type === "ActionResolved" && e.hit === true && side(e.actorId) === "ally" && side(e.targetId) === "enemy").length;
    expect(expected).toBeGreaterThan(0);
    expect(hits.s.raceTrial!.count).toBe(expected);

    const skills = run(trial("race:runeborn"), 120);
    let turns = 0;
    let counted = false;
    for (const e of skills.events) {
      if (e.type === "TurnStarted") counted = false;
      if (e.type === "ActionResolved" && e.action === "skill" && skills.s.units.find((u) => u.unitId === e.actorId)?.side === "ally" && !counted) {
        counted = true;
        turns += 1;
      }
    }
    expect(turns).toBeGreaterThan(0);
    expect(skills.s.raceTrial!.count).toBe(turns);
    const used = skills.events.filter((e) => e.type === "ActionResolved" && e.action === "skill" && skills.s.units.find((u) => u.unitId === e.actorId)?.side === "ally").length;
    expect(used).toBeGreaterThanOrEqual(turns);
  });

  it("every goal moves in an Auto trial with a mixed team", () => {
    for (const raceId of Object.keys(RACE_TRIAL_GOALS)) {
      const team = (["species:armor_crab", "species:lantern_snail", "species:bell_bird"] as const).map((sp, i) => ({
        instance: companion(`m${i}`, sp, c.species.get(sp)!.allowedElements[0]!, 30),
        row: (i === 0 ? "front" : "back") as "front" | "back",
        slot: i === 0 ? 0 : i,
      }));
      const setup = trial(raceId, { companions: team });
      const { s } = run(setup, 300);
      expect(s.raceTrial!.count, raceId).toBeGreaterThan(0);
    }
  });
});
