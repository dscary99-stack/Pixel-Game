/** Capture v1 (O07 → P18, CAPTURE_DESIGN_O07_V1 §10 acceptance cases). */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_BOSSES,
  EXAMPLE_SPECIES,
  Rng,
  applyCommand,
  captureChance,
  captureCheck,
  createBattle,
  currentActor,
  validateCaptureContent,
  validateCaptureProfile,
  type ActiveStatus,
  type BattleEvent,
  type BattleState,
  type BattleUnit,
  type BossDefinition,
  type CaptureInput,
  type KernelResult,
  type RulesConfig,
} from "../src/index";
import { baseSetup, content, rules, speciesAtLevel, withCaptureProfile } from "./fixtures";

const P = rules.provisional.captureProfile.value;
const FOX = EXAMPLE_SPECIES.find((s) => s.id === "species:ember_fox")!;
const LORD_SPECIES = EXAMPLE_SPECIES.find((s) => s.id === "species:crystal_crab_lord")!;
const st = (statusId: ActiveStatus["statusId"], extra: Partial<ActiveStatus> = {}): ActiveStatus => ({ statusId, sourceId: null, turnsLeft: 2, stacks: 1, fresh: false, ...extra });
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-12);

type Target = CaptureInput["target"];
const target = (over: Partial<Target> = {}): Target => ({
  side: "enemy",
  hp: 100,
  stats: { maxHp: 100 } as BattleUnit["stats"],
  level: 8,
  rank: undefined as never,
  statuses: [],
  retired: false,
  ko: false,
  captureWindowOpen: true,
  speciesId: FOX.id,
  ...over,
});
const input = (over: Partial<CaptureInput> = {}): CaptureInput => ({
  source: "player",
  actor: { kind: "player", level: 20, statuses: [] },
  target: target(),
  species: FOX,
  item: { id: "item:ember_fox_capture", kind: "capture", captureSpeciesId: FOX.id },
  inBag: 1,
  ...over,
});
const chance = (t: Partial<Target>, sp = FOX) => captureChance(P, sp, target(t), 1);

describe("capture profile and content (validators)", () => {
  it("the shipped profile is v1: one formula, standard item only, mastery 1, no pity", () => {
    expect(rules.provisional.captureProfile).toMatchObject({ status: "PROVISIONAL", decision: "P18" });
    expect(P).toMatchObject({ version: "capture-v1", qualityFactors: { "1": 1 }, masteryFactor: 1, pity: false });
    expect(validateCaptureProfile(P)).toEqual([]);
    expect("captureRates" in rules.unresolved).toBe(false);
  });

  it("refuses a profile that lets lower HP lower the chance, bounds outside 0–1, or an unknown status", () => {
    expect(validateCaptureProfile({ ...P, hpFactor: [{ maxHpRatio: 0.25, factor: 1 }, { maxHpRatio: 1, factor: 2 }] })).not.toEqual([]);
    expect(validateCaptureProfile({ ...P, rankBounds: { ...P.rankBounds, BOSS: [0.5, 0.2] } })).not.toEqual([]);
    expect(validateCaptureProfile({ ...P, statusFactors: { nap: 2 } })).not.toEqual([]);
    expect(validateCaptureProfile({ ...P, qualityFactors: {} })).not.toEqual([]);
  });

  it("every example species has a base above 0 and a matching standard item (C08)", () => {
    const c = content();
    expect(EXAMPLE_SPECIES.length).toBeGreaterThanOrEqual(6);
    expect(validateCaptureContent(P, EXAMPLE_SPECIES, c.items)).toEqual([]);
    expect(validateCaptureContent(P, [{ ...FOX, captureBaseRate: 0 }], c.items)).toEqual([`${FOX.id}: captureBaseRate must be > 0`]);
  });
});

describe("capture chance (§10)", () => {
  it("HP 50%, 50%+ε, 25%, 25%+ε give 1.5, 1, 2, 1.5; 0 HP cannot be captured", () => {
    const at = (hp: number, max = 1000) => chance({ hp, stats: { maxHp: max } as BattleUnit["stats"] }).hpFactor;
    expect([at(500), at(501), at(250), at(251)]).toEqual([1.5, 1, 2, 1.5]);
    expect(captureCheck(rules, P, input({ target: target({ hp: 0 }) }))).toMatchObject({ ok: false, code: "INVALID_TARGET" });
  });

  it("fox base 20%, HP 25%, asleep → 50%", () => {
    const r = chance({ hp: 25, statuses: [st("sleep")] });
    expect(r).toMatchObject({ hpFactor: 2, statusId: "sleep", statusFactor: 1.25, capped: null });
    close(r.probability, 0.5);
  });

  it("sleep + paralyze with stacks is still 50%: only the best status counts; an expired one gives nothing", () => {
    close(chance({ hp: 25, statuses: [st("paralyze", { stacks: 3 }), st("sleep", { stacks: 2 })] }).probability, 0.5);
    const expired = chance({ hp: 25, statuses: [st("sleep", { turnsLeft: 0 })] });
    expect(expired.statusFactor).toBe(1);
    close(expired.probability, 0.4);
    expect(chance({ statuses: [st("poison"), st("burn")] }).statusFactor).toBe(1);
  });

  it("an Elite fox in the same state is 30%, from the unit's rank even though the species is NORMAL", () => {
    const r = chance({ hp: 25, statuses: [st("sleep")], rank: "ELITE" });
    expect(r.rank).toBe("ELITE");
    close(r.probability, 0.3);
  });

  it("a boss at base 10%, window open, HP 25%, no status → 20%", () => {
    close(chance({ hp: 25, speciesId: LORD_SPECIES.id }, LORD_SPECIES).probability, 0.2);
  });

  it("the rank bounds apply last and are reported", () => {
    const easy = { ...FOX, captureBaseRate: 0.6 };
    const hi = captureChance(P, easy, target({ hp: 10, statuses: [st("stun")] }), 1);
    expect(hi).toMatchObject({ probability: 0.9, capped: "max" });
    const lo = captureChance(P, { ...FOX, captureBaseRate: 0.01 }, target(), 1);
    expect(lo).toMatchObject({ probability: 0.05, capped: "min" });
  });
});

describe("capture eligibility comes before any chance (§10)", () => {
  it("player 20: wild 25 can be tried, wild 26 is refused and says Lv21 is needed", () => {
    expect(captureCheck(rules, P, input({ target: target({ level: 25 }) })).ok).toBe(true);
    expect(captureCheck(rules, P, input({ target: target({ level: 26 }) }))).toMatchObject({ ok: false, code: "LEVEL_INELIGIBLE", minPlayerLevel: 21 });
  });

  it("wrong species item, no item, a quality the profile does not accept, an empty bag", () => {
    expect(captureCheck(rules, P, input({ item: { id: "item:armor_crab_capture", kind: "capture", captureSpeciesId: "species:armor_crab" } }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(captureCheck(rules, P, input({ item: undefined }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(captureCheck(rules, P, input({ item: { id: "item:ember_fox_capture", kind: "capture", captureSpeciesId: FOX.id, captureQuality: 2 } }))).toMatchObject({ ok: false, code: "QUALITY_NOT_ENABLED" });
    expect(captureCheck(rules, P, input({ inBag: 0 }))).toMatchObject({ ok: false, code: "INSUFFICIENT_RESOURCE" });
  });

  it("berserk (no items) and Auto are refused; silence (MP skills only) does not stop a capture", () => {
    expect(captureCheck(rules, P, input({ actor: { kind: "player", level: 20, statuses: [st("berserk")] } }))).toMatchObject({ ok: false, code: "STATUS_BLOCKED" });
    expect(captureCheck(rules, P, input({ source: "auto" }))).toMatchObject({ ok: false, code: "AUTO_CAPTURE_FORBIDDEN" });
    expect(captureCheck(rules, P, input({ actor: { kind: "player", level: 20, statuses: [st("silence")] } })).ok).toBe(true);
  });

  it("a shut boss window refuses", () => {
    expect(captureCheck(rules, P, input({ target: target({ captureWindowOpen: false }) }))).toMatchObject({ ok: false, code: "NO_VALID_CAPTURE_WINDOW" });
  });
});

describe("capture in a fight (kernel, §10)", () => {
  const fox25 = speciesAtLevel(FOX, "species:fox_lv25", 25);
  const c = content([fox25]);
  c.items.set("item:fox_lv25_capture", { ...c.items.get("item:ember_fox_capture")!, id: "item:fox_lv25_capture" as never, captureSpeciesId: fox25.id });
  const fight = (r: RulesConfig, prep: (s: BattleState) => void = () => {}) => {
    const setup = baseSetup({ enemies: [{ unitId: "w", speciesId: fox25.id, element: "FIRE", row: "front", slot: 0 }], bag: { "item:fox_lv25_capture": 3 } });
    let s = ok(createBattle(r, c, setup)).state;
    for (let i = 0; i < 50 && currentActor(s)?.kind !== "player"; i++) s = ok(applyCommand(r, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
    s = structuredClone(s);
    prep(s);
    return s;
  };
  const capture = (r: RulesConfig, s: BattleState, itemId = "item:fox_lv25_capture") =>
    applyCommand(r, c, s, { type: "capture", actorId: "player", targetId: "w", itemId }, { source: "player" });
  const w = (s: BattleState) => s.units.find((u) => u.unitId === "w")!;

  it("a refusal spends nothing, takes no action and does not move the RNG", () => {
    const s = fight(rules);
    for (const itemId of ["item:ember_fox_capture", "item:nope_capture"]) {
      const r = capture(rules, s, itemId);
      expect(r.ok).toBe(false);
    }
    expect(s.bag["item:fox_lv25_capture"]).toBe(3);
    const berserk = fight(rules, (x) => (x.units.find((u) => u.unitId === "player")!.statuses = [st("berserk")]));
    const before = JSON.stringify(berserk);
    expect(capture(rules, berserk)).toMatchObject({ ok: false, code: "STATUS_BLOCKED" });
    expect(JSON.stringify(berserk)).toBe(before);
  });

  it("the roll succeeds when it is below p and fails when it equals p (roll < p)", () => {
    const s = fight(rules);
    // The capture is the command's first draw, so the next float of the fight's RNG is its roll.
    const roll = new Rng(s.rng).nextFloat();
    const at = (p: number) => withCaptureProfile(rules, { rankBounds: { NORMAL: [p, p], ELITE: [p, p], BOSS: [p, p] } });
    const run = (p: number) => {
      const t = structuredClone(s);
      t.captureProfile = at(p).provisional.captureProfile.value;
      return ok(capture(at(p), t)).events.find((e) => e.type === "CaptureResolved") as Extract<BattleEvent, { type: "CaptureResolved" }>;
    };
    expect(run(roll)).toMatchObject({ success: false, probability: roll });
    expect(run(roll + 1e-9).success).toBe(true);
  });

  it("success and failure both use one item and one action; only success gives EXP and the companion", () => {
    const always = withCaptureProfile(rules, { rankBounds: { NORMAL: [1, 1], ELITE: [1, 1], BOSS: [1, 1] } });
    const never = withCaptureProfile(rules, { rankBounds: { NORMAL: [0, 0], ELITE: [0, 0], BOSS: [0, 0] } });
    for (const [r, caught] of [
      [always, true],
      [never, false],
    ] as const) {
      const s = fight(r);
      const res = ok(capture(r, s));
      expect(res.state.bag["item:fox_lv25_capture"]).toBe(2);
      expect(res.events.filter((e) => e.type === "ItemConsumed")).toHaveLength(1);
      expect(res.events.filter((e) => e.type === "ActionResolved" && e.actorId === "player")).toHaveLength(1);
      expect(res.state.entitlements.filter((e) => e.kind === "capture")).toHaveLength(caught ? 1 : 0);
      if (caught) expect(res.state.entitlements[0]).toMatchObject({ level: 1, speciesId: fox25.id });
    }
  });

  it("a capture does no damage and does not wake a sleeping target", () => {
    const never = withCaptureProfile(rules, { rankBounds: { NORMAL: [0, 0], ELITE: [0, 0], BOSS: [0, 0] } });
    const s = fight(never, (x) => (w(x).statuses = [st("sleep", { turnsLeft: 3 })]));
    const hp = w(s).hp;
    const r = ok(capture(never, s));
    expect(w(r.state).hp).toBe(hp);
    expect(w(r.state).statuses!.some((x) => x.statusId === "sleep")).toBe(true);
  });

  it("the fight keeps the profile it started with when the rules change", () => {
    const s = fight(rules);
    expect(s.captureProfile?.version).toBe("capture-v1");
    const newer = withCaptureProfile(rules, { version: "capture-v2", rankBounds: { NORMAL: [1, 1], ELITE: [1, 1], BOSS: [1, 1] } });
    const r = ok(capture(newer, s));
    const res = r.events.find((e) => e.type === "CaptureResolved");
    expect(res).toMatchObject({ profileVersion: "capture-v1", probability: 0.2 });
    // A state saved before pinning uses the current profile.
    const old = structuredClone(s);
    delete old.captureProfile;
    expect(ok(capture(newer, old)).events.find((e) => e.type === "CaptureResolved")).toMatchObject({ profileVersion: "capture-v2", probability: 1 });
  });
});

describe("boss capture window (§10)", () => {
  const LORD = EXAMPLE_BOSSES[0]!;
  const r = structuredClone(rules);
  (r.provisional.enemyAi as { value: { skillChancePct: number; healBelowHpPct: number } }).value = { skillChancePct: 0, healBelowHpPct: 50 };
  const start = (def: BossDefinition = LORD) => {
    const c = content();
    c.bosses.set(def.id, def);
    const setup = baseSetup({ enemies: [], boss: { bossId: def.id } });
    setup.player.level = 200;
    setup.player.gear = { PDEF: 600, MDEF: 600, HP: 80_000, PATK: 10 };
    setup.bag = { ...setup.bag, "item:crystal_crab_lord_capture": 2 };
    return { c, s: ok(createBattle(r, c, setup)).state };
  };
  const e1 = (s: BattleState) => s.units.find((u) => u.unitId === "e1")!;
  const guard = (c: ReturnType<typeof start>["c"], s: BattleState) => ok(applyCommand(r, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;

  it("in the capture phase, HP 30% keeps it shut, 29% opens it, and a heal keeps it open while the HP factor changes", () => {
    const { c, s: s0 } = start();
    let s = structuredClone(s0);
    e1(s).hp = Math.floor(e1(s).stats.maxHp * 0.45); // phase 2 (below 50%)
    s = guard(c, s);
    expect(s.boss!.phase).toBe(1);
    s = structuredClone(s);
    e1(s).hp = Math.floor((e1(s).stats.maxHp * 30) / 100);
    expect((e1(s).hp * 100) / e1(s).stats.maxHp).toBe(30);
    for (let i = 0; i < 6 && currentActor(s)?.kind !== "player"; i++) s = guard(c, s);
    s = guard(c, s);
    expect(e1(s).captureWindowOpen).toBe(false);
    s = structuredClone(s);
    e1(s).hp = Math.floor(e1(s).stats.maxHp * 0.29);
    for (let i = 0; i < 6 && currentActor(s)?.kind !== "player"; i++) s = guard(c, s);
    s = guard(c, s);
    expect(e1(s).captureWindowOpen).toBe(true);
    const low = captureChance(P, LORD_SPECIES, e1(s), 1);
    s = structuredClone(s);
    e1(s).hp = e1(s).stats.maxHp; // healed back up
    s = guard(c, s);
    expect(e1(s).captureWindowOpen).toBe(true);
    const healed = captureChance(P, LORD_SPECIES, e1(s), 1);
    expect(low.hpFactor).toBeGreaterThan(healed.hpFactor);
    expect(healed.hpFactor).toBe(1);
  });

  it("a boss that is immune to sleep gets no sleep bonus (immunity unchanged)", () => {
    const sleepy: BossDefinition = { ...LORD, phases: [{ ...LORD.phases[0]!, onEnter: [{ statusId: "sleep", chancePct: 100, turns: 3 }] }, ...LORD.phases.slice(1)] };
    const { s } = start(sleepy);
    expect(e1(s).statuses!.some((x) => x.statusId === "sleep")).toBe(false);
    expect(captureChance(P, LORD_SPECIES, e1(s), 1).statusFactor).toBe(1);
  });
});
