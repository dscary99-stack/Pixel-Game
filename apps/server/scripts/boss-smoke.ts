// End-to-end boss check against `wrangler dev` (chapter 07 §5, P17): the field's boss shows on the
// map, is started by hand next to it, fights in phases with its adds, and can be tried again right
// after with a new private fight. Run `npm run db:migrate:local` and `npm run dev:server` first,
// then `npm run smoke:boss`.
import { approach, api, autoToEnd, battleCall, connect, lastPacks, run, sleep, toField, type Client, type Msg } from "./smoke-lib";

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
console.log(JSON.stringify(out, null, 1));
process.exit(0);
