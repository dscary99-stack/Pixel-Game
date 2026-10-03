import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MAPS,
  MapChannel,
  PRODUCTION_RULES,
  exampleMapRegistry,
  findPath,
  isWalkable,
  stepCostMs,
  tryStep,
  validateMaps,
  type Direction,
  type MapDefinition,
  type WorldServerMessage,
} from "../src";

const rules = PRODUCTION_RULES;
const maps = exampleMapRegistry();
const town = maps.get("map:dawn_town")!;
const STEP = rules.provisional.walkStepMs.value;
const BURST = rules.provisional.moveBurstMs.value;

const tiny: MapDefinition = {
  id: "map:tiny",
  version: 1,
  status: "draft",
  example: true,
  name: { th: "ทดสอบ" },
  kind: "field",
  // The wall at (2,1) makes every diagonal around it a corner cut.
  tiles: ["#####", "#.#.#", "#...#", "#####"],
  spawn: { x: 1, y: 1 },
  portals: [],
  spawns: [],
};

describe("map registry", () => {
  it("example maps validate: rectangular, known tiles, portals land on open tiles of existing maps", () => {
    expect(validateMaps(EXAMPLE_MAPS)).toEqual([]);
  });

  it("catches broken maps", () => {
    const bad: MapDefinition = {
      ...tiny,
      tiles: ["#####", "#.#.", "#.?.#", "#####"],
      spawn: { x: 2, y: 1 },
      portals: [{ at: { x: 0, y: 0 }, to: { mapId: "map:nowhere", x: 1, y: 1 }, label: "x" }],
    };
    const messages = validateMaps([bad]).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "row 1 has width 4, expected 5",
        'unknown tile "?" at 2,2',
        "spawn is not walkable",
        "portal at 0,0 is not walkable",
        "portal to unknown map map:nowhere",
      ]),
    );
  });
});

describe("tryStep (server movement check)", () => {
  it("moves one tile onto walkable ground", () => {
    expect(tryStep(rules, tiny, { x: 1, y: 1 }, "S", 0, 0)).toEqual({ ok: true, pos: { x: 1, y: 2 }, readyAt: STEP });
  });

  it("blocks walls, water, trees and the map edge", () => {
    expect(tryStep(rules, tiny, { x: 1, y: 1 }, "E", 0, 0)).toEqual({ ok: false, reason: "BLOCKED" });
    expect(tryStep(rules, tiny, { x: 1, y: 1 }, "N", 0, 0)).toEqual({ ok: false, reason: "BLOCKED" });
    // Town water at (2,10).
    expect(isWalkable(town, 2, 10)).toBe(false);
    expect(tryStep(rules, town, { x: 2, y: 9 }, "S", 0, 0)).toEqual({ ok: false, reason: "BLOCKED" });
  });

  it("refuses diagonals that cut a corner", () => {
    // (2,2) -> NE lands on open (3,1) but squeezes past the wall at (2,1).
    expect(tryStep(rules, tiny, { x: 2, y: 2 }, "NE", 0, 0)).toEqual({ ok: false, reason: "CORNER_BLOCKED" });
    expect(tryStep(rules, tiny, { x: 1, y: 1 }, "SE", 0, 0)).toEqual({ ok: false, reason: "CORNER_BLOCKED" });
  });

  it("charges sqrt(2) for a diagonal", () => {
    expect(stepCostMs(rules, "NE")).toBe(Math.round(STEP * 1.4142));
  });

  it("never lets steps average faster than the walk speed", () => {
    // A speed hack sends 40 steps as fast as it can, all at the same server time.
    let pos = { x: 1, y: 7 };
    let readyAt = 0;
    let accepted = 0;
    for (let i = 0; i < 40; i++) {
      const r = tryStep(rules, town, pos, "E", readyAt, 0);
      if (!r.ok) continue;
      pos = r.pos;
      readyAt = r.readyAt;
      accepted++;
    }
    // Only the burst allowance: (BURST / STEP) + the first step.
    expect(accepted).toBe(BURST / STEP + 1);
  });

  it("accepts an honest client walking at speed for a long time, with network jitter", () => {
    let pos = { x: 1, y: 7 };
    let readyAt = 0;
    const dirs: Direction[] = ["E", "W"];
    for (let i = 0; i < 400; i++) {
      // Client sends every STEP ms; arrival jitters by up to ±100 ms.
      const now = i * STEP + ((i * 37) % 200) - 100;
      const r = tryStep(rules, town, pos, dirs[i % 2]!, readyAt, Math.max(0, now));
      expect(r.ok, `step ${i}`).toBe(true);
      if (r.ok) {
        pos = r.pos;
        readyAt = r.readyAt;
      }
    }
  });

  it("does not bank extra steps by standing still", () => {
    // Idle for a minute, then a burst: still only the same allowance as a fresh start.
    let pos = { x: 1, y: 7 };
    let readyAt = 1000;
    let accepted = 0;
    for (let i = 0; i < 40; i++) {
      const r = tryStep(rules, town, pos, "E", readyAt, 61_000);
      if (!r.ok) continue;
      ({ pos, readyAt } = r);
      accepted++;
    }
    expect(accepted).toBe(BURST / STEP + 1);
  });
});

describe("findPath (tap to move)", () => {
  it("routes around obstacles with the same corner rule", () => {
    const path = findPath(tiny, { x: 1, y: 1 }, { x: 3, y: 1 })!;
    expect(path).not.toBeNull();
    let pos = { x: 1, y: 1 };
    let readyAt = 0;
    for (const d of path) {
      const r = tryStep(rules, tiny, pos, d, readyAt, readyAt);
      expect(r.ok).toBe(true);
      if (r.ok) ({ pos, readyAt } = r);
    }
    expect(pos).toEqual({ x: 3, y: 1 });
  });

  it("returns null for blocked or unreachable targets", () => {
    expect(findPath(tiny, { x: 1, y: 1 }, { x: 2, y: 1 })).toBeNull();
    expect(findPath(town, { x: 12, y: 8 }, { x: 2, y: 10 })).toBeNull();
  });
});

describe("MapChannel (presence)", () => {
  const sids = () => {
    let n = 0;
    return () => `s${++n}`;
  };
  const msgs = (out: { to: string; msg: WorldServerMessage }[], to: string) => out.filter((o) => o.to === to).map((o) => o.msg);

  it("two players see each other join, move and leave", () => {
    const ch = new MapChannel(rules, town, 1, [], sids());
    const a = ch.join("acct:a", "A", town.spawn, 0);
    expect(a.ok && msgs(a.out, "self")[0]).toMatchObject({ t: "welcome", others: [] });
    const b = ch.join("acct:b", "B", { x: 10, y: 8 }, 0);
    if (!b.ok) throw new Error();
    expect(msgs(b.out, "self")[0]).toMatchObject({ t: "welcome", others: [{ sid: "s1", name: "A", x: 12, y: 8 }] });
    expect(msgs(b.out, "others")).toEqual([{ t: "joined", player: { sid: "s2", name: "B", x: 10, y: 8, facing: "S" } }]);

    const step = ch.handle("acct:a", { t: "step", seq: 1, dir: "N" }, 0);
    expect(msgs(step.out, "self")).toEqual([{ t: "ack", seq: 1, x: 12, y: 7 }]);
    expect(msgs(step.out, "others")).toEqual([{ t: "moved", sid: "s1", x: 12, y: 7, facing: "N" }]);

    expect(ch.leave("acct:a").out).toEqual([{ to: "others", msg: { t: "left", sid: "s1" } }]);
    expect(ch.size).toBe(1);
  });

  it("a second connection from the same account replaces the first instead of adding a player", () => {
    const ch = new MapChannel(rules, town, 1, [], sids());
    ch.join("acct:a", "A", town.spawn, 0);
    ch.handle("acct:a", { t: "step", seq: 1, dir: "W" }, 0);
    const again = ch.join("acct:a", "A", town.spawn, 1000);
    if (!again.ok) throw new Error();
    expect(again.replaced).toBe(true);
    expect(ch.size).toBe(1);
    // Keeps its live position (not the older saved one) and its public id; nobody sees a "joined".
    expect(msgs(again.out, "self")[0]).toMatchObject({ self: { sid: "s1", x: 11, y: 8 } });
    expect(msgs(again.out, "others")).toEqual([]);
  });

  it("corrects rejected steps with the authoritative position and ignores replayed seqs", () => {
    const ch = new MapChannel(rules, tiny, 1, [], sids());
    ch.join("acct:a", "A", tiny.spawn, 0);
    expect(ch.handle("acct:a", { t: "step", seq: 1, dir: "E" }, 0).out[0]!.msg).toEqual({ t: "correct", seq: 1, x: 1, y: 1, reason: "BLOCKED" });
    expect(ch.handle("acct:a", { t: "step", seq: 2, dir: "S" }, 0).kind).toBe("moved");
    expect(ch.handle("acct:a", { t: "step", seq: 2, dir: "E" }, 1000).out[0]!.msg).toMatchObject({ t: "correct", reason: "STALE_SEQ", x: 1, y: 2 });
  });

  it("rejects malformed input and players who have not joined", () => {
    const ch = new MapChannel(rules, town, 1, [], sids());
    expect(ch.handle("acct:a", { t: "step", seq: 1, dir: "E" }, 0).out[0]!.msg).toMatchObject({ code: "NOT_JOINED" });
    ch.join("acct:a", "A", town.spawn, 0);
    for (const bad of [{ t: "step", seq: 1, dir: "UP" }, { t: "step", seq: 0, dir: "E" }, { t: "teleport", x: 1, y: 1 }, "x", null]) {
      expect(ch.handle("acct:a", bad, 0).out[0]!.msg).toMatchObject({ code: "INVALID_MESSAGE" });
    }
  });

  it("reports the portal a step lands on", () => {
    const ch = new MapChannel(rules, town, 1, [], sids());
    ch.join("acct:a", "A", { x: 22, y: 7 }, 0);
    const r = ch.handle("acct:a", { t: "step", seq: 1, dir: "E" }, 0);
    expect(r.kind === "moved" && r.portal).toMatchObject({ to: { mapId: "map:dawn_field", x: 1, y: 7 } });
  });

  it("refuses new players beyond the channel capacity, but not a reconnect", () => {
    const ch = new MapChannel(rules, town, 1, [], sids());
    const cap = rules.provisional.channelCapacity.value;
    for (let i = 0; i < cap; i++) expect(ch.join(`acct:${i}`, `P${i}`, town.spawn, 0).ok).toBe(true);
    expect(ch.join("acct:late", "L", town.spawn, 0)).toMatchObject({ ok: false, code: "CHANNEL_FULL" });
    expect(ch.join("acct:0", "P0", town.spawn, 0).ok).toBe(true);
  });
});
