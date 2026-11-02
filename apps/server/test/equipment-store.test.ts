/**
 * Equipment on the D1 migrations (node:sqlite stand-in): drops become instances once, equip/unequip
 * with version checks, no changes during a fight, and gear locked for the fight then freed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_STARTER_EQUIPMENT, PRODUCTION_RULES, exampleContentMaps, type Entitlement, STARTER_KIT } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const content = exampleContentMaps();
let db: Db;
let store: CharacterStore;
let eco: Economy;

const kill = (battle: string, items: { itemId: string; quantity: number }[]): Entitlement => ({
  entitlementId: `${battle}:e1:defeated`,
  kind: "kill",
  enemyUnitId: "e1",
  speciesId: "species:armor_crab",
  originMode: "manual",
  items,
});
const pieces = (owner: string) =>
  db.prepare("SELECT id, definition_id, lock_state, lock_ref FROM equipment_instances WHERE owner_id = ? ORDER BY id").all(owner) as {
    id: string;
    definition_id: string;
    lock_state: string;
    lock_ref: string | null;
  }[];
const idOf = (owner: string, def: string) => pieces(owner).find((p) => p.definition_id === def)!.id;

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  store = new CharacterStore(d1, PRODUCTION_RULES, content, () => "2026-10-03T00:00:00Z");
  eco = new Economy(d1, PRODUCTION_RULES, () => "2026-10-03T00:00:00Z");
  await eco.devGrant("seed:a", A, {});
  await eco.devGrant("seed:b", B, {});
  await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:arcanist", raceId: "race:human", element: "WATER" });
  await store.devGrantEquipment("devgear:a", A, DEV_STARTER_EQUIPMENT);
  await store.devGrantEquipment("devgear:b", B, ["equip:wooden_sword"]);
});

describe("equipment grants", () => {
  it("a kill line with equipment makes one instance per piece, once, and no item balance", async () => {
    const e = kill("battle:1", [
      { itemId: "item:crab_shell", quantity: 1 },
      { itemId: "equip:crab_buckler", quantity: 2 },
    ]);
    expect(await eco.grant(e, A)).toMatchObject({ status: "granted" });
    expect(await eco.grant(e, A)).toMatchObject({ status: "already_granted" });
    await Promise.all([eco.grant(e, A), eco.grant(e, A)]);
    expect(pieces(A).filter((p) => p.definition_id === "equip:crab_buckler")).toHaveLength(2);
    expect(await eco.balance(A, "equip:crab_buckler")).toBe(0);
    expect(await eco.balance(A, "item:crab_shell")).toBe(1);
  });

  it("a dropped piece gets a rarity and affixes from its pool, kept on a retried grant", async () => {
    const e = kill("battle:r", [{ itemId: "equip:ember_fang_dagger", quantity: 3 }]);
    expect(await eco.grant(e, A)).toMatchObject({ status: "granted" });
    const read = () =>
      db.prepare("SELECT id, rarity, affixes_json FROM equipment_instances WHERE owner_id = ? AND definition_id = ? ORDER BY id").all(A, "equip:ember_fang_dagger") as { id: string; rarity: string; affixes_json: string }[];
    const first = read();
    expect(first).toHaveLength(3);
    const pool = content.affixPools.get("affix:weapon_physical")!;
    for (const r of first) {
      const affixes = JSON.parse(r.affixes_json) as { stat: string; value: number }[];
      expect(affixes).toHaveLength(PRODUCTION_RULES.provisional.affixCountByRarity.value[r.rarity as "COMMON"]);
      for (const a of affixes) expect(pool.entries.map((x) => x.stat)).toContain(a.stat);
    }
    await Promise.all([eco.grant(e, A), eco.grant(e, A)]);
    expect(read()).toEqual(first);
    // The equipment list and the fight both see them.
    const views = await store.equipment(A);
    expect(views.find((v) => v.id === first[0]!.id)).toMatchObject({ rarity: first[0]!.rarity, affixes: JSON.parse(first[0]!.affixes_json) });
  });

  it("dev starter gear is granted once", async () => {
    await store.devGrantEquipment("devgear:a", A, DEV_STARTER_EQUIPMENT);
    // The character also came with the starter kit (shop.ts).
    expect(pieces(A)).toHaveLength(DEV_STARTER_EQUIPMENT.length + STARTER_KIT.equipment.length);
  });
});

describe("equip", () => {
  it("wears and takes off pieces, bumping the version, and lists where each piece is", async () => {
    const staff = idOf(A, "equip:apprentice_staff");
    const tunic = idOf(A, "equip:cloth_tunic");
    const r1 = await store.equip(A, { expectedVersion: 1, slot: "MAIN_HAND", instanceId: staff });
    expect(r1).toMatchObject({ status: "saved", character: { version: 2 } });
    const r2 = await store.equip(A, { expectedVersion: 2, slot: "ARMOR", instanceId: tunic });
    expect(r2.status).toBe("saved");
    if (r2.status !== "saved") return;
    expect(r2.equipment.filter((e) => e.slot !== null).map((e) => [e.slot, e.id])).toEqual(
      expect.arrayContaining([
        ["MAIN_HAND", staff],
        ["ARMOR", tunic],
      ]),
    );
    const off = await store.equip(A, { expectedVersion: 3, slot: "ARMOR", instanceId: null });
    expect(off.status === "saved" && off.equipment.find((e) => e.id === tunic)?.slot).toBeNull();
  });

  it("the two-hand bow replaces sword and shield in one write", async () => {
    await eco.grant(kill("battle:2", [{ itemId: "equip:crab_buckler", quantity: 1 }]), A);
    db.prepare("UPDATE characters SET level = 4 WHERE account_id = ?").run(A);
    await store.equip(A, { expectedVersion: 1, slot: "MAIN_HAND", instanceId: idOf(A, "equip:wooden_sword") });
    expect((await store.equip(A, { expectedVersion: 2, slot: "OFF_HAND", instanceId: idOf(A, "equip:crab_buckler") })).status).toBe("saved");
    const r = await store.equip(A, { expectedVersion: 3, slot: "MAIN_HAND", instanceId: idOf(A, "equip:training_bow") });
    expect(r.status === "saved" && r.equipment.filter((e) => e.slot !== null).map((e) => e.definitionId)).toEqual(["equip:training_bow"]);
    expect((await store.equip(A, { expectedVersion: 4, slot: "OFF_HAND", instanceId: idOf(A, "equip:crab_buckler") })).status === "rejected").toBe(true);
  });

  it("refuses someone else's piece, the wrong slot, a too-high level and bad input", async () => {
    expect(await store.equip(A, { expectedVersion: 1, slot: "MAIN_HAND", instanceId: idOf(B, "equip:wooden_sword") })).toMatchObject({ reason: "NOT_OWNER" });
    expect(await store.equip(A, { expectedVersion: 1, slot: "FEET", instanceId: idOf(A, "equip:wooden_sword") })).toMatchObject({ reason: "SLOT_MISMATCH" });
    await eco.grant(kill("battle:3", [{ itemId: "equip:ember_fang_dagger", quantity: 1 }]), A);
    expect(await store.equip(A, { expectedVersion: 1, slot: "MAIN_HAND", instanceId: idOf(A, "equip:ember_fang_dagger") })).toMatchObject({ reason: "LEVEL_TOO_LOW" });
    expect(await store.equip(A, { expectedVersion: 1, slot: "TAIL", instanceId: null })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await store.equip(B, { expectedVersion: 1, slot: "MAIN_HAND", instanceId: idOf(B, "equip:wooden_sword") })).toMatchObject({ reason: "NO_CHARACTER" });
    expect((await store.get(A))!.version).toBe(1);
  });

  it("of two writes from the same version only one lands; the team and gear share the version", async () => {
    const sword = idOf(A, "equip:wooden_sword");
    const tunic = idOf(A, "equip:cloth_tunic");
    const [x, y] = await Promise.all([
      store.equip(A, { expectedVersion: 1, slot: "MAIN_HAND", instanceId: sword }),
      store.equip(A, { expectedVersion: 1, slot: "ARMOR", instanceId: tunic }),
    ]);
    expect([x.status, y.status].sort()).toEqual(["rejected", "saved"]);
    expect([x, y].find((r) => r.status === "rejected")).toMatchObject({ reason: "STALE_VERSION" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM character_equipment").get()).toEqual({ n: 1 });
    expect(await store.setTeam(A, { expectedVersion: 1, companionIds: [] })).toMatchObject({ reason: "STALE_VERSION" });
  });
});

describe("gear during fights", () => {
  const rid = "res:battle:g";
  it("cannot change gear in a fight; worn gear is locked to the fight and freed at settle", async () => {
    const sword = idOf(A, "equip:wooden_sword");
    await store.equip(A, { expectedVersion: 1, slot: "MAIN_HAND", instanceId: sword });
    const loadout = (await store.loadout(A))!;
    expect(loadout.equipmentIds).toEqual([sword]);
    expect(loadout.worn.mainHand?.id).toBe("equip:wooden_sword");

    const reserved = await eco.reserve({ reservationId: rid, accountId: A, battleId: "battle:g", bag: {}, companionIds: [], characterId: loadout.character.id, equipmentIds: loadout.equipmentIds });
    expect(reserved.status).toBe("reserved");
    expect(pieces(A).find((p) => p.id === sword)).toMatchObject({ lock_state: "in_battle", lock_ref: rid });
    expect(await store.equip(A, { expectedVersion: 2, slot: "MAIN_HAND", instanceId: null })).toMatchObject({ reason: "IN_BATTLE" });
    // A second reservation cannot take locked gear even if it got past the open-battle rule.
    expect(await eco.reserve({ reservationId: "res:other", accountId: A, battleId: "battle:o", bag: {}, companionIds: [], equipmentIds: [sword] })).toMatchObject({ status: "rejected" });

    await eco.activate(rid);
    const settled = await eco.settle({ reservationId: rid, battleId: "battle:g", accountId: A, outcome: "victory", unused: {}, allies: [], entitlementIds: [] });
    expect(settled.status).toBe("settled");
    expect(pieces(A).find((p) => p.id === sword)).toMatchObject({ lock_state: "free", lock_ref: null });
    expect((await store.equip(A, { expectedVersion: 2, slot: "MAIN_HAND", instanceId: null })).status).toBe("saved");
  });

  it("release frees gear too, and reserve refuses gear the account does not own", async () => {
    const sword = idOf(A, "equip:wooden_sword");
    await eco.reserve({ reservationId: rid, accountId: A, battleId: "battle:g", bag: {}, companionIds: [], equipmentIds: [sword] });
    expect((await eco.release(rid)).status).toBe("released");
    expect(pieces(A).find((p) => p.id === sword)?.lock_state).toBe("free");
    expect(await eco.reserve({ reservationId: "res:b", accountId: A, battleId: "battle:b", bag: {}, companionIds: [], equipmentIds: [idOf(B, "equip:wooden_sword")] })).toMatchObject({ reason: "NOT_OWNER" });
  });
});
