// End-to-end town services against `wrangler dev`: install a Sigil, remove it for coins in town,
// sell to and buy from the NPC, reroll an affix, craft gear, fill an NPC order, and the same requests refused in the field.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:town`.
import { api, connect, run, sleep, toField, type Msg } from "./smoke-lib";

const account = `acct:t${run}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const http = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${api}${path}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as Msg };
};
const out: Record<string, unknown> = {};

await http("POST", "/character", { operationId: `op_${run}`, name: "ทดสอบร้าน", classId: "class:striker", raceId: "race:human", element: "FIRE" });
let bundle = (await http("GET", "/character")).body;
const piece = (def: string) => bundle.equipment.find((e: Msg) => e.definitionId === def).id as string;
out.start = { coins: bundle.coins, sigils: Object.fromEntries(Object.entries(bundle.bag).filter(([k]) => k.endsWith("_sigil"))) };

// In town (joining the map stores the position the services check).
const T = await connect(account, "map:dawn_town");
await T.wait((m) => m.t === "rested");

// 1. Install: compatible only, retry-safe.
const sword = piece("equip:wooden_sword");
const install = { operationId: `inst_${run}`, equipmentId: sword, sigilItemId: "item:ember_fox_sigil" };
out.install = (await http("POST", "/character/equipment/sigil", install)).body.result?.sigils;
out.installRetry = (await http("POST", "/character/equipment/sigil", install)).body.replayed;
out.incompatible = (await http("POST", "/character/equipment/sigil", { ...install, operationId: `inst2_${run}`, equipmentId: piece("equip:cloth_tunic") })).body.error;
out.full = (await http("POST", "/character/equipment/sigil", { ...install, operationId: `inst3_${run}` })).body.error;

// 2. Remove in town: price shown first, wrong price refused, Sigil comes back.
out.wrongPrice = (await http("POST", "/character/equipment/sigil/remove", { operationId: `rm0_${run}`, equipmentId: sword, socket: 0, expectedCost: 1 })).body.error;
const rm = await http("POST", "/character/equipment/sigil/remove", { operationId: `rm1_${run}`, equipmentId: sword, socket: 0, expectedCost: 300 });
out.removed = { paid: rm.body.result?.paid, coins: rm.body.coins };

// 3. Sell to the NPC.
const sold = await http("POST", "/town/sell", { operationId: `sell_${run}`, lines: [{ itemId: "item:small_potion", quantity: 1 }] });
out.sold = { total: sold.body.result?.total, coins: sold.body.coins };
out.notSellable = (await http("POST", "/town/sell", { operationId: `sell2_${run}`, lines: [{ itemId: "item:ember_fox_sigil", quantity: 1 }] })).body.error;
// Buying at the village shop (chapter 06): the shown total goes with the request.
const buyReq = { operationId: `buy_${run}`, shopId: "shop:dawn_general", lines: [{ itemId: "item:small_potion", quantity: 2 }], expectedTotal: 60 };
const bought = await http("POST", "/town/buy", buyReq);
out.bought = { total: bought.body.result?.total, coins: bought.body.coins, retry: (await http("POST", "/town/buy", buyReq)).body.replayed };
out.buyWrongTotal = (await http("POST", "/town/buy", { ...buyReq, operationId: `buy2_${run}`, expectedTotal: 1 })).body.error;
out.buyNotListed = (await http("POST", "/town/buy", { ...buyReq, operationId: `buy3_${run}`, lines: [{ itemId: "item:crab_shell", quantity: 1 }], expectedTotal: 0 })).body.error;
// Affix reroll (chapter 05 §3): a dev piece with two affixes, pay, see the new roll, keep it.
await http("POST", "/dev/grant", {
  operationId: `devg_${run}`,
  coins: 1000,
  items: { "item:river_pebble": 4 },
  piece: { definitionId: "equip:ember_fang_dagger", rarity: "RARE", affixes: [{ stat: "PATK", value: 4 }, { stat: "STR", value: 2 }] },
});
bundle = (await http("GET", "/character")).body;
const dagger = bundle.equipment.find((e: Msg) => e.affixes.length === 2);
const rerollCost = { coins: 600, itemId: "item:river_pebble", quantity: 2 };
const rerollReq = { operationId: `rr_${run}`, equipmentId: dagger.id, slot: 1, expectedAffixes: dagger.affixes, expectedCost: rerollCost };
const rr = await http("POST", "/town/affix/reroll", rerollReq);
out.reroll = { old: rr.body.result?.old, rolled: rr.body.result?.rolled, coins: rr.body.coins, retry: (await http("POST", "/town/affix/reroll", rerollReq)).body.replayed };
out.rerollWhilePending = (await http("POST", "/town/affix/reroll", { ...rerollReq, operationId: `rr2_${run}` })).body.error;
const chosen = await http("POST", "/character/equipment/affix/choose", { operationId: `ch_${run}`, equipmentId: dagger.id, rerollOperationId: rerollReq.operationId, keep: "new" });
out.kept = chosen.body.result?.affixes;
if (JSON.stringify(chosen.body.result?.affixes?.[1]) !== JSON.stringify(rr.body.result?.rolled)) throw new Error("keep new did not apply the roll");
// Crafting (chapter 05 §6): materials + coins → a rolled buckler and armorsmith mastery; retry replays.
await http("POST", "/dev/grant", { operationId: `devc_${run}`, coins: 240, items: { "item:crab_shell": 12, "item:river_pebble": 8 } });
const craftReq = { operationId: `cr_${run}`, recipeId: "recipe:crab_buckler", times: 2, expectedCoins: 240 };
const crafted = await http("POST", "/town/craft", craftReq);
if (crafted.status !== 200 || crafted.body.result?.equipment?.length !== 2) throw new Error(`craft failed: ${JSON.stringify(crafted.body)}`);
const craftRetry = await http("POST", "/town/craft", craftReq);
if (JSON.stringify(craftRetry.body.result) !== JSON.stringify(crafted.body.result)) throw new Error("craft retry did not replay");
bundle = (await http("GET", "/character")).body;
const madeIds = crafted.body.result.equipment.map((e: Msg) => e.id);
if (madeIds.some((id: string) => !bundle.equipment.some((e: Msg) => e.id === id))) throw new Error("crafted pieces missing");
out.craft = { made: crafted.body.result.equipment.map((e: Msg) => e.rarity), mastery: bundle.craftMastery.armorsmith, shells: bundle.bag["item:crab_shell"] ?? 0, retry: craftRetry.body.replayed };
out.craftShort = (await http("POST", "/town/craft", { ...craftReq, operationId: `cr2_${run}` })).body.error;
// NPC order (chapter 09): hand in crab shells once, retry replays, the week's count goes down.
await http("POST", "/dev/grant", { operationId: `devo_${run}`, coins: 0, items: { "item:crab_shell": 8 } });
const orderReq = { operationId: `ord_${run}`, orderId: "order:shell_roof" };
const filled = await http("POST", "/town/order", orderReq);
const refill = await http("POST", "/town/order", orderReq);
const orderView = (await http("GET", "/town/orders")).body;
out.order = { status: filled.status, reward: filled.body.result?.reward, replayed: refill.body.replayed, left: orderView.orders.find((o: Msg) => o.order.id === "order:shell_roof")?.left };
if (filled.status !== 200 || refill.body.replayed !== true) throw new Error(`order fill failed: ${JSON.stringify(filled.body)}`);
out.orderNoItems = (await http("POST", "/town/order", { ...orderReq, operationId: `ord2_${run}` })).body.error;
T.sock.close();
await sleep(300);

// 4. In the field the shop and removal are closed; installing still works outside fights.
const F = await toField(account);
await F.wait((m) => m.t === "packs");
out.buyInField = (await http("POST", "/town/buy", { ...buyReq, operationId: `buy4_${run}` })).body.error;
out.sellInField = (await http("POST", "/town/sell", { operationId: `sell3_${run}`, lines: [{ itemId: "item:small_potion", quantity: 1 }] })).body.error;
out.installInField = (await http("POST", "/character/equipment/sigil", { ...install, operationId: `inst4_${run}` })).status;
out.craftInField = (await http("POST", "/town/craft", { ...craftReq, operationId: `cr3_${run}`, times: 1, expectedCoins: 120 })).body.error;
out.orderInField = (await http("POST", "/town/order", { ...orderReq, operationId: `ord3_${run}` })).body.error;
out.rerollInField = (await http("POST", "/town/affix/reroll", { ...rerollReq, operationId: `rr3_${run}`, expectedAffixes: chosen.body.result?.affixes })).body.error;
out.removeInField = (await http("POST", "/character/equipment/sigil/remove", { operationId: `rm2_${run}`, equipmentId: sword, socket: 0, expectedCost: 300 })).body.error;
F.sock.close();

bundle = (await http("GET", "/character")).body;
out.end = { coins: bundle.coins, swordSigils: bundle.equipment.find((e: Msg) => e.id === sword).sigils, foxSigils: bundle.bag["item:ember_fox_sigil"] ?? 0 };
console.log(JSON.stringify(out, null, 1));
process.exit(0);
