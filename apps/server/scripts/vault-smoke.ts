// End-to-end account vault against `wrangler dev` (Nut 2026-10-08): one login, two characters in two
// places (two sign-ins); the first puts potions, a piece and coins in at town, a retry replays, the
// second sees and takes them out; both reach for the last stack at once and one gets it; the two
// cannot buy each other's listings or trade with each other; a stranger's vault is separate.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:vault`.
import { PRODUCTION_RULES as R, marketFee } from "@pmrpg/shared";
import { api, run, sleep, type Msg } from "./smoke-lib";

const out: Record<string, unknown> = {};
const fail = (why: string) => {
  console.log(JSON.stringify(out, null, 1));
  throw new Error(why);
};
const as = (token: string) => async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const anon = as("");
const loginId = `vault_${run}`;
const password = "vault-password-1";
await anon("POST", "/auth/register", { loginId, password });
const t1 = (await anon("POST", "/auth/login", { loginId, password })).body.token as string;
const t2 = (await anon("POST", "/auth/login", { loginId, password })).body.token as string;
const one = as(t1);
const two = as(t2);
await one("POST", "/account/select", { slot: 1 });
await two("POST", "/account/select", { slot: 2 });
await one("POST", "/character", { operationId: `op_v1_${run}`, name: "คลังหนึ่ง", classId: "class:striker", raceId: "race:human", element: "FIRE" });
await two("POST", "/character", { operationId: `op_v2_${run}`, name: "คลังสอง", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
// Stand both in town (the map socket takes the session in the query).
const inTown = (token: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`${api.replace(/^http/, "ws")}/world/map:dawn_town/1?session=${encodeURIComponent(token)}`);
    const t = setTimeout(() => reject(new Error("no welcome")), 5000);
    ws.onmessage = (e) => {
      if (JSON.parse(String(e.data)).t === "welcome") {
        clearTimeout(t);
        resolve(ws);
      }
    };
  });
const [w1, w2] = await Promise.all([inTown(t1), inTown(t2)]);
await one("POST", "/dev/grant", { operationId: `vg1_${run}`, coins: 5000, items: { "item:small_potion": 10 }, piece: { definitionId: "equip:ember_fang_dagger", rarity: "RARE", affixes: [] } });
const me = async (p: typeof one) => (await p("GET", "/character")).body;
const c1 = await me(one);
const c2a = await me(two);
const dagger = (c1.equipment as Msg[]).find((e) => e.definitionId === "equip:ember_fang_dagger")!;

// 1. Character one puts things in; a retry replays.
const dep = { operationId: `dep_${run}`, items: [{ itemId: "item:small_potion", quantity: 6 }], equipmentIds: [dagger.id], coins: 2000 };
const d1 = await one("POST", "/vault/deposit", dep);
const d2 = await one("POST", "/vault/deposit", dep);
if (d1.status !== 200 || !d2.body.replayed) fail(`deposit: ${JSON.stringify(d1.body)}`);
const c1b = await me(one);
out.deposit = { potions: [c1.bag["item:small_potion"], c1b.bag["item:small_potion"]], coins: [c1.coins, c1b.coins], daggerStillCarried: c1b.equipment.some((e: Msg) => e.id === dagger.id) };

// 2. Character two sees the same vault and takes the piece and coins out.
const seen = (await two("GET", "/vault")).body;
out.seenByTwo = { shared: seen.shared, coins: seen.coins, items: seen.items.map((i: Msg) => `${i.name}×${i.quantity}`), pieces: seen.equipment.map((e: Msg) => e.name), slots: `${seen.usedSlots}/${seen.slots}` };
const wd = await two("POST", "/vault/withdraw", { operationId: `wd_${run}`, equipmentIds: [dagger.id], coins: 2000 });
const c2b = await me(two);
out.withdraw = { status: wd.status, coins: [c2a.coins, c2b.coins], daggerNowTwo: c2b.equipment.some((e: Msg) => e.id === dagger.id) };
if (!(out.withdraw as Msg).daggerNowTwo || c2b.coins - c2a.coins !== 2000) fail("withdraw did not move things");

// 3. Both reach for the 6 potions at once: exactly one gets them.
const race = await Promise.all([
  one("POST", "/vault/withdraw", { operationId: `r1_${run}`, items: [{ itemId: "item:small_potion", quantity: 6 }] }),
  two("POST", "/vault/withdraw", { operationId: `r2_${run}`, items: [{ itemId: "item:small_potion", quantity: 6 }] }),
]);
out.race = race.map((r) => r.body.error ?? r.status);
if (race.filter((r) => r.status === 200).length !== 1) fail("the race did not have one winner");

// 4. The same login cannot buy from itself or trade with itself.
const listing = await one("POST", "/market/list", { operationId: `ml_${run}`, kind: "item", assetId: "item:small_potion", quantity: 1, price: 20, expectedFee: marketFee(R, 20) });
out.sameBuy = (await two("POST", "/market/buy", { operationId: `mb_${run}`, listingId: listing.body.result.listingId, expectedPrice: 20 })).body.error;
const codeOne = (await one("GET", "/trade")).body.myCode;
out.sameTrade = (await two("POST", "/trade/offer", { operationId: `to_${run}`, kind: "item", toCode: codeOne, give: { coins: 1 }, want: { items: [{ itemId: "item:small_potion", quantity: 1 }] } })).body.error;
if (out.sameBuy !== "SAME_ACCOUNT" || out.sameTrade !== "SAME_ACCOUNT") fail("same account was not refused");

// 5. Another login's vault is its own.
const other = `vault2_${run}`;
await anon("POST", "/auth/register", { loginId: other, password });
const t3 = (await anon("POST", "/auth/login", { loginId: other, password })).body.token as string;
const three = as(t3);
await three("POST", "/account/select", { slot: 1 });
await three("POST", "/character", { operationId: `op_v3_${run}`, name: "คนนอก", classId: "class:striker", raceId: "race:human", element: "WIND" });
const theirs = (await three("GET", "/vault")).body;
out.strangerVault = { shared: theirs.shared, coins: theirs.coins, used: theirs.usedSlots };
if (theirs.usedSlots !== 0 || theirs.coins !== 0) fail("a stranger sees our vault");
w1.close();
w2.close();
await sleep(200);
console.log(JSON.stringify(out, null, 1));
process.exit(0);
