// End-to-end town services against `wrangler dev`: install a Sigil, remove it for coins in town,
// sell to the NPC, and the same requests refused in the field.
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
T.sock.close();
await sleep(300);

// 4. In the field the shop and removal are closed; installing still works outside fights.
const F = await toField(account);
await F.wait((m) => m.t === "packs");
out.sellInField = (await http("POST", "/town/sell", { operationId: `sell3_${run}`, lines: [{ itemId: "item:small_potion", quantity: 1 }] })).body.error;
out.installInField = (await http("POST", "/character/equipment/sigil", { ...install, operationId: `inst4_${run}` })).status;
out.removeInField = (await http("POST", "/character/equipment/sigil/remove", { operationId: `rm2_${run}`, equipmentId: sword, socket: 0, expectedCost: 300 })).body.error;
F.sock.close();

bundle = (await http("GET", "/character")).body;
out.end = { coins: bundle.coins, swordSigils: bundle.equipment.find((e: Msg) => e.id === sword).sigils, foxSigils: bundle.bag["item:ember_fox_sigil"] ?? 0 };
console.log(JSON.stringify(out, null, 1));
process.exit(0);
