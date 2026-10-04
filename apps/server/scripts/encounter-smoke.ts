// End-to-end Phase C check against `wrangler dev`: walk into the field, engage a visible pack,
// fight it to the end, come back to the same spot. Private fights (O05): the pack stays visible
// to the other player. Run `npm run db:migrate:local` and `npm run dev:server` first, then
// `npm run smoke:encounter`.
import { approach, api, connect, lastPacks, run, sleep, toField, type Msg, AUTO_GAP_MS } from "./smoke-lib";

const acct = (n: string) => `acct:e${run}_${n}`;
const out: Record<string, unknown> = {};

// No hunting in town.
const T = await connect(acct("a"), "map:dawn_town");
T.send({ t: "engage", packId: "map:dawn_town#1:x:1" });
out.townEngage = (await T.wait((m) => m.t === "error")).code;
T.sock.close();
await sleep(300);

const A = await toField(acct("a"));
const B = await toField(acct("b"));
await A.wait((m) => m.t === "packs");
await B.wait((m) => m.t === "packs");
const packsA = lastPacks(A);
out.packsSeen = packsA.map((p) => `${p.spawnId} ${p.leader.speciesId} ${p.leader.element} Lv${p.leader.level} [${p.sizeRange}]`);
out.sameForBoth = JSON.stringify(packsA) === JSON.stringify(lastPacks(B));

// No character yet: no fight (Phase D). Then both players make one.
const target0 = packsA[0];
A.send({ t: "engage", packId: target0.packId });
out.noCharacter = (await A.wait((m) => m.t === "error" && m.code === "NO_CHARACTER")).code;
for (const who of ["a", "b"]) {
  const r = await fetch(`${api}/character`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dev-account": acct(who) },
    body: JSON.stringify({ operationId: `op_${run}_${who}`, name: `ผู้เล่น ${who}`, classId: "class:striker", raceId: "race:human", element: "FIRE" }),
  });
  if (!r.ok) throw new Error(await r.text());
}

const target = packsA.sort((p, q) => Math.abs(p.x - A.pos.x) + Math.abs(p.y - A.pos.y) - (Math.abs(q.x - A.pos.x) + Math.abs(q.y - A.pos.y)))[0];
A.send({ t: "engage", packId: target.packId });
out.fromFar = (await A.wait((m) => m.t === "error" && m.code === "TOO_FAR")).code;

// Walk next to the pack, then engage.
await approach(A, target);
const standAt = { ...A.pos };
let from = A.inbox.length;
A.send({ t: "engage", packId: target.packId });
const enc = await A.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
out.encounter = enc;
const battleId: string = enc.battleId;
out.hiddenForA = !(await A.wait((m) => m.t === "packs", 3000, from)).packs.some((q: Msg) => q.packId === target.packId);
out.stillVisibleForB = lastPacks(B).some((q) => q.packId === target.packId);

// B engages the same pack: B's own fight, not A's.
await approach(B, target);
from = B.inbox.length;
B.send({ t: "engage", packId: target.packId });
const encB = await B.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
out.bOwnFight = encB.t === "encounter" && encB.battleId !== battleId;

// Walking during the fight is refused; a double engage returns the same fight.
from = A.inbox.length;
A.send({ t: "step", seq: ++A.seq, dir: "N" });
out.stepInBattle = (await A.wait((m) => m.t === "correct", 3000, from)).reason;
A.send({ t: "engage", packId: target.packId });
out.doubleEngage = (await A.wait((m) => m.t === "encounter", 3000, from)).battleId === battleId;

// Reload mid-fight: the fight comes back.
A.sock.close();
await sleep(300);
const A2 = await connect(acct("a"), A.mapId);
out.reconnect = await A2.wait((m) => m.t === "encounter");
from = A2.inbox.length;
A2.send({ t: "resume" });
out.resumeTooEarly = (await A2.wait((m) => m.t === "error", 3000, from)).code;

// Fight to the end with Auto (the open page drives it; C14).
const H = { "content-type": "application/json", "x-dev-account": acct("a") };
const call = async (method: string, action: string, body?: unknown) =>
  (await fetch(`${api}/battles/${battleId}${action}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) })).json() as Promise<Msg>;
const gen = (await call("POST", "/session")).sessionGeneration;
let view = await call("GET", "");
out.enemies = view.state.units.filter((u: Msg) => u.side === "enemy").map((u: Msg) => `${u.speciesId} ${u.element}`);
out.leaderMatches = view.state.units.find((u: Msg) => u.unitId === "e1").speciesId === target.leader.speciesId &&
  view.state.units.find((u: Msg) => u.unitId === "e1").element === target.leader.element;
let n = 0;
while (view.state.status === "active" && n < 300) {
  await sleep(AUTO_GAP_MS);
  const r = await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
  if (r.status !== "accepted") throw new Error(JSON.stringify(r));
  view = await call("GET", "");
  n++;
}
out.final = { status: view.state.status, autoSteps: n };
for (let i = 0; i < 50 && !(view.settlement.settled || view.settlement.failed > 0); i++) {
  await sleep(200);
  view = await call("GET", "");
}
out.settlement = view.settlement;
out.inventory = await (await fetch(`${api}/dev/inventory?battle=${battleId}`, { headers: H })).json();
// Journal (chapter 09): both maps entered, the pack's species met, each defeat counted once.
const journal = (await (await fetch(`${api}/journal`, { headers: H })).json()) as Msg;
const leader = journal.species?.find((s: Msg) => s.speciesId === target.leader.speciesId);
out.journal = { maps: journal.maps, leader: leader === undefined ? null : { seen: leader.seenElements, defeated: leader.defeated } };
if (!journal.maps?.includes("map:dawn_field") || leader === undefined || leader.seenElements.length === 0) throw new Error(`journal missing records: ${JSON.stringify(out.journal)}`);

// Back to walking from the same spot; the fought pack stays hidden for A.
from = A2.inbox.length;
A2.send({ t: "resume" });
await A2.wait((m) => m.t === "resumed", 3000, from);
const packsAfter = (await A2.wait((m) => m.t === "packs", 3000, from)).packs;
out.reloadKeptSpot = A2.pos.x === standAt.x && A2.pos.y === standAt.y;
out.foughtPackHidden = !packsAfter.some((q: Msg) => q.packId === target.packId);
A2.send({ t: "engage", packId: target.packId });
out.engageAgain = (await A2.wait((m) => m.t === "error", 3000, from)).code;
from = A2.inbox.length;
A2.send({ t: "step", seq: ++A2.seq, dir: "S" });
const after = await A2.wait((m) => m.t === "ack" || m.t === "correct", 3000, from);
out.walkAfter = { result: after.t, from: standAt, to: { x: after.x, y: after.y } };
for (const c of [A2, B]) c.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
