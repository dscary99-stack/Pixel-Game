// End-to-end secret quests against `wrangler dev`: locked says nothing → dev reveal → walking into the
// field through the portal counts an explore quest once → materials handed in at the town (retry
// replays) → a finished quest's rewards claimed once (retry replays) → a claimed title can be shown.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:secret`.
import { exampleMapRegistry, findPath } from "@pmrpg/shared";
import { api, connect, run, walk, type Msg } from "./smoke-lib";

const out: Record<string, unknown> = {};
const fail = (why: string): never => {
  console.log(JSON.stringify(out, null, 1));
  throw new Error(why);
};
const http = (account: string) => async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", "x-dev-account": account }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};

// Sets are rolled per account + name; look for one with a field explore quest and a deliver quest.
let account = "";
let call = http("");
let set: Msg = null;
for (let i = 0; i < 40 && set === null; i++) {
  account = `acct:s${run}${i}`;
  call = http(account);
  await call("POST", "/character", { operationId: `op_${run}_${i}_x`, name: `ผู้ลับ${i}`, classId: "class:striker", raceId: "race:sylvan", element: "FIRE" });
  if (i === 0) {
    const locked = (await call("GET", "/character/secret-quests")).body;
    out.locked = locked;
    if (JSON.stringify(locked) !== JSON.stringify({ locked: true })) fail("a locked set must say nothing else");
  }
  const v = (await call("POST", "/dev/secret-quests/reveal")).body;
  const explore = v.quests.find((q: Msg) => q.goal === "explore" && q.params.mapId === "map:dawn_field");
  const deliver = v.quests.find((q: Msg) => q.goal === "deliver");
  if (explore !== undefined && deliver !== undefined) set = { v, explore, deliver };
}
if (set === null) fail("no rolled set had both an explore (field) and a deliver quest");
out.tries = account;

// 1. Explore: walk town → field through the portal twice; one visit counts per hour.
const town = exampleMapRegistry().get("map:dawn_town")!;
for (let lap = 0; lap < 2; lap++) {
  const c = await connect(account, "map:dawn_town");
  if (c.mapId !== "map:dawn_town") fail(`lap ${lap} did not start in town`);
  await walk(c, findPath(town, c.pos, { x: 23, y: 8 })!);
  await c.wait((m) => m.t === "transfer");
  c.sock.close();
  const f = await connect(account, "map:dawn_field");
  await walk(f, findPath(exampleMapRegistry().get("map:dawn_field")!, f.pos, { x: 0, y: 8 })!);
  await f.wait((m) => m.t === "transfer");
  f.sock.close();
}
let v = (await call("GET", "/character/secret-quests")).body;
out.explore = v.progress[set.explore.id];
if (v.progress[set.explore.id]?.progress !== 1) fail("two walks within the hour must count one visit");

// 2. Deliver: back in town, hand in 3, retry the same request.
const itemId = set.deliver.params.itemId;
await call("POST", "/dev/grant", { operationId: `sg_${run}_items`, coins: 0, items: { [itemId]: 5 } });
const req = { operationId: `sd_${run}_once`, questId: set.deliver.id, quantity: 3 };
const d1 = await call("POST", "/character/secret-quests/deliver", req);
const d2 = await call("POST", "/character/secret-quests/deliver", req);
const bag = (await call("GET", "/character")).body.bag;
out.deliver = { first: d1.status, replayed: d2.body.replayed, progress: d2.body.view.progress[set.deliver.id], left: bag[itemId] };
if (d1.status !== 200 || d2.body.replayed !== true || bag[itemId] !== 2 || d2.body.view.progress[set.deliver.id].progress !== 3) fail("deliver wrong");
out.tooMany = (await call("POST", "/character/secret-quests/deliver", { operationId: `sd_${run}_many`, questId: set.deliver.id, quantity: 9999 })).body.error;

// 3. Claim: unfinished refused; dev-finish one with a title if any; claim twice.
const target = set.v.quests.find((q: Msg) => q.rewards?.some((r: Msg) => r.kind === "title")) ?? set.v.quests[0];
out.notDone = (await call("POST", "/character/secret-quests/claim", { questId: target.id })).body.error;
await call("POST", "/dev/secret-quests/complete", { questId: target.id });
const before = (await call("GET", "/character")).body;
const c1 = await call("POST", "/character/secret-quests/claim", { questId: target.id });
const c2 = await call("POST", "/character/secret-quests/claim", { questId: target.id });
const after = (await call("GET", "/character")).body;
out.claim = { status: c1.status, rewards: c1.body.result?.rewards?.map((r: Msg) => r.kind), replayed: c2.body.replayed, claimed: c2.body.view.claimed };
const wantCompanions = c1.body.result.rewards.filter((r: Msg) => r.kind === "companion").length;
const wantGear = c1.body.result.rewards.filter((r: Msg) => r.kind === "gear").length;
out.granted = { companions: after.companions.length - before.companions.length, gear: after.equipment.length - before.equipment.length };
if (c1.status !== 200 || c2.body.replayed !== true || after.companions.length - before.companions.length !== wantCompanions || after.equipment.length - before.equipment.length !== wantGear) fail("claim wrong");
const title = c1.body.result.rewards.find((r: Msg) => r.kind === "title");
if (title !== undefined) {
  const t = await call("PUT", "/character/title", { titleId: title.ref });
  out.title = t.body;
  if (t.status !== 200) fail("claimed title cannot be shown");
}
// 4. A companion or gear reward, when the set has one: created once, Lv1, owned by this account.
const thing = set.v.quests.find((q: Msg) => q.id !== target.id && q.rewards?.some((r: Msg) => r.kind === "companion" || r.kind === "gear"));
if (thing !== undefined) {
  await call("POST", "/dev/secret-quests/complete", { questId: thing.id });
  const b2 = (await call("GET", "/character")).body;
  const k1 = await call("POST", "/character/secret-quests/claim", { questId: thing.id });
  await call("POST", "/character/secret-quests/claim", { questId: thing.id });
  const a2 = (await call("GET", "/character")).body;
  const mons = a2.companions.filter((m: Msg) => m.originRecord?.kind === "secret_reward");
  out.objects = { rewards: k1.body.result.rewards.map((r: Msg) => r.kind), companions: a2.companions.length - b2.companions.length, gear: a2.equipment.length - b2.equipment.length, levels: mons.map((m: Msg) => m.currentLevel) };
  const want = (k: string) => k1.body.result.rewards.filter((r: Msg) => r.kind === k).length;
  if (a2.companions.length - b2.companions.length !== want("companion") || a2.equipment.length - b2.equipment.length !== want("gear") || mons.some((m: Msg) => m.currentLevel !== 1)) fail("object rewards wrong");
}
console.log(JSON.stringify(out, null, 1));
