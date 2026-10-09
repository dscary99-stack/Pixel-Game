// End-to-end boss check against `wrangler dev` (chapter 07 §5, P17): the field's boss shows on the
// map, is started by hand next to it, fights in phases with its adds, and can be tried again right
// after with a new private fight; the claw part is on the field, and the town training ground stages
// the same boss with nothing earned or lost and a flee that always works. Run `npm run db:migrate:local` and `npm run dev:server` first,
// then `npm run smoke:boss`.
import { AUTO_GAP_MS, approach, api, autoToEnd, battleCall, connect, lastPacks, run, sleep, toField, type Client, type Msg } from "./smoke-lib";

const account = `acct:boss${run}`;
const out: Record<string, unknown> = {};
const r = await fetch(`${api}/character`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-dev-account": account },
  body: JSON.stringify({ operationId: `op_${run}`, name: "ท้าบอส", classId: "class:striker", raceId: "race:human", element: "FIRE" }),
});
if (!r.ok) throw new Error(await r.text());

let A: Client = await toField(account);
await A.wait((m) => m.t === "packs");
const lair = lastPacks(A).find((p) => p.rank === "BOSS");
if (lair === undefined) throw new Error("no boss on the field");
out.lair = { packId: lair.packId, bossId: lair.bossId, leader: `${lair.leader.speciesId} Lv${lair.leader.level}`, size: lair.sizeRange, at: [lair.x, lair.y] };

let from = A.inbox.length;
A.send({ t: "engage", packId: lair.packId });
out.fromFar = (await A.wait((m) => m.t === "error", 4000, from)).code;

/** Walk to the boss, start a try, Auto to the end, come back (to town on a loss). */
async function attempt(label: string) {
  if (A.mapId !== "map:dawn_field") A = await toField(account);
  await A.wait((m) => m.t === "packs");
  await approach(A, lair);
  from = A.inbox.length;
  A.send({ t: "engage", packId: lair.packId });
  const enc = await A.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
  if (enc.t !== "encounter") throw new Error(JSON.stringify(enc));
  const start = await battleCall(account, enc.battleId)("GET", "");
  const boss = start.state.units.find((u: Msg) => u.unitId === "e1");
  const view = await autoToEnd(account, enc.battleId);
  out[label] = {
    battleId: enc.battleId,
    enemies: start.state.units.filter((u: Msg) => u.side === "enemy").map((u: Msg) => `${u.unitId} ${u.speciesId} ${u.row}${u.slot}`),
    boss: { rank: boss.rank, maxHp: boss.stats.maxHp, actionsPerRound: boss.actionsPerRound, captureWindowOpen: boss.captureWindowOpen },
    phaseAtStart: start.state.boss,
    end: { status: view.state.status, round: view.state.round, boss: view.state.boss },
  };
  const at = A.inbox.length;
  A.send({ t: "resume" });
  await A.wait((m) => m.t === "resumed", 8000, at);
  const sentBack = await A.wait((m) => m.t === "transfer", 1500, at).catch(() => null);
  if (sentBack !== null) {
    A.sock.close();
    await sleep(300);
    A = await connect(account, sentBack.mapId, sentBack.channel);
  }
  return enc.battleId as string;
}

const first = await attempt("try1");
const second = await attempt("try2");
out.newFightEachTry = first !== second;
if (A.mapId !== "map:dawn_field") A = await toField(account);
out.bossStillShown = (await A.wait((m) => m.t === "packs")).packs.some((p: Msg) => p.rank === "BOSS");
A.sock.close();
const must = (ok: boolean, what: string, detail?: unknown) => {
  if (!ok) throw new Error(`${what}: ${JSON.stringify(detail)}`);
};
const t1 = out.try1 as { enemies: string[] };
must(t1.enemies.some((e) => e.startsWith("e4 species:crystal_crab_lord front")), "the claw part stands beside the boss", t1.enemies);

// Training ground (P17): a fresh character in town tries the boss; nothing is earned or lost.
const trainee = `acct:practice${run}`;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", "x-dev-account": trainee }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as Msg };
};
must((await call("POST", "/character", { operationId: `op_p${run}`, name: "ลองทีม", classId: "class:guardian", raceId: "race:human", element: "WATER" })).status === 200, "trainee");
const T = await connect(trainee, "map:dawn_town");
const offer = (await call("GET", "/practice")).body;
must(offer.bosses.some((b: Msg) => b.bossId === lair.bossId && b.parts.length > 0 && b.summons), "training ground offers the field boss", offer);
const before = (await call("GET", "/character")).body;
const op = `practice_${run}`;
const started = await call("POST", "/practice/start", { operationId: op, bossId: lair.bossId });
must(started.status === 200, "practice start", started.body);
must((await call("POST", "/practice/start", { operationId: op, bossId: lair.bossId })).body.battleId === started.body.battleId, "practice retry resumes the same fight");
must((await call("POST", "/practice/start", { operationId: `${op}_2`, bossId: lair.bossId })).body.error === "IN_BATTLE", "one practice at a time");
const pc = battleCall(trainee, started.body.battleId);
const gen = (await pc("POST", "/session")).sessionGeneration;
let pv = await pc("GET", "");
must(pv.state.practice === true && pv.state.units.some((u: Msg) => u.part?.partId === "claw"), "practice fight with the claw", pv.state);
for (let i = 0; i < 20 && pv.state.status === "active"; i++) {
  if (pv.actor === "player") {
    await pc("POST", "/commands", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: pv.state.stateVersion, command: { type: "flee", actorId: "player" } });
  } else {
    await sleep(AUTO_GAP_MS);
    await pc("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: pv.state.stateVersion });
  }
  pv = await pc("GET", "");
}
for (let i = 0; i < 50 && !(pv.settlement.settled || pv.settlement.failed > 0); i++) {
  await sleep(200);
  pv = await pc("GET", "");
}
must(pv.state.status === "fled" && pv.settlement.settled && pv.state.entitlements.length === 0, "practice left with nothing", { status: pv.state.status, settlement: pv.settlement });
const after = (await call("GET", "/character")).body;
must(JSON.stringify(after.inventory ?? after.items) === JSON.stringify(before.inventory ?? before.items) && after.character.hp === before.character.hp, "practice changed nothing", { before: before.character, after: after.character });
out.practice = { battleId: started.body.battleId, status: pv.state.status, entitlements: pv.state.entitlements.length, hpBefore: before.character.hp, hpAfter: after.character.hp };
T.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
