import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MAPS,
  MapChannel,
  PRODUCTION_RULES,
  exampleMapRegistry,
  findPath,
  parsePlayerLook,
  isWalkable,
  otherChannels,
  takeMessageToken,
  type MessageBucket,
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

describe("town NPCs", () => {
  it("the village has a person for every town service, the tower gatekeeper included", () => {
    const services = new Set((town.npcs ?? []).flatMap((n) => n.services));
    for (const s of ["shop", "craft", "orders", "frontier", "rebirth", "skills", "equipment", "quests", "party", "team", "journal"] as const) expect(services.has(s)).toBe(true);
  });

  it("NPCs are markers: their tiles stay walkable and they never sit on a portal or the spawn", () => {
    for (const n of town.npcs ?? []) {
      expect(isWalkable(town, n.at.x, n.at.y)).toBe(true);
      expect(n.at).not.toEqual(town.spawn);
    }
  });

  it("catches misplaced NPCs", () => {
    const npc = { id: "npc:a", at: { x: 2, y: 1 }, name: { th: "ก" }, role: { th: "ร้าน" }, services: ["shop", "shop"] as const, line: { th: "สวัสดี" } };
    const bad: MapDefinition = { ...tiny, npcs: [{ ...npc, services: [...npc.services] }, { ...npc, at: { x: 2, y: 1 }, services: ["shop"] }] };
    const messages = validateMaps([bad]).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "only towns have service NPCs",
        "npc:a is duplicated",
        "npc:a shares a tile with another NPC",
        "npc:a is not on open ground",
        "npc:a lists a service twice",
      ]),
    );
    const onSpawn: MapDefinition = { ...tiny, kind: "town", npcs: [{ ...npc, at: { x: 1, y: 1 }, services: ["shop"] }] };
    expect(validateMaps([onSpawn]).map((i) => i.message)).toContain("npc:a stands on the spawn tile");
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

  it("others see a player's title and worn fashion from the look given at join; a bad look is dropped", () => {
    const ch = new MapChannel(rules, town, 1, [], sids());
    const look = { titleId: "title:first_steps", fashion: [{ layer: "aura", effect: "sparkle", color: "#f2d45c" }] };
    ch.join("acct:a", "A", town.spawn, 0, look);
    const b = ch.join("acct:b", "B", { x: 10, y: 8 }, 0);
    if (!b.ok) throw new Error();
    expect(msgs(b.out, "self")[0]).toMatchObject({ t: "welcome", others: [{ sid: "s1", name: "A", look }] });
    expect(msgs(b.out, "others")).toEqual([{ t: "joined", player: { sid: "s2", name: "B", x: 10, y: 8, facing: "S" } }]);
    // A reconnect without a look takes the old one off.
    const again = ch.join("acct:a", "A", town.spawn, 10);
    if (!again.ok) throw new Error();
    expect((msgs(again.out, "self")[0] as Extract<WorldServerMessage, { t: "welcome" }>).self.look).toBeUndefined();
    // ... and the others are told at once; a reconnect with the same look tells nobody.
    expect(msgs(again.out, "others")).toEqual([{ t: "look", sid: "s1", look: null }]);
    const same = ch.join("acct:a", "A", town.spawn, 20);
    if (!same.ok) throw new Error();
    expect(msgs(same.out, "others")).toEqual([]);

    // A change while here (title or fashion set in town): everyone, the player too, sees it now.
    const changed = ch.setLook("acct:a", look);
    expect(changed.out).toEqual([
      { to: "self", msg: { t: "look", sid: "s1", look } },
      { to: "others", msg: { t: "look", sid: "s1", look } },
    ]);
    expect(changed.presence?.look).toEqual(look);
    expect(ch.setLook("acct:a", look).out).toEqual([]);
    expect(ch.setLook("acct:nobody", look)).toEqual({ presence: null, out: [] });
    expect(ch.setLook("acct:a", undefined).out[1]).toEqual({ to: "others", msg: { t: "look", sid: "s1", look: null } });

    expect(parsePlayerLook(JSON.stringify(look))).toEqual(look);
    expect(parsePlayerLook("{}")).toBeUndefined();
    expect(parsePlayerLook("not json")).toBeUndefined();
    expect(parsePlayerLook(null)).toBeUndefined();
    expect(
      parsePlayerLook(
        JSON.stringify({
          titleId: "Title <b>",
          fashion: [
            { layer: "aura", effect: "sparkle", color: "#f2d45c" },
            { layer: "aura", effect: "flame", color: "#e0603a" },
            { layer: "cape", effect: "flame", color: "#e0603a" },
            { layer: "head", effect: "leaf", color: "red" },
          ],
        }),
      ),
    ).toEqual({ fashion: [{ layer: "aura", effect: "sparkle", color: "#f2d45c" }] });
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
    expect(ch.hasRoom("acct:late")).toBe(false);
    expect(ch.hasRoom("acct:0")).toBe(true);
  });

  it("a full channel tries the other channels of the map, wrapping round, never itself", () => {
    const three = { ...rules, provisional: { ...rules.provisional, channelsPerMap: { ...rules.provisional.channelsPerMap, value: 3 } } } as unknown as typeof rules;
    expect(otherChannels(three, 1)).toEqual([2, 3]);
    expect(otherChannels(three, 2)).toEqual([3, 1]);
    expect(otherChannels(three, 3)).toEqual([1, 2]);
    expect(otherChannels(rules, 1)).toEqual([2]);
  });
});

describe("message budget (P11 wsMessageBudget)", () => {
  const { perSecond, burst } = PRODUCTION_RULES.provisional.wsMessageBudget.value;
  it("lets a burst through, drops the rest with one warning, and refills over time", () => {
    let b: MessageBucket | undefined;
    let ok = 0;
    let warns = 0;
    for (let i = 0; i < burst + 10; i++) {
      const r = takeMessageToken(PRODUCTION_RULES, b, 1000);
      b = r.bucket;
      if (r.ok) ok++;
      if (r.warn) warns++;
    }
    expect(ok).toBe(burst);
    expect(warns).toBe(1);
    // One second later: `perSecond` more, and a new run of drops warns again.
    ok = 0;
    warns = 0;
    for (let i = 0; i < perSecond + 5; i++) {
      const r = takeMessageToken(PRODUCTION_RULES, b, 2000);
      b = r.bucket;
      if (r.ok) ok++;
      if (r.warn) warns++;
    }
    expect(ok).toBe(perSecond);
    expect(warns).toBe(1);
  });

  it("honest walking never runs out", () => {
    let b: MessageBucket | undefined;
    for (let t = 0; t < 60_000; t += 250) {
      const r = takeMessageToken(PRODUCTION_RULES, b, t);
      expect(r.ok).toBe(true);
      b = r.bucket;
    }
  });
});
