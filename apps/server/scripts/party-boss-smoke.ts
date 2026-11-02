// End-to-end party boss fight against `wrangler dev` (Nut 2026-10-07: up to 5 players, 1 companion
// each = 10 ally places): two players in one party walk to the field boss, one starts the fight, both
// land in the same fight with their own units, each may command only their own, both play to the end,
// and both settle and walk on. Run `npm run db:migrate:local` and `npm run dev:server` first, then
// `npm run smoke:party-boss`.
import { approach, api, battleCall, connect, lastPacks, run, sleep, toField, AUTO_GAP_MS, type Client, type Msg } from "./smoke-lib";

const A = `acct:pa${run}`;
const B = `acct:pb${run}`;
const out: Record<string, unknown> = {};
const http = async (who: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", "x-dev-account": who }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return (await r.json()) as Msg;
};
for (const [who, name] of [
  [A, "หัวหน้า"],
  [B, "เพื่อน"],
]) {
  const c = await http(who, "POST", "/character", { operationId: `op_${who.replace(/\W/g, "")}`, name, classId: "class:striker", raceId: "race:human", element: "FIRE" });
  if (c.character === undefined) throw new Error(JSON.stringify(c));
}
const party = await http(A, "POST", "/party");
await http(B, "POST", "/party/join", { partyId: party.party.partyId });

const ca: Client = await toField(A);
const cb: Client = await toField(B);
await ca.wait((m) => m.t === "packs");
const lair = lastPacks(ca).find((p) => p.rank === "BOSS");
if (lair === undefined) throw new Error("no boss on the field");
await approach(ca, lair);
await approach(cb, lair);
const fa = ca.inbox.length;
const fb = cb.inbox.length;
ca.send({ t: "engage", packId: lair.packId });
const encA = await ca.wait((m) => m.t === "encounter" || m.t === "error", 8000, fa);
if (encA.t !== "encounter") throw new Error(JSON.stringify(encA));
const encB = await cb.wait((m) => m.t === "encounter", 8000, fb);
out.sameFight = encA.battleId === encB.battleId;
out.party = encB.party;

const call = { [A]: battleCall(A, encA.battleId), [B]: battleCall(B, encA.battleId) };
const gen = { [A]: (await call[A]("POST", "/session")).sessionGeneration, [B]: (await call[B]("POST", "/session")).sessionGeneration };
let view = await call[B]("GET", "");
out.allies = view.state.units.filter((u: Msg) => u.side === "ally").map((u: Msg) => `${u.unitId}@${u.row}${u.slot}→${u.controllerId === A ? "A" : "B"}`);
out.you = view.you === B;
// Whoever's turn it is not: refused.
const ownerOf = (v: Msg) => v.state.units.find((u: Msg) => u.unitId === v.actor)?.controllerId as string;
const other = ownerOf(view) === A ? B : A;
out.wrongPlayer = (await call[other]("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen[other], expectedStateVersion: view.state.stateVersion })).reasonCode;
// Each plays their own turns with Auto until the fight ends.
let turns = { [A]: 0, [B]: 0 };
for (let n = 0; view.state.status === "active" && n < 400; n++) {
  await sleep(AUTO_GAP_MS);
  const who = ownerOf(view);
  const r = await call[who]("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen[who], expectedStateVersion: view.state.stateVersion });
  if (r.status !== "accepted" && r.reasonCode !== "TOO_FAST") throw new Error(JSON.stringify(r));
  if (r.status === "accepted") turns[who]! += 1;
  view = await call[who]("GET", "");
}
for (let i = 0; i < 50 && !(view.settlement.settled || view.settlement.failed > 0); i++) {
  await sleep(200);
  view = await call[A]("GET", "");
}
out.end = { status: view.state.status, round: view.state.round, settlement: view.settlement };
out.turnsTaken = { A: turns[A], B: turns[B] };
out.rewards = { A: view.state.entitlements.filter((e: Msg) => e.recipientId === undefined).length, B: view.state.entitlements.filter((e: Msg) => e.recipientId === B).length };
for (const [who, c] of [
  [A, ca],
  [B, cb],
] as const) {
  const at = c.inbox.length;
  c.send({ t: "resume" });
  await c.wait((m) => m.t === "resumed", 8000, at);
  const back = await c.wait((m) => m.t === "transfer", 1500, at).catch(() => null);
  out[`resumed${who === A ? "A" : "B"}`] = back === null ? "walked on" : `sent to ${back.mapId}`;
  c.sock.close();
}
await sleep(200);
const again = await connect(B, "map:dawn_town");
out.bFreeAfter = (await http(B, "GET", "/world/where")).mapId;
again.sock.close();
if (!out.sameFight || out.wrongPlayer !== "NOT_YOUR_TURN" || !view.settlement.settled || turns[A] === 0 || turns[B] === 0) throw new Error(JSON.stringify(out));
console.log(JSON.stringify(out, null, 1));
process.exit(0);
