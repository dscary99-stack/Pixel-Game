// End-to-end mailbox against `wrangler dev`: a system letter (potions, coins, a companion) shows in the
// mailbox, one claim takes it all, a retry replays and a second claim is refused; a claim works in the
// field too; a market sale leaves the seller a notice.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:mail`.
import { PRODUCTION_RULES as R, marketFee } from "@pmrpg/shared";
import { api, connect, run, sleep, toField, type Msg } from "./smoke-lib";

const out: Record<string, unknown> = {};
const fail = (why: string) => {
  console.log(JSON.stringify(out, null, 1));
  throw new Error(why);
};
const player = (account: string) => {
  const H = { "content-type": "application/json", "x-dev-account": account };
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: (await r.json()) as Msg };
  };
};
const A = `acct:la${run}`;
const B = `acct:lb${run}`;
const a = player(A);
const b = player(B);
await a("POST", "/character", { operationId: `opa_${run}`, name: "ผู้รับจดหมาย", classId: "class:striker", raceId: "race:human", element: "FIRE" });
await b("POST", "/character", { operationId: `opb_${run}`, name: "ลูกค้าจดหมาย", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
const [TA, TB] = await Promise.all([connect(A, "map:dawn_town"), connect(B, "map:dawn_town")]);
await Promise.all([TA, TB].map((t) => t.wait((m) => m.t === "rested")));
const me = async () => (await a("GET", "/character")).body;

// 1. A system letter with 3 potions, 250 coins and a companion.
const mailId = `mail:dev:gift${run}`;
const sent = await a("POST", "/dev/mail", { mailId, title: "ของขวัญทดสอบ", body: "ทดสอบกล่องจดหมาย", coins: 250, items: { "item:small_potion": 3 }, companions: [{ speciesId: "species:supply_mole" }] });
if (sent.status !== 200) fail(`dev mail failed: ${JSON.stringify(sent.body)}`);
const box = (await a("GET", "/mail")).body;
out.view = { unclaimed: box.unclaimed, first: box.letters[0]?.title, companions: box.letters[0]?.companions?.length };
if (box.unclaimed !== 1) fail("the letter is not in the mailbox");

// 2. A market sale leaves the seller a notice.
await b("POST", "/dev/grant", { operationId: `gb_${run}`, coins: 5_000 });
const listed = await a("POST", "/market/list", { operationId: `list_${run}`, kind: "item", assetId: "item:small_potion", quantity: 2, price: 100, expectedFee: marketFee(R, 100) });
const bought = await b("POST", "/market/buy", { operationId: `buy_${run}`, listingId: listed.body.result?.listingId, expectedPrice: 100 });
const notice = (await a("GET", "/mail")).body.letters.find((l: Msg) => l.source === "market_sale");
out.sale = { buy: bought.status, notice: notice?.title ?? null };
if (bought.status !== 200 || notice === undefined) fail("no sale notice");
// 3. Claim in the field: everything arrives once; a retry replays; another claim is refused.
TA.sock.close();
await sleep(300);
const F = await toField(A);
await F.wait((m) => m.t === "packs");
const before = await me();
const op = `op_mail_${run}`;
const c1 = await a("POST", "/mail/claim", { operationId: op, mailIds: [mailId] });
const c2 = await a("POST", "/mail/claim", { operationId: op, mailIds: [mailId] });
const c3 = await a("POST", "/mail/claim", { operationId: `${op}_2`, mailIds: [mailId] });
const after = await me();
out.claim = {
  status: c1.status,
  replayed: c2.body.replayed,
  again: c3.body.error,
  potions: [before.bag["item:small_potion"] ?? 0, after.bag["item:small_potion"]],
  coins: after.coins - before.coins,
  companions: [before.companions.length, after.companions.length],
};
if (c1.status !== 200 || c2.body.replayed !== true || c3.body.error !== "CLOSED" || after.coins - before.coins !== 250 || after.companions.length !== before.companions.length + 1) fail("claim did not move everything once");
F.sock.close();
await sleep(300);

TB.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
