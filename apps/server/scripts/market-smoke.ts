// End-to-end World Market and direct trade against `wrangler dev`: list a stack (fee paid, a retry
// replays), another player finds and buys it (seller paid less the tax), two buyers race for one piece
// (one wins), a Lv40 companion is refused to a Lv1 buyer (O01) and taken back, an item trade (potions +
// a piece for coins) and a companion trade (Bond back to 0) by trade code, an item trade carrying a
// companion is refused, and in the field listing and taking back are refused while buying works.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:market`.
import { PRODUCTION_RULES as R, marketFee, marketTax } from "@pmrpg/shared";
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
const A = `acct:ma${run}`;
const B = `acct:mb${run}`;
const C = `acct:mc${run}`;
const a = player(A);
const b = player(B);
const c = player(C);
let n = 0;
const op = (p: string) => `${p}${n++}_${run}`;

await a("POST", "/character", { operationId: `opa_${run}`, name: "พ่อค้าทดสอบ", classId: "class:striker", raceId: "race:human", element: "FIRE" });
await b("POST", "/character", { operationId: `opb_${run}`, name: "ลูกค้าทดสอบ", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
await c("POST", "/character", { operationId: `opc_${run}`, name: "คู่แข่งทดสอบ", classId: "class:guardian", raceId: "race:stonekin", element: "WATER" });
const [TA, TB, TC] = await Promise.all([connect(A, "map:dawn_town"), connect(B, "map:dawn_town"), connect(C, "map:dawn_town")]);
await Promise.all([TA, TB, TC].map((t) => t.wait((m) => m.t === "rested")));
await a("POST", "/dev/grant", { operationId: `ga_${run}`, coins: 50_000, items: { "item:small_potion": 20 }, piece: { definitionId: "equip:ember_fang_dagger", rarity: "RARE", affixes: [] } });
await a("POST", "/dev/grant", { operationId: `gc1_${run}`, companion: { speciesId: "species:armor_crab", level: 40 } });
await a("POST", "/dev/grant", { operationId: `gc2_${run}`, companion: { speciesId: "species:ember_fox", level: 12 } });
await a("POST", "/dev/grant", { operationId: `gp_${run}`, piece: { definitionId: "equip:wooden_sword", rarity: "COMMON", affixes: [] } });
await b("POST", "/dev/grant", { operationId: `gb_${run}`, coins: 50_000 });
await c("POST", "/dev/grant", { operationId: `gcc_${run}`, coins: 50_000 });
const me = async (p: typeof a) => (await p("GET", "/character")).body;

// 1. List 5 potions for 300: the fee is paid now; a retry with the same id replays.
const a0 = await me(a);
const listOp = op("list");
const listReq = { operationId: listOp, kind: "item", assetId: "item:small_potion", quantity: 5, price: 300, expectedFee: marketFee(R, 300) };
const listed = await a("POST", "/market/list", listReq);
if (listed.status !== 200) fail(`list failed: ${JSON.stringify(listed.body)}`);
const again = await a("POST", "/market/list", listReq);
const a1 = await me(a);
out.list = { fee: listed.body.result.fee, replayed: again.body.replayed, potions: [a0.bag["item:small_potion"], a1.bag["item:small_potion"]], coins: [a0.coins, a1.coins] };
if (!again.body.replayed || a1.bag["item:small_potion"] !== a0.bag["item:small_potion"] - 5 || a1.coins !== a0.coins - marketFee(R, 300)) fail("listing did not escrow once");
out.wrongFee = (await a("POST", "/market/list", { ...listReq, operationId: op("list"), expectedFee: 99 })).body.error;

// 2. B finds it by name and buys it; A gets the price less the tax.
const found = (await b("GET", `/market?kind=item&q=${encodeURIComponent("ยา")}`)).body.listings.find((l: Msg) => l.listingId === listed.body.result.listingId);
if (found === undefined) fail("B cannot see the listing");
const b0 = await me(b);
const bought = await b("POST", "/market/buy", { operationId: op("buy"), listingId: found.listingId, expectedPrice: 300 });
const [a2, b1] = [await me(a), await me(b)];
out.buy = { status: bought.status, buyerPotions: [b0.bag["item:small_potion"] ?? 0, b1.bag["item:small_potion"]], sellerGot: a2.coins - a1.coins, tax: marketTax(R, 300) };
if (a2.coins - a1.coins !== 300 - marketTax(R, 300) || b0.coins - b1.coins !== 300) fail("coins did not move right");
out.buySoldAgain = (await a("POST", "/market/buy", { operationId: op("buy"), listingId: found.listingId, expectedPrice: 300 })).body.error;

// 3. A RARE dagger; B and C race for it: exactly one gets it.
const dagger = (a2.equipment as Msg[]).find((e) => e.definitionId === "equip:ember_fang_dagger")!;
const dl = await a("POST", "/market/list", { operationId: op("list"), kind: "equipment", assetId: dagger.id, quantity: 1, price: 2000, expectedFee: marketFee(R, 2000) });
const race = await Promise.all([b("POST", "/market/buy", { operationId: op("rb"), listingId: dl.body.result.listingId, expectedPrice: 2000 }), c("POST", "/market/buy", { operationId: op("rc"), listingId: dl.body.result.listingId, expectedPrice: 2000 })]);
const owners = [(await me(b)).equipment.some((e: Msg) => e.id === dagger.id), (await me(c)).equipment.some((e: Msg) => e.id === dagger.id)];
out.race = { statuses: race.map((r) => r.status), errors: race.map((r) => r.body.error ?? null), owners };
if (owners.filter(Boolean).length !== 1 || race.filter((r) => r.status === 200).length !== 1) fail("the race did not have one winner");

// 4. A Lv40 crab: a Lv1 buyer is refused (O01: at most +30), A takes it back.
const crab = (a2.companions as Msg[]).find((m) => m.speciesId === "species:armor_crab")!;
const cl = await a("POST", "/market/list", { operationId: op("list"), kind: "companion", assetId: crab.id, quantity: 1, price: 5000, expectedFee: marketFee(R, 5000) });
const snap = (await b("GET", "/market?kind=companion")).body.listings.find((l: Msg) => l.listingId === cl.body.result.listingId);
out.companionListing = { minRecipientLevel: snap?.asset.minRecipientLevel, bondAfterTransfer: snap?.asset.bondAfterTransfer };
out.lowLevelBuy = (await b("POST", "/market/buy", { operationId: op("buy"), listingId: cl.body.result.listingId, expectedPrice: 5000 })).body.error;
out.teamWhileListed = (await a("PUT", "/character/team", { expectedVersion: (await me(a)).character.version, companionIds: [crab.id] })).body.error;
out.cancel = (await a("POST", "/market/cancel", { operationId: op("cancel"), listingId: cl.body.result.listingId })).status;
out.crabBack = (await me(a)).companions.find((m: Msg) => m.id === crab.id)?.lockState;
if (out.lowLevelBuy !== "LEVEL_INELIGIBLE" || out.crabBack !== "free") fail("O01 or cancel did not hold");

// 5. Item trade by code: A gives 3 potions + a sword, wants 150 coins; B accepts.
const codeB = (await b("GET", "/trade")).body.myCode as string;
const sword = ((await me(a)).equipment as Msg[]).find((e) => e.definitionId === "equip:wooden_sword" && e.slot === null)!;
const offer = await a("POST", "/trade/offer", { operationId: op("offer"), kind: "item", toCode: codeB.toLowerCase(), give: { items: [{ itemId: "item:small_potion", quantity: 3 }], equipmentIds: [sword.id] }, want: { coins: 150 } });
if (offer.status !== 200) fail(`offer failed: ${JSON.stringify(offer.body)}`);
const inbox = (await b("GET", "/trade")).body.open.find((o: Msg) => o.offerId === offer.body.result.offerId);
const accept = await b("POST", "/trade/accept", { operationId: op("acc"), offerId: offer.body.result.offerId });
out.itemTrade = { inboxDirection: inbox?.direction, accept: accept.status, swordNowB: (await me(b)).equipment.some((e: Msg) => e.id === sword.id) };
if (!out.itemTrade || !(out.itemTrade as Msg).swordNowB) fail("item trade did not move the sword");

// 6. Companion trade: the Lv12 fox for 50 coins; Bond starts at 0 for B.
const fox = ((await me(a)).companions as Msg[]).find((m) => m.speciesId === "species:ember_fox")!;
out.mixedRefused = (await a("POST", "/trade/offer", { operationId: op("offer"), kind: "item", toCode: codeB, give: { companionIds: [fox.id] }, want: {} })).body.error;
const co = await a("POST", "/trade/offer", { operationId: op("offer"), kind: "companion", toCode: codeB, give: { companionIds: [fox.id] }, want: { coins: 50 } });
const ca = await b("POST", "/trade/accept", { operationId: op("acc"), offerId: co.body.result.offerId });
const foxB = ((await me(b)).companions as Msg[]).find((m) => m.id === fox.id);
out.companionTrade = { accept: ca.status, bond: foxB?.bond ?? null, owner: foxB === undefined ? "A" : "B" };
if (foxB === undefined || (foxB.bond ?? 0) !== 0) fail("companion trade did not reset Bond");
out.selfTrade = (await a("POST", "/trade/offer", { operationId: op("offer"), kind: "item", toCode: (await a("GET", "/trade")).body.myCode, give: { items: [{ itemId: "item:small_potion", quantity: 1 }] }, want: {} })).body.error;
const fieldListing = (await a("POST", "/market/list", { operationId: op("list"), kind: "item", assetId: "item:small_potion", quantity: 2, price: 40, expectedFee: marketFee(R, 40) })).body.result.listingId as string;
TA.sock.close();
TB.sock.close();
await sleep(300);

// 7. Listing and taking back are in town (the NPC); browsing and buying work in the field (Nut 2026-10-08).
const F = await toField(A);
await F.wait((m) => m.t === "packs");
out.listInField = (await a("POST", "/market/list", { operationId: op("list"), kind: "item", assetId: "item:small_potion", quantity: 1, price: 10, expectedFee: marketFee(R, 10) })).body.error;
out.cancelInField = (await a("POST", "/market/cancel", { operationId: op("cancel"), listingId: fieldListing })).body.error;
out.browseInField = (await a("GET", "/market")).status;
const FB = await toField(B);
await FB.wait((m) => m.t === "packs");
out.buyInField = (await b("POST", "/market/buy", { operationId: op("buy"), listingId: fieldListing, expectedPrice: 40 })).status;
if (out.listInField !== "NOT_IN_TOWN" || out.cancelInField !== "NOT_IN_TOWN" || out.buyInField !== 200) fail("field rules did not hold");
F.sock.close();
FB.sock.close();
TC.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
