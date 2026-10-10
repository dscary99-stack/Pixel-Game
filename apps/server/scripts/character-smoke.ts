// End-to-end Phase D check against `wrangler dev`: make a character (its secret quests stay locked
// until the dev reveal), rest in town, capture a companion, put it in the team, name it, fight with
// it, see HP carry over, lose and wake up in town, then take it out of the team and release it.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:character`.
import { approach, api, autoToEnd, battleCall, connect, lastPacks, run, sleep, toField, type Client, type Msg, AUTO_GAP_MS } from "./smoke-lib";

const account = `acct:c${run}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const http = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const out: Record<string, unknown> = {};

// 1. Character creation: validated, idempotent, one per account.
out.before = (await http("GET", "/character")).status;
const create = { operationId: `op_${run}`, name: "นัท ทดสอบ", classId: "class:ranger", raceId: "race:wildkin", element: "WATER" };
out.badElement = (await http("POST", "/character", { ...create, element: "NEUTRAL" })).body.error;
const made = await http("POST", "/character", create);
const again = await http("POST", "/character", create);
out.created = { status: made.status, name: made.body.character.name, level: made.body.character.level, stats: made.body.character.primaryStats };
out.retrySameCharacter = again.body.character.id === made.body.character.id;
out.secondCharacter = (await http("POST", "/character", { ...create, operationId: `op_${run}_2` })).body.error;

// 1b. Secret quests: rolled at creation, locked with nothing else in the answer; the dev reveal shows the set.
const locked = await http("GET", "/character/secret-quests");
if (locked.status !== 200 || JSON.stringify(locked.body) !== JSON.stringify({ locked: true })) throw new Error(`secret quests leak while locked: ${JSON.stringify(locked.body)}`);
if (/sqt?:/.test(JSON.stringify((await http("GET", "/character")).body))) throw new Error("character bundle carries secret quest data");
const revealed = await http("POST", "/dev/secret-quests/reveal");
const kinds = (revealed.body.quests ?? []).map((q: Msg) => q.kind);
if (revealed.body.locked !== false || kinds[0] !== "element" || kinds[1] !== "race" || !kinds.slice(2).every((k: string) => k === "personal") || kinds.length < 3)
  throw new Error(`dev reveal: ${JSON.stringify(revealed.body)}`);
const again2 = await http("POST", "/dev/secret-quests/reveal");
if (JSON.stringify(again2.body) !== JSON.stringify(revealed.body)) throw new Error("secret quests changed between reads");
out.secretQuests = { locked: locked.body, revealed: kinds, first: `${revealed.body.quests[0].templateId} ${JSON.stringify(revealed.body.quests[0].params)}` };

// 2. Town is a rest point.
const T = await connect(account, "map:dawn_town");
out.townRest = (await T.wait((m) => m.t === "rested")).t;
out.nameInWorld = T.inbox.find((m) => m.t === "welcome").self.name;
T.sock.close();
await sleep(300);

/** Engage the pack at this spawn, run `inFight`, then Auto to the end and come back. */
async function fightAt(c: Client, spawnId: string, inFight: (battleId: string) => Promise<void> = async () => undefined) {
  const pack = lastPacks(c).find((p) => p.spawnId === spawnId);
  if (pack === undefined) throw new Error(`no ${spawnId} pack`);
  await approach(c, pack);
  let from = c.inbox.length;
  c.send({ t: "engage", packId: pack.packId });
  const enc = await c.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
  if (enc.t !== "encounter") throw new Error(JSON.stringify(enc));
  await inFight(enc.battleId);
  const view = await autoToEnd(account, enc.battleId);
  from = c.inbox.length;
  c.send({ t: "resume" });
  const back = await c.wait((m) => m.t === "resumed", 8000, from);
  return { battleId: enc.battleId as string, view, back, from };
}

// 3. Capture a starter companion (manual capture command; C15 no auto capture).
let A = await toField(account);
await A.wait((m) => m.t === "packs");
let captured: string | null = null;
for (const spawnId of ["gate_moles", "gate_birds"]) {
  if (captured !== null) break;
  const r = await fightAt(A, spawnId, async (battleId) => {
    const call = battleCall(account, battleId);
    const gen = (await call("POST", "/session")).sessionGeneration;
    for (let i = 0; i < 6; i++) {
      const view = await call("GET", "");
      if (view.state.status !== "active") return;
      const enemy = view.state.units.find((u: Msg) => u.side === "enemy" && !u.ko && !u.retired);
      if (enemy === undefined) return;
      if (view.actor !== "player") {
        await sleep(AUTO_GAP_MS);
        await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
        continue;
      }
      const itemId = `item:${enemy.speciesId.slice("species:".length)}_capture`;
      const res = await call("POST", "/commands", {
        commandId: crypto.randomUUID(),
        sessionGeneration: gen,
        expectedStateVersion: view.state.stateVersion,
        command: { type: "capture", actorId: "player", targetId: enemy.unitId, itemId },
      });
      if (res.events?.some((e: Msg) => e.type === "CaptureResolved" && e.success)) return;
    }
  });
  out[`fight_${spawnId}`] = { outcome: r.view.state.status, captures: r.view.state.entitlements.filter((e: Msg) => e.kind === "capture").length };
  const bundle = (await http("GET", "/character")).body;
  captured = bundle.companions[0]?.id ?? null;
  out.hpAfterFirstFight = bundle.character.hp;
}
out.captured = captured;

// 4. Team: saved with a version check; a stale write is refused.
if (captured !== null) {
  // The player picks where it stands (back row, last cell) instead of the default.
  const saved = await http("PUT", "/character/team", { expectedVersion: 1, companionIds: [captured], formation: [{ instanceId: captured, row: "back", slot: 2 }] });
  out.teamSaved = { status: saved.status, team: saved.body.character?.team };
  out.staleTeam = (await http("PUT", "/character/team", { expectedVersion: 1, companionIds: [] })).body.error;
  out.nickname = (await http("PUT", "/character/companion/nickname", { companionId: captured, nickname: "เจ้าตัวเล็ก" })).body.nickname;
  out.releaseInTeam = (await http("POST", "/character/companion/release", { operationId: `rel0_${run}`, companionId: captured })).body.error;

  // 5. The companion fights next to the character; the team is frozen during the fight (P15).
  const spawn = lastPacks(A).find((p) => p.spawnId === "south_snails") ? "south_snails" : lastPacks(A)[0].spawnId;
  const r = await fightAt(A, spawn, async (battleId) => {
    const view = await battleCall(account, battleId)("GET", "");
    const unit = view.state.units.find((u: Msg) => u.instanceId === captured);
    out.companionInFight = unit === undefined ? false : `${unit.name} @ ${unit.row}:${unit.slot}`;
    out.teamDuringFight = (await http("PUT", "/character/team", { expectedVersion: 2, companionIds: [] })).body.error;
  });
  out.withCompanion = r.view.state.status;
  const bundle = (await http("GET", "/character")).body;
  out.hpCarriedOver = { character: bundle.character.hp, companion: bundle.companions.find((c: Msg) => c.id === captured)?.hp };
  if (r.view.state.status === "defeat") A = await connect(account, (await A.wait((m) => m.t === "transfer", 4000, r.from)).mapId);
}

// 6. A lost fight sends the team back to town, where it rests.
if (A.mapId !== "map:dawn_field") A = await toField(account);
await A.wait((m) => m.t === "packs");
// Lv8 foxes first, then Lv6 crabs: a Lv1 team is expected to lose at least one of them.
out.strongFights = [];
for (const spawnId of ["meadow_foxes", "pond_crabs"]) {
  if (!lastPacks(A).some((p) => p.spawnId === spawnId)) continue;
  const r = await fightAt(A, spawnId);
  (out.strongFights as string[]).push(`${spawnId}: ${r.view.state.status}`);
  // A win with the character down also sends the team back to rest (enemies now use skills too).
  const sentBack = await A.wait((m) => m.t === "transfer", 1500, r.from).catch(() => null);
  if (r.view.state.status === "defeat" || sentBack !== null) {
    const t = await A.wait((m) => m.t === "transfer", 4000, r.from);
    out.sentTo = t.mapId;
    const hurt = (await http("GET", "/character")).body.character.hp;
    const back = await connect(account, t.mapId, t.channel);
    out.restedOnArrival = (await back.wait((m) => m.t === "rested")).t;
    const after = (await http("GET", "/character")).body;
    out.afterRest = { hpBefore: hurt, hp: after.character.hp, companionsFull: after.companions.every((c: Msg) => c.hp === null) };
    back.sock.close();
    break;
  }
}
// 7. Out of the team, the companion can be released (nothing back); a retry replays.
if (captured !== null) {
  const now = (await http("GET", "/character")).body;
  await http("PUT", "/character/team", { expectedVersion: now.character.version, companionIds: [] });
  const rel = { operationId: `rel1_${run}`, companionId: captured };
  const released = await http("POST", "/character/companion/release", rel);
  out.released = { status: released.status, replayed: (await http("POST", "/character/companion/release", rel)).body.replayed };
  out.companionsAfterRelease = (await http("GET", "/character")).body.companions.length;
  if (released.status !== 200) throw new Error(`release failed: ${JSON.stringify(released.body)}`);
}
A.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
