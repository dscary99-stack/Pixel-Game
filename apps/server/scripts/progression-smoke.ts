// End-to-end EXP check against `wrangler dev`: fights give EXP to the character and the team,
// the level follows, and stat points are spent with a version check (not mid-fight).
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:progression`.
import { expProgress, unspentPoints, PRODUCTION_RULES as R } from "@pmrpg/shared";
import { api, approach, autoToEnd, battleCall, lastPacks, run, toField, type Client, type Msg, AUTO_GAP_MS, sleep } from "./smoke-lib";

const account = `acct:p${run}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const http = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const out: Record<string, unknown> = {};
const me = async () => (await http("GET", "/character")).body;

await http("POST", "/character", { operationId: `op_${run}`, name: "ทดสอบเลเวล", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
out.start = (({ level, xp }) => ({ level, xp }))((await me()).character);

/** Engage a pack at this spawn (fresh pack on rollover), run `inFight`, Auto to the end, come back. */
async function fight(c: Client, spawnId: string, inFight: (battleId: string) => Promise<void> = async () => undefined) {
  let enc: Msg = null;
  for (let i = 0; i < 4 && enc?.t !== "encounter"; i++) {
    const pack = lastPacks(c).find((p) => p.spawnId === spawnId) ?? lastPacks(c)[0];
    await approach(c, pack);
    const from = c.inbox.length;
    c.send({ t: "engage", packId: pack.packId });
    enc = await c.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
  }
  if (enc.t !== "encounter") throw new Error(JSON.stringify(enc));
  await inFight(enc.battleId);
  const view = await autoToEnd(account, enc.battleId);
  const from = c.inbox.length;
  c.send({ t: "resume" });
  await c.wait((m) => m.t === "resumed", 8000, from);
  return view;
}

const A = await toField(account);
await A.wait((m) => m.t === "packs");

// 1. Capture a mole (manual), so the next fight has a companion to level.
const first = await fight(A, "gate_moles", async (battleId) => {
  const call = battleCall(account, battleId);
  const gen = (await call("POST", "/session")).sessionGeneration;
  for (let i = 0; i < 6; i++) {
    const view = await call("GET", "");
    const enemy = view.state.units.find((u: Msg) => u.side === "enemy" && !u.ko && !u.retired);
    if (view.state.status !== "active" || enemy === undefined) return;
    if (view.actor !== "player") {
      await sleep(AUTO_GAP_MS);
      await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
      continue;
    }
    const res = await call("POST", "/commands", {
      commandId: crypto.randomUUID(),
      sessionGeneration: gen,
      expectedStateVersion: view.state.stateVersion,
      command: { type: "capture", actorId: "player", targetId: enemy.unitId, itemId: "item:supply_mole_capture" },
    });
    if (res.events?.some((e: Msg) => e.type === "CaptureResolved" && e.success)) return;
  }
});
out.firstFight = { outcome: first.state.status, exp: first.state.entitlements.map((e: Msg) => `${e.kind}:${e.exp}`) };
let b = await me();
out.afterFirst = { level: b.character.level, xp: b.character.xp, bar: expProgress(R, "player", b.character.xp), points: unspentPoints(R, b.character.level, b.character.primaryStats) };
const pet = b.companions[0];
if (pet !== undefined) {
  await http("PUT", "/character/team", { expectedVersion: b.character.version, companionIds: [pet.id] });
  // 2. A fight with the companion: both gain the same EXP; points cannot be spent mid-fight.
  const second = await fight(A, "gate_birds", async () => {
    const c = (await me()).character;
    out.allocateMidFight = (await http("PUT", "/character/stats", { expectedVersion: c.version, stats: { ...c.primaryStats, VIT: c.primaryStats.VIT + 1 } })).body.error;
  });
  b = await me();
  const p = b.companions.find((x: Msg) => x.id === pet.id);
  out.secondFight = { outcome: second.state.status, exp: second.state.entitlements.reduce((n: number, e: Msg) => n + (e.exp ?? 0), 0) };
  out.companion = { level: p.currentLevel, xp: p.xp };
}
out.character = { level: b.character.level, xp: b.character.xp };

// 3. Spend the points.
const c = b.character;
const points = unspentPoints(R, c.level, c.primaryStats);
const stats = { ...c.primaryStats, VIT: c.primaryStats.VIT + points };
const saved = await http("PUT", "/character/stats", { expectedVersion: c.version, stats });
out.allocate = { points, status: saved.status, VIT: saved.body.character?.primaryStats.VIT, left: saved.status === 200 ? unspentPoints(R, c.level, saved.body.character.primaryStats) : null };
out.overBudget = (await http("PUT", "/character/stats", { expectedVersion: c.version + 1, stats: { ...stats, STR: stats.STR + 1 } })).body.error;
A.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
