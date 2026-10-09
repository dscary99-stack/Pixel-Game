/**
 * Mailbox (Nut 2026-10-09) on the D1 migrations (node:sqlite stand-in): a letter's items, coins and
 * companion are taken once in one claim (a retry replays, racing claims get one winner), not during a
 * fight, not past 30 days, and a companion needs room in the box (P26); a secret-quest companion that
 * finds the box full waits in the mailbox; a market sale leaves the seller a notice.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_MAIL, EXAMPLE_SECRET_QUEST_TEMPLATES as T, PRODUCTION_RULES, exampleContentMaps, exampleMapRegistry, exampleSecretRewardRegistry, marketFee, type RulesConfig, type SecretQuest } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { MarketStore, type ExchangeContent } from "../src/exchange-store";
import { MailStore } from "../src/mail-store";
import { SecretProgressStore } from "../src/secret-progress-store";
import { SecretQuestStore } from "../src/secret-quest-store";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const R = PRODUCTION_RULES;
const noRoom = { ...R, provisional: { ...R.provisional, companionBox: { ...R.provisional.companionBox, value: { capacity: 0 } } } } as unknown as RulesConfig;
const A = "acct:a";
const B = "acct:b";
const TOWN = "map:dawn_town";
const POTION = "item:small_potion";
const base = exampleContentMaps();
const content: ExchangeContent = { items: base.items, equipment: base.equipment, species: base.species };
const rewards = exampleSecretRewardRegistry();

let db: Db;
let d1: SqliteD1;
let clock: string;
const now = () => clock;
let eco: Economy;
let mail: MailStore;
let sq: SecretQuestStore;

const one = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as T;
const coins = (acct: string) => one<{ n: number }>("SELECT COALESCE(SUM(delta), 0) AS n FROM coin_ledger WHERE account_id = ?", acct).n;
const pet = {
  id: "mon:mail:gift:0",
  speciesId: "species:supply_mole",
  level: 1,
  element: "EARTH" as const,
  primaryStats: { STR: 5, VIT: 5, INT: 5, DEX: 5, AGI: 5, SPI: 5 },
  origin: { kind: "mail" },
  growthSeed: "seed",
  growthVersion: 1,
};
const gift = (id = "mail:gift") => mail.send({ mailId: id, accountId: A, source: "system", title: "ของขวัญ", payload: { items: { [POTION]: 3 }, coins: 500, equipment: [], companions: [{ ...pet, id: `mon:${id}:0` }] } });
const claim = (op: string, ids = ["mail:gift"], store = mail) => store.claim(A, { operationId: op, mailIds: ids });

beforeEach(async () => {
  clock = "2026-10-09T00:00:00.000Z";
  db = freshDb();
  d1 = new SqliteD1(db);
  eco = new Economy(d1, R, now);
  mail = new MailStore(d1, R, content, now);
  sq = new SecretQuestStore(d1, R, T, { ...base, maps: exampleMapRegistry(), frontierFloors: R.confirmed.frontierFloors.value, rewards }, "test-key", now);
  for (const acct of [A, B]) {
    const r = await new CharacterStore(d1, R, base, now, sq).create(acct, { operationId: `op_create_${acct.slice(5)}`, name: `ตัว${acct.slice(5)}`, classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
    expect(r.status).toBe("created");
    db.prepare(`INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')`).run(acct, TOWN);
  }
});

describe("mailbox", () => {
  it("a claim takes items, coins and the companion once; a retry replays; the letter cannot pay twice", async () => {
    await gift();
    expect(await mail.view(A)).toMatchObject({ unclaimed: 1, letters: [{ mailId: "mail:gift", coins: 500, items: [{ itemId: POTION, quantity: 3 }], companions: [{ speciesId: "species:supply_mole", level: 1 }] }] });
    const [p0, c0] = [eco.balance(A, POTION), coins(A)];
    expect(await claim("op_claim_01")).toMatchObject({ status: "done", replayed: false, result: { coins: 500, companionIds: ["mon:mail:gift:0"] } });
    expect(await claim("op_claim_01")).toMatchObject({ status: "done", replayed: true });
    expect(await claim("op_claim_02")).toMatchObject({ status: "rejected", reason: "CLOSED" });
    expect([await eco.balance(A, POTION), coins(A)]).toEqual([(await p0) + 3, c0 + 500]);
    expect(one<{ owner_id: string }>("SELECT owner_id FROM monster_instances WHERE id = 'mon:mail:gift:0'").owner_id).toBe(A);
    expect((await mail.view(A))!.unclaimed).toBe(0);
  });

  it("claims racing for one letter: exactly one pays", async () => {
    await gift();
    const c0 = coins(A);
    const rs = await Promise.all(["op_race_001", "op_race_002", "op_race_003"].map((op) => claim(op)));
    expect(rs.filter((r) => r.status === "done")).toHaveLength(1);
    expect(coins(A)).toBe(c0 + 500);
  });

  it("not during a fight, not after it expires, not someone else's letter", async () => {
    await gift();
    db.prepare("INSERT INTO battle_reservations (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at) VALUES ('res:x', ?, 'b:x', 'active', '{}', '{}', 't', 't')").run(A);
    expect(await claim("op_claim_03")).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
    db.prepare(`DELETE FROM battle_reservations`).run();
    expect(await mail.claim(B, { operationId: "op_claim_04", mailIds: ["mail:gift"] })).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
    clock = "2026-11-09T00:00:00.000Z";
    expect(await claim("op_claim_05")).toMatchObject({ status: "rejected", reason: "EXPIRED" });
    expect((await mail.view(A))!.letters).toHaveLength(0);
  });

  it("a companion needs room in the box; until claimed it is not in the box", async () => {
    await gift();
    const full = new MailStore(d1, noRoom, content, now);
    expect(await claim("op_claim_06", ["mail:gift"], full)).toMatchObject({ status: "rejected", reason: "COMPANION_BOX_FULL" });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM monster_instances WHERE owner_id = ?", A).n).toBe(0);
    expect(await claim("op_claim_07")).toMatchObject({ status: "done" });
  });

  it("a notice with nothing in it can be marked read and is not counted as unclaimed", async () => {
    await mail.send({ mailId: "mail:note", accountId: A, source: "system", title: "ประกาศ", payload: EMPTY_MAIL });
    expect((await mail.view(A))!.unclaimed).toBe(0);
    expect(await claim("op_claim_08", ["mail:note"])).toMatchObject({ status: "done", result: { coins: 0 } });
  });
});

describe("senders", () => {
  it("a market sale leaves the seller a notice (once)", async () => {
    const town = new TownServices(d1, R, base, [TOWN], now);
    await town.devGrantCoins("coins:b", B, 5_000);
    const market = new MarketStore(d1, R, content, [TOWN], async () => {}, now);
    const listed = await market.list(A, { operationId: "op_list_001", kind: "item", assetId: POTION, quantity: 2, price: 100, expectedFee: marketFee(R, 100) });
    if (listed.status !== "done") throw new Error(listed.message);
    expect(await market.buy(B, { operationId: "op_buy_0001", listingId: listed.result.listingId, expectedPrice: 100 })).toMatchObject({ status: "done" });
    expect(await market.buy(B, { operationId: "op_buy_0001", listingId: listed.result.listingId, expectedPrice: 100 })).toMatchObject({ replayed: true });
    const letters = (await mail.view(A))!.letters;
    expect(letters).toHaveLength(1);
    expect(letters[0]).toMatchObject({ source: "market_sale", coins: 0 });
    expect(letters[0]!.title).toContain("ยาเล็ก");
  });

  it("a secret-quest companion that finds the box full waits in the mailbox, then joins once there is room", async () => {
    const quest: SecretQuest = { id: "sq:personal:gift", kind: "personal", templateId: "sqt:personal_offering", goal: "deliver", params: { count: 1, itemId: POTION }, rewards: [{ kind: "companion", rewardId: "srw:companion_gilded_mole", variantId: "v0000abcf", innateId: "skill:bird_innate_resist" }] };
    const other: SecretQuest = { id: "sq:element:x", kind: "element", templateId: "sqt:element_fire", goal: "win", params: { count: 99 }, rewards: [{ kind: "fashion", rewardId: "srw:fashion_star_aura", variantId: "v0000abce" }] };
    const ch = one<{ id: string }>("SELECT id FROM characters WHERE account_id = ?", A).id;
    db.prepare("UPDATE character_secret_quests SET quests_json = ? WHERE character_id = ?").run(JSON.stringify([quest, other]), ch);
    await sq.devReveal(A);
    const progress = new SecretProgressStore(d1, noRoom, { species: base.species, equipment: base.equipment, rewards }, [TOWN], now);
    expect(await progress.deliver(A, { operationId: "op_give_0001", questId: quest.id, quantity: 1 })).toMatchObject({ status: "done" });
    expect(await progress.claim(A, { questId: quest.id })).toMatchObject({ status: "done", result: { mailed: true } });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM monster_instances WHERE owner_id = ?", A).n).toBe(0);
    const letter = (await mail.view(A))!.letters.find((l) => l.source === "secret_reward")!;
    expect(letter.companions).toEqual([{ speciesId: "species:supply_mole", name: expect.any(String), level: 1 }]);
    expect(await claim("op_claim_09", [letter.mailId])).toMatchObject({ status: "done", result: { companionIds: [`mon:secret:${ch}:${quest.id}:0`] } });
    expect(JSON.parse(one<{ origin_json: string }>("SELECT origin_json FROM monster_instances WHERE owner_id = ?", A).origin_json)).toMatchObject({ kind: "secret_reward" });
  });
});
