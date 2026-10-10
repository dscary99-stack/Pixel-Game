// End-to-end party bonus check (P02) against `wrangler dev`: two players in one party on the same
// field; once B has fought, A's next fight starts with EXP +5% and materials +2%. A third player
// outside the party gets nothing. Run `npm run db:migrate:local` and `npm run dev:server` first,
// then `npm run smoke:party`.
import { approach, api, battleCall, lastPacks, run, toField, type Msg } from "./smoke-lib";

const acct = (n: string) => `acct:pt${run}_${n}`;
const out: Record<string, unknown> = {};
const http = async (who: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-dev-account": acct(who) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Msg };
};

out.noCharacter = (await http("a", "POST", "/party")).body.error;
for (const who of ["a", "b", "c"]) {
  await http(who, "POST", "/character", { operationId: `op_${run}_${who}`, name: `ปาร์ตี้${who}`, classId: "class:striker", raceId: "race:human", element: "FIRE" });
}
const code = (await http("a", "POST", "/party")).body.party.partyId;
out.code = code;
out.joined = (await http("b", "POST", "/party/join", { partyId: code })).body.party.members.map((m: Msg) => m.name);
out.badCode = (await http("c", "POST", "/party/join", { partyId: "pt_0000000000" })).body.error;

const A = await toField(acct("a"));
const B = await toField(acct("b"));
const C = await toField(acct("c"));
for (const x of [A, B, C]) await x.wait((m) => m.t === "packs");

async function engage(c: typeof A, spawnId: string) {
  const pack = lastPacks(c).find((p) => p.spawnId === spawnId) ?? lastPacks(c)[0];
  await approach(c, pack);
  const from = c.inbox.length;
  c.send({ t: "engage", packId: pack.packId });
  const enc = await c.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
  if (enc.t !== "encounter") throw new Error(JSON.stringify(enc));
  return enc.battleId as string;
}

// B fights first: no partner has fought yet, so no bonus.
const b1 = await engage(B, "gate_birds");
out.firstFighter = (await battleCall(acct("b"), b1)("GET", "")).state.partyBonus ?? null;
// Now A's partner (B) is on this map and channel and fought just now: A's fight gets the bonus.
const a1 = await engage(A, "gate_moles");
out.withPartner = (await battleCall(acct("a"), a1)("GET", "")).state.partyBonus ?? null;
// C is not in the party: nothing.
const c1 = await engage(C, "gate_birds");
out.outsider = (await battleCall(acct("c"), c1)("GET", "")).state.partyBonus ?? null;
out.partyView = (await http("a", "GET", "/party")).body.party.members.map((m: Msg) => `${m.name} ${m.mapId}`);
out.leave = (await http("b", "POST", "/party/leave")).body.party;
for (const x of [A, B, C]) x.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
