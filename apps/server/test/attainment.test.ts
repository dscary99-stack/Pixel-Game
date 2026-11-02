/**
 * The attainment quest เควสบรรลุ (attainment.ts, A150) on the D1 migrations: it opens the secret set
 * only with Lv200, a Class3 and the divine awakening, in town and outside fights. The same operation
 * id replays, another report finds the set open, and two reports racing open it once.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EXAMPLE_SECRET_QUEST_TEMPLATES as T, PRODUCTION_RULES as R, attainmentView, exampleContentMaps, exampleMapRegistry, exampleSecretRewardRegistry } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { SecretProgressStore } from "../src/secret-progress-store";
import { SecretQuestStore } from "../src/secret-quest-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const content = exampleContentMaps();
const now = () => "2026-10-11T15:00:00.000Z";
let db: Db;
let chars: CharacterStore;
let secrets: SecretQuestStore;
let progress: SecretProgressStore;
let eco: Economy;

const at = (mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(A, mapId);
const attain = (operationId: string) => progress.attain(A, { operationId });
const view = async () => attainmentView(R, (await chars.get(A))!, !(await secrets.view(A))!.locked);

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  eco = new Economy(d1, R, now);
  secrets = new SecretQuestStore(d1, R, T, { ...content, maps: exampleMapRegistry(), frontierFloors: R.confirmed.frontierFloors.value, rewards: exampleSecretRewardRegistry() }, "test-key", now);
  chars = new CharacterStore(d1, R, content, now, secrets);
  progress = new SecretProgressStore(d1, R, { species: content.species, equipment: content.equipment, rewards: exampleSecretRewardRegistry() }, [TOWN], now);
  await chars.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  at(TOWN);
});

describe("the attainment quest (เควสบรรลุ)", () => {
  it("needs Lv200, a Class3 and the divine awakening, step by step; then opens the secret set once", async () => {
    expect(await view()).toMatchObject({ ready: false, opened: false, steps: [{ id: "level", done: false }, { id: "class3", done: false }, { id: "ascended", done: false }] });
    expect(await attain("attain_01")).toMatchObject({ status: "rejected", reason: "LEVEL_TOO_LOW" });
    await chars.devRaiseLevel(A, 200);
    expect(await attain("attain_01")).toMatchObject({ status: "rejected", reason: "NO_CLASS3" });
    await chars.devSetClasses(A, "class2:bastion", "class3:aegis_sovereign");
    expect(await attain("attain_01")).toMatchObject({ status: "rejected", reason: "NOT_ASCENDED" });
    db.prepare(`UPDATE characters SET ascension_id = 'ascend:stonekin:a' WHERE account_id = ?`).run(A);
    expect(await view()).toMatchObject({ ready: true, opened: false });
    expect(await secrets.view(A)).toEqual({ locked: true });

    expect(await attain("attain_01")).toEqual({ status: "done", replayed: false, result: { opened: true } });
    expect(await attain("attain_01")).toEqual({ status: "done", replayed: true, result: { opened: true } });
    expect(await attain("attain_02")).toMatchObject({ status: "rejected", reason: "ALREADY_OPEN" });
    expect(await secrets.view(A)).toMatchObject({ locked: false });
    expect(await view()).toMatchObject({ ready: false, opened: true });
  });

  it("only in town and outside fights; nothing opens on a refusal", async () => {
    await chars.devRaiseLevel(A, 200);
    await chars.devSetClasses(A, "class2:bastion", "class3:aegis_sovereign");
    db.prepare(`UPDATE characters SET ascension_id = 'ascend:stonekin:b' WHERE account_id = ?`).run(A);
    at("map:dawn_field");
    expect(await attain("attain_01")).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    at(TOWN);
    const c = (await chars.get(A))!;
    await eco.reserve({ reservationId: "res:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: [], characterId: c.id });
    expect(await attain("attain_01")).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
    expect(await secrets.view(A)).toEqual({ locked: true });
    await eco.release("res:x");
    expect(await attain("attain_01")).toMatchObject({ status: "done", replayed: false });
  });

  it("two reports at the same time open the set once", async () => {
    await chars.devRaiseLevel(A, 200);
    await chars.devSetClasses(A, "class2:bastion", "class3:aegis_sovereign");
    db.prepare(`UPDATE characters SET ascension_id = 'ascend:stonekin:a' WHERE account_id = ?`).run(A);
    const results = await Promise.all([attain("attain_01"), attain("attain_02")]);
    expect(results.filter((r) => r.status === "done")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason === "ALREADY_OPEN")).toHaveLength(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM character_secret_quests WHERE revealed_at IS NOT NULL`).get()).toEqual({ n: 1 });
  });
});
