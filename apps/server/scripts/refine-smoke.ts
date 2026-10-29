// End-to-end refining (ตีบวก, REFINEMENT_DESIGN v2.1) against `wrangler dev`: a wrong price and an
// unneeded ward are refused with nothing spent, +0 → +5 by attempts the server rolls (a retry replays
// the receipt), a ward crafted from coins + monster materials and used at +6 (used up either way,
// the piece survives), then risky attempts without a ward until the piece breaks or reaches +10, and
// refining refused in the field.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:refine`.
import { PRODUCTION_RULES as R, exampleContentMaps, refineQuote, refineWardItemId, type RefineQuote } from "@pmrpg/shared";
import { api, connect, run, sleep, toField, type Msg } from "./smoke-lib";

const account = `acct:r${run}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const http = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const { equipment } = exampleContentMaps();
const out: Record<string, unknown> = {};
const fail = (why: string) => {
  console.log(JSON.stringify(out, null, 1));
  throw new Error(why);
};

await http("POST", "/character", { operationId: `op_${run}`, name: "ทดสอบตีบวก", classId: "class:striker", raceId: "race:human", element: "FIRE" });
const T = await connect(account, "map:dawn_town");
await T.wait((m) => m.t === "rested");
await http("POST", "/dev/grant", {
  operationId: `devg_${run}`,
  coins: 200_000,
  items: { "item:refine_stone_t1": 300, "item:crab_shell": 20, "item:crystal_shard": 2 },
  piece: { definitionId: "equip:ember_fang_dagger", rarity: "COMMON", affixes: [] },
});
const pieceNow = async (id: string): Promise<Msg | undefined> => (await http("GET", "/character")).body.equipment.find((e: Msg) => e.id === id);
const dagger = ((await http("GET", "/character")).body.equipment as Msg[]).find((e) => e.definitionId === "equip:ember_fang_dagger")!;
const quote = (p: Msg): RefineQuote => {
  const q = refineQuote(R, equipment.get(p.definitionId)!, p.refineLevel);
  if (!q.ok) throw new Error(q.message);
  return q.quote;
};
let n = 0;
const attempt = (p: Msg, ward: string | null = null, q = quote(p), op = `ref${n++}_${run}`) =>
  http("POST", "/town/refine", {
    operationId: op,
    equipmentId: p.id,
    expectedLevel: p.refineLevel,
    expectedVersion: p.version,
    wardItemId: ward,
    expectedCost: { coins: q.coins, stoneItemId: q.stoneItemId, stones: q.stones },
  });

// 1. Refusals that spend nothing.
const coins0 = (await http("GET", "/character")).body.coins;
out.wrongPrice = (await attempt(dagger, null, { ...quote(dagger), coins: 1 })).body.error;
out.wardTooEarly = (await attempt(dagger, refineWardItemId(1, 6))).body.error;
if ((await http("GET", "/character")).body.coins !== coins0) fail("a refused attempt spent coins");

// 2. +0 → +5: failures keep the level; a retry replays the same receipt.
const log: string[] = [];
let p = dagger;
const first = await attempt(p, null, quote(p), `first_${run}`);
const again = await attempt(p, null, quote(p), `first_${run}`);
if (!again.body.replayed || again.body.result.roll !== first.body.result.roll) fail("retry did not replay the receipt");
out.retry = { roll: first.body.result.roll, replayed: again.body.replayed, outcome: first.body.result.outcome };
log.push(`${first.body.result.from}->${first.body.result.target}:${first.body.result.outcome}`);
p = await pieceNow(dagger.id);
while (p.refineLevel < 5) {
  const r = await attempt(p);
  if (r.status !== 200) fail(`refine failed: ${JSON.stringify(r.body)}`);
  if (r.body.result.outcome === "destroyed") fail("a safe step destroyed the piece");
  log.push(`${r.body.result.from}->${r.body.result.target}:${r.body.result.outcome}`);
  p = await pieceNow(dagger.id);
}
out.safeSteps = log;

// 3. Craft a +6 ward (coins + crab shells + crystal shards), use it on +5 → +6.
const ward = refineWardItemId(1, 6);
const recipe = (await import("@pmrpg/shared")).exampleRecipeRegistry().get("recipe:refine_ward_t1_p6")!;
const crafted = await http("POST", "/town/craft", { operationId: `cw_${run}`, recipeId: recipe.id, times: 1, expectedCoins: recipe.coins });
if (crafted.status !== 200) fail(`ward craft failed: ${JSON.stringify(crafted.body)}`);
out.wardCraft = { coins: recipe.coins, ward: (await http("GET", "/character")).body.bag[ward] };
out.wrongWard = (await attempt(p, refineWardItemId(1, 7))).body.error;
const warded = await attempt(p, ward);
if (warded.status !== 200 || warded.body.result.outcome === "destroyed") fail(`warded attempt: ${JSON.stringify(warded.body)}`);
const after = await http("GET", "/character");
out.warded = { outcome: warded.body.result.outcome, roll: warded.body.result.roll, wardsLeft: after.body.bag[ward] ?? 0, pieceAlive: after.body.equipment.some((e: Msg) => e.id === dagger.id) };
if ((after.body.bag[ward] ?? 0) !== 0) fail("the ward was not used up");
{
  // The ward this step takes, which the bag no longer has: refused, never turned into a risky attempt.
  const now = await pieceNow(dagger.id);
  out.noWardLeft = (await attempt(now, quote(now).wardItemId)).body.error;
  if (out.noWardLeft !== "NO_WARD") fail("a missing ward was not refused");
}

// 4. Risky attempts without a ward until it breaks or reaches +10.
const risky: string[] = [];
let broke: Msg = null;
let last: Msg = p;
for (;;) {
  p = await pieceNow(dagger.id);
  if (p === undefined || p.refineLevel >= 10) break;
  last = p;
  const r = await attempt(p);
  if (r.status !== 200) fail(`risky refine failed: ${JSON.stringify(r.body)}`);
  risky.push(`${r.body.result.from}->${r.body.result.target}:${r.body.result.outcome}`);
  if (r.body.result.outcome === "destroyed") broke = r.body;
}
out.risky = risky;
if (broke !== null) {
  const gone = !(await http("GET", "/character")).body.equipment.some((e: Msg) => e.id === dagger.id);
  const receipt = (await http("GET", `/town/refine/receipt?operationId=${encodeURIComponent(`ref${n - 1}_${run}`)}`)).body;
  out.broken = { gone, receipt: receipt.outcome, againRefused: (await attempt(last)).body.error };
  if (!gone) fail("destroyed piece still owned");
}
T.sock.close();
await sleep(300);

// 5. Not in the field.
const F = await toField(account);
await F.wait((m) => m.t === "packs");
await http("POST", "/dev/grant", { operationId: `devg2_${run}`, coins: 0, piece: { definitionId: "equip:wooden_sword", rarity: "COMMON", affixes: [] } });
const sword = ((await http("GET", "/character")).body.equipment as Msg[]).find((e) => e.definitionId === "equip:wooden_sword" && e.refineLevel === 0)!;
out.inField = (await attempt(sword)).body.error;
F.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
