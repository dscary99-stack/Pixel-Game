// End-to-end equipment check against `wrangler dev`: starter gear, equip/unequip with version
// checks, gear stats inside a real field fight, no changes mid-fight, locks freed after it.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:equipment`.
import { deriveStats } from "@pmrpg/shared";
import { approach, api, autoToEnd, battleCall, lastPacks, run, toField, type Msg } from "./smoke-lib";

const account = `acct:e${run}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const http = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const out: Record<string, unknown> = {};

// 1. A new dev character starts with the starter gear in the bag.
const made = await http("POST", "/character", { operationId: `op_${run}`, name: "ทดสอบของ", classId: "class:arcanist", raceId: "race:human", element: "FIRE" });
let bundle = (await http("GET", "/character")).body;
const piece = (def: string) => bundle.equipment.find((e: Msg) => e.definitionId === def)?.id as string;
out.starter = bundle.equipment.map((e: Msg) => `${e.definitionId}@${e.slot ?? "bag"}`);

// 2. Equip and swap: a two-hand staff, then armour; bad requests are refused.
let version = made.body.character.version as number;
const equip = async (slot: string, instanceId: string | null, expectedVersion = version) => {
  const r = await http("PUT", "/character/equipment", { expectedVersion, slot, instanceId });
  if (r.status === 200) version = r.body.character.version;
  return r;
};
out.sword = (await equip("MAIN_HAND", piece("equip:wooden_sword"))).status;
out.staffReplacesSword = (await equip("MAIN_HAND", piece("equip:apprentice_staff"))).body.equipment.filter((e: Msg) => e.slot).map((e: Msg) => e.definitionId);
out.tunic = (await equip("ARMOR", piece("equip:cloth_tunic"))).status;
out.wrongSlot = (await equip("FEET", piece("equip:wooden_sword"))).body.error;
out.stale = (await equip("FEET", null, version - 1)).body.error;
bundle = (await http("GET", "/character")).body;
out.version = version;

// 3. In a field fight the player unit carries the gear; gear cannot change mid-fight.
const c = bundle.character;
const bare = deriveStats(c.level, c.primaryStats);
const A = await toField(account);
await A.wait((m) => m.t === "packs");
// Packs roll over each cycle, so a pack can vanish while we walk to it; take the fresh one and retry.
let enc: Msg = null;
let from = 0;
for (let attempt = 0; attempt < 4 && enc?.t !== "encounter"; attempt++) {
  const pack = lastPacks(A).find((p) => p.spawnId === "gate_moles") ?? lastPacks(A)[0];
  await approach(A, pack);
  from = A.inbox.length;
  A.send({ t: "engage", packId: pack.packId });
  enc = await A.wait((m) => m.t === "encounter" || m.t === "error", 6000, from);
}
if (enc.t !== "encounter") throw new Error(JSON.stringify(enc));
const view = await battleCall(account, enc.battleId)("GET", "");
const player = view.state.units.find((u: Msg) => u.unitId === "player");
out.inFight = {
  maxHp: `${player.stats.maxHp} (bare ${bare.maxHp}, +30 tunic)`,
  maxMp: `${player.stats.maxMp} (bare ${bare.maxMp}, +10 staff)`,
  matk: `${player.stats.matk} (bare ${bare.matk}, +12 staff)`,
  pdef: `${player.stats.pdef} (bare ${bare.pdef}, +4 tunic)`,
  range: player.basicAttackRange,
};
out.equipDuringFight = (await equip("ARMOR", null)).body.error;
const end = await autoToEnd(account, enc.battleId);
from = A.inbox.length;
A.send({ t: "resume" });
await A.wait((m) => m.t === "resumed", 8000, from);
out.outcome = end.state.status;
out.drops = end.state.entitlements.filter((e: Msg) => e.kind === "kill").flatMap((e: Msg) => e.items.map((i: Msg) => `${i.itemId}×${i.quantity}`));

// 4. After settlement the gear is free again and can change.
bundle = (await http("GET", "/character")).body;
out.locksAfter = [...new Set(bundle.equipment.map((e: Msg) => e.lockState))];
out.gearDrops = bundle.equipment.filter((e: Msg) => !out.starter!.toString().includes(e.definitionId)).map((e: Msg) => e.definitionId);
out.unequipAfter = (await equip("ARMOR", null)).status;
A.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
