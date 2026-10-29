// End-to-end quests against `wrangler dev`: the board is rolled once, a delivery is handed in at the
// town board (items taken, reward paid once), crafting counts toward a craft quest, unfinished
// quests and the weekly main reward are refused.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:quest`.
import { exampleRecipeRegistry } from "@pmrpg/shared";
import { api, connect, run, sleep, type Msg } from "./smoke-lib";

const account = `acct:q${run}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const http = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const out: Record<string, unknown> = {};
const fail = (why: string): never => {
  console.log(JSON.stringify(out, null, 1));
  throw new Error(why);
};

await http("POST", "/character", { operationId: `op_${run}`, name: "ทดสอบเควส", classId: "class:striker", raceId: "race:human", element: "FIRE" });
const T = await connect(account, "map:dawn_town");
await T.wait((m) => m.t === "rested");

let q = (await http("GET", "/quests")).body;
const again = (await http("GET", "/quests")).body;
if (JSON.stringify(q.daily.goals.map((g: Msg) => g.goal)) !== JSON.stringify(again.daily.goals.map((g: Msg) => g.goal))) fail("the board changed between looks");
out.board = { daily: q.daily.goals.length, weekly: q.weekly.goals.length, claimsLeft: q.daily.claimsLeft, kinds: q.daily.goals.map((g: Msg) => g.goal.kind) };
const periodId = q.daily.period.id as string;

// 1. Delivery: materials from the dev grant, handed in once.
const di = q.daily.goals.findIndex((g: Msg) => g.goal.kind === "deliver");
if (di < 0) fail("no delivery on the board");
const deliver = q.daily.goals[di].goal;
await http("POST", "/dev/grant", { operationId: `qg1_${run}`, coins: 0, items: { [deliver.itemId]: deliver.count + 1 } });
const before = (await http("GET", "/character")).body.coins;
const d1 = await http("POST", "/quests/claim", { periodId, slot: di });
const d2 = await http("POST", "/quests/claim", { periodId, slot: di });
const bag = (await http("GET", "/character")).body;
out.delivery = { item: deliver.itemId, left: bag.bag[deliver.itemId] ?? 0, coinsGained: bag.coins - before, replayed: d2.body.replayed };
if (d1.status !== 200 || d2.body.replayed !== true || (bag.bag[deliver.itemId] ?? 0) !== 1 || bag.coins - before !== d1.body.result.reward.coins) fail("delivery claim wrong");

// 2. Craft quest: craft a no-mastery recipe of that profession enough times, then claim.
const ci = q.daily.goals.findIndex((g: Msg) => g.goal.kind === "craft");
if (ci < 0) fail("no craft quest on the board");
const craft = q.daily.goals[ci].goal;
out.craftBefore = (await http("POST", "/quests/claim", { periodId, slot: ci })).body.error;
const recipe = [...exampleRecipeRegistry().values()].find((r) => r.profession === craft.profession && r.requiredMastery === 0)!;
const items = Object.fromEntries(recipe.inputs.map((i) => [i.itemId, i.quantity * craft.count]));
await http("POST", "/dev/grant", { operationId: `qg2_${run}`, coins: recipe.coins * craft.count, items });
const made = await http("POST", "/town/craft", { operationId: `qc_${run}`, recipeId: recipe.id, times: craft.count, expectedCoins: recipe.coins * craft.count });
if (made.status !== 200) fail(`craft failed: ${JSON.stringify(made.body)}`);
q = (await http("GET", "/quests")).body;
out.craftProgress = `${q.daily.goals[ci].progress}/${craft.count}`;
const c1 = await http("POST", "/quests/claim", { periodId, slot: ci });
if (c1.status !== 200) fail(`craft quest claim failed: ${JSON.stringify(c1.body)}`);

// 3. Refusals: an unfinished hunt, the weekly main reward with nothing done.
const hi = q.daily.goals.findIndex((g: Msg) => g.goal.kind === "hunt");
out.huntUnfinished = (await http("POST", "/quests/claim", { periodId, slot: hi })).body.error;
out.weeklyMain = (await http("POST", "/quests/claim", { periodId: q.weekly.period.id, slot: "main" })).body.error;
q = (await http("GET", "/quests")).body;
out.claimsLeft = q.daily.claimsLeft;
if (out.huntUnfinished !== "NOT_DONE" || out.weeklyMain !== "NOT_DONE" || out.claimsLeft !== 2) fail("refusals or claim count wrong");
T.sock.close();
await sleep(200);
console.log(JSON.stringify(out, null, 1));
process.exit(0);
