/**
 * Deleting a character (Nut 2026-10-18: everything it had is lost, except what is in the account vault) on
 * the D1 migrations (node:sqlite stand-in): the typed name and the password are checked, a fight blocks it,
 * listings and its own offers close without returning anything, offers to it go back to their proposers,
 * a retry replays, two deletes land once, and the freed place starts a new character from nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps, marketFee, playAccountId, type RulesConfig } from "@pmrpg/shared";
import { AccountStore, type Session } from "../src/account-store";
import { afterCharacterDeleted } from "../src/character-delete";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { MarketStore, TradeStore } from "../src/exchange-store";
import { PartyStore } from "../src/party-store";
import { TownServices } from "../src/town-services";
import { VaultStore } from "../src/vault-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const FAST = { ...R, provisional: { ...R.provisional, login: { ...R.provisional.login, value: { ...R.provisional.login.value, pbkdf2Iterations: 1000 } } } } as unknown as RulesConfig;
const TOWN = "map:dawn_town";
const POTION = "item:small_potion";
const B = "acct:b";
const content = exampleContentMaps();

let db: Db;
let accounts: AccountStore;
let store: CharacterStore;
let town: TownServices;
let vault: VaultStore;
let market: MarketStore;
let trade: TradeStore;
let parties: PartyStore;
let n = 0;

const one = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as T;
const bag = (acct: string) => one<{ n: number }>("SELECT COALESCE(SUM(delta), 0) AS n FROM item_ledger WHERE account_id = ? AND item_id = ?", acct, POTION).n;
const at = (account: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(account, TOWN);
const create = async (acct: string, name: string) => {
  const r = await store.create(acct, { operationId: `op_create_${acct.replace(/\W/g, "")}`.slice(0, 64), name, classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  expect(r.status).toBe("created");
  at(acct);
};
const pick = async (s: Session, slot: number) => {
  const r = await accounts.select(s, { slot });
  if (r.status !== "ok") throw new Error(r.reason);
  return r.accountId;
};

let token: string;
let session: Session;
let A: string;
let C: string;

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const clock = () => "2026-10-18T00:00:00.000Z";
  accounts = new AccountStore(d1, FAST, () => Date.parse("2026-10-18T00:00:00Z"), () => `u${String(++n).padStart(20, "0")}`);
  store = new CharacterStore(d1, R, content, clock);
  town = new TownServices(d1, R, content, [TOWN], clock);
  vault = new VaultStore(d1, R, content, [TOWN], clock);
  market = new MarketStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock);
  const codes = ["AAAA2222", "BBBB3333", "CCCC4444", "DDDD5555"];
  trade = new TradeStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock, () => codes.shift() ?? "ZZZZ9999");
  parties = new PartyStore(d1, R, clock);
  const g = await accounts.register({ loginId: "nut_del", password: "correct horse" });
  if (g.status !== "ok") throw new Error(g.reason);
  token = g.grant.token;
  session = (await accounts.resolve(token))!;
  C = await pick(session, 2);
  await create(C, "ตัวรอง");
  A = await pick(session, 1);
  await create(A, "ตัวหลัก");
  session = (await accounts.resolve(token))!;
  await create(B, "คนอื่น");
  for (const acct of [A, B]) {
    await new Economy(d1, R, clock).devGrant(`seed:${acct.replace(/\W/g, "")}`, acct, { [POTION]: 5 });
    await town.devGrantCoins(`coins:${acct.replace(/\W/g, "")}`, acct, 9_900);
  }
});

const del = (s: Session, body: Record<string, unknown>) => accounts.deleteCharacter(s, { operationId: "chdel_00001", slot: 1, confirmName: "ตัวหลัก", password: "correct horse", ...body });

describe("deleting a character (Nut 2026-10-18)", () => {
  it("everything it had is lost except the vault; listings and its offers close; offers to it go back; the place starts over", async () => {
    expect(await vault.deposit(A, { operationId: "dep_000001", items: [{ itemId: POTION, quantity: 2 }], equipmentIds: [], coins: 1000 })).toMatchObject({ status: "done" });
    const listing = await market.list(A, { operationId: "list_00001", kind: "item", assetId: POTION, quantity: 1, price: 100, expectedFee: marketFee(R, 100) });
    if (listing.status !== "done") throw new Error(listing.message);
    const codeA = (await trade.code(A))!;
    const codeB = (await trade.code(B))!;
    const fromA = await trade.offer(A, { operationId: "offer_a001", kind: "item", toCode: codeB, give: { items: [{ itemId: POTION, quantity: 1 }] }, want: {} });
    const toA = await trade.offer(B, { operationId: "offer_b001", kind: "item", toCode: codeA, give: { items: [{ itemId: POTION, quantity: 3 }] }, want: {} });
    if (fromA.status !== "done" || toA.status !== "done") throw new Error("offers");
    const bBefore = bag(B);
    const party = await parties.create(A);
    if (party.status !== "ok" || party.party === null) throw new Error("party");
    await parties.join(B, { partyId: party.party.partyId });

    // The typed name and the password are checked first; an empty place has nothing to delete.
    expect(await del(session, { confirmName: "ตัวหลั" })).toMatchObject({ status: "rejected", reason: "NAME_MISMATCH" });
    expect(await del(session, { password: "wrong horse" })).toMatchObject({ status: "rejected", reason: "BAD_CREDENTIALS" });
    expect(await del(session, { password: undefined })).toMatchObject({ status: "rejected", reason: "BAD_CREDENTIALS" });
    expect(await del(session, { slot: 5 })).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
    expect(await del(session, { slot: 11 })).toMatchObject({ status: "rejected", reason: "INVALID_REQUEST" });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM deleted_characters").n).toBe(0);

    const r = await del(session, {});
    expect(r).toMatchObject({ status: "ok", accountId: A, account: { selectedSlot: null } });
    await afterCharacterDeleted(A, trade, parties);
    expect(r.status === "ok" && r.account.slots[0]!.character).toBeNull();
    expect((await accounts.resolve(token))!.accountId).toBeNull();
    expect(one<{ status: string }>("SELECT status FROM market_listings WHERE id = ?", listing.result.listingId).status).toBe("cancelled");
    expect(one<{ status: string }>("SELECT status FROM trade_offers WHERE id = ?", fromA.result.offerId).status).toBe("cancelled");
    expect(one<{ status: string }>("SELECT status FROM trade_offers WHERE id = ?", toA.result.offerId).status).toBe("declined");
    expect(bag(B)).toBe(bBefore + 3);
    expect((await parties.view(B))?.members.map((m) => m.accountId)).toEqual([B]);
    expect(one<{ trade_code: string | null }>("SELECT trade_code FROM characters WHERE account_id = ?", A).trade_code).toBeNull();
    expect(await trade.offer(B, { operationId: "offer_b002", kind: "item", toCode: codeA, give: { items: [{ itemId: POTION, quantity: 1 }] }, want: {} })).toMatchObject({
      status: "rejected",
      reason: "NO_SUCH_PLAYER",
    });

    // The vault stays with the login: the other character sees the deposit and its history.
    const v = (await vault.view(C))!;
    expect(v.items).toEqual([expect.objectContaining({ itemId: POTION, quantity: 2 })]);
    expect(v.coins).toBe(1000);
    expect(v.history).toEqual([expect.objectContaining({ kind: "deposit", characterName: "ตัวหลัก" })]);

    // A retry replays (and the clean-up again does nothing); the same id for another place is refused.
    expect(await del(session, {})).toMatchObject({ status: "ok", accountId: A });
    await afterCharacterDeleted(A, trade, parties);
    expect(bag(B)).toBe(bBefore + 3);
    expect(await del(session, { slot: 2, confirmName: "ตัวรอง" })).toMatchObject({ status: "rejected", reason: "INVALID_REQUEST" });

    // The place gets a new play account: a new character there starts from nothing.
    const fresh = await pick(session, 1);
    expect(fresh).toBe(playAccountId(session.userId, 1, 1));
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM characters WHERE account_id = ?", fresh).n).toBe(0);
    await create(fresh, "ตัวใหม่");
    expect(bag(fresh)).toBe(bag(C));
    expect(await town.coins(fresh)).toBe(await town.coins(C));
    expect((await vault.view(fresh))!.coins).toBe(1000);
    expect((await accounts.view(session.userId, 1)).slots.slice(0, 2).map((s) => s.character?.name)).toEqual(["ตัวใหม่", "ตัวรอง"]);
  });

  it("not during a fight: nothing changes", async () => {
    db.prepare("INSERT INTO battle_reservations (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at) VALUES ('r', ?, 'b', 'active', '{}', '{}', 't', 't')").run(A);
    expect(await del(session, {})).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM user_characters WHERE account_id = ?", A).n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM deleted_characters").n).toBe(0);
  });

  it("two deletes at once (different ids) land once; another sign-in playing it goes back to the character screen", async () => {
    const g2 = await accounts.passwordLogin({ loginId: "nut_del", password: "correct horse" });
    if (g2.status !== "ok") throw new Error(g2.reason);
    const other = (await accounts.resolve(g2.grant.token))!;
    await pick(other, 1);
    const both = await Promise.all([del(session, {}), del(other, { operationId: "chdel_00002" })]);
    expect(both.map((x) => x.status).sort()).toEqual(["ok", "rejected"]);
    expect(both.find((x) => x.status === "rejected")).toMatchObject({ reason: "NOT_FOUND" });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM deleted_characters").n).toBe(1);
    expect((await accounts.resolve(g2.grant.token))!.accountId).toBeNull();
    // Picking the place again from both sign-ins at once makes one new play account.
    const again = await Promise.all([pick(session, 1), pick(other, 1)]);
    expect(again[0]).toBe(again[1]);
    expect(again[0]).toBe(playAccountId(session.userId, 1, 1));
  });

  it("a Google sign-in needs only the name", async () => {
    const g = await accounts.externalLogin("google", "google-sub-del");
    const s = (await accounts.resolve(g.token))!;
    const acct = await pick(s, 3);
    await create(acct, "กูเกิล");
    expect(await accounts.deleteCharacter(s, { operationId: "chdel_g0001", slot: 3, confirmName: "กูเกิล" })).toMatchObject({ status: "ok", accountId: acct });
  });
});
