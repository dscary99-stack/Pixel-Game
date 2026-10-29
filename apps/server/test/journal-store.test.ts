/**
 * Collection / Journal (chapter 09) on the D1 migrations (node:sqlite stand-in): records kept apart,
 * history kept after a companion leaves, titles only when earned.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps, type Entitlement } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { JournalStore } from "../src/journal-store";
import { RewardLedger } from "../src/reward-ledger";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const content = exampleContentMaps();
let db: Db;
let journal: JournalStore;
let ledger: RewardLedger;

const kill = (n: number, speciesId: string, items: { itemId: string; quantity: number }[] = []): Entitlement => ({
  entitlementId: `battle:${n}:e1:defeated`,
  kind: "kill",
  enemyUnitId: "e1",
  speciesId,
  originMode: "manual",
  items,
});
const capture = (n: number, speciesId: string, element: "WATER" | "EARTH"): Entitlement => ({
  entitlementId: `battle:${n}:e1:captured`,
  kind: "capture",
  enemyUnitId: "e1",
  speciesId,
  element,
  level: 1,
});

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-05T00:00:00.000Z";
  journal = new JournalStore(d1, R, content, now);
  ledger = new RewardLedger(d1, R, now);
  await new Economy(d1, R, now).devGrant("seed:a", A, {});
  await new CharacterStore(d1, R, content, now).create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
});

describe("journal", () => {
  it("keeps met, defeated, captured, owned and element records apart", async () => {
    await journal.recordSeen(A, [
      { speciesId: "species:armor_crab", element: "WATER" },
      { speciesId: "species:armor_crab", element: "WATER" },
      { speciesId: "species:lantern_snail", element: "LIGHT" },
    ]);
    await journal.recordMap(A, "map:dawn_town");
    await journal.recordMap(A, "map:dawn_town");
    await ledger.grant(kill(1, "species:armor_crab"), A);
    await ledger.grant(kill(1, "species:armor_crab"), A);
    await ledger.grant(kill(2, "species:armor_crab"), A);
    await ledger.grant(capture(3, "species:armor_crab", "EARTH"), A);
    const v = (await journal.view(A))!;
    const crab = v.species.find((s) => s.speciesId === "species:armor_crab")!;
    expect(crab).toMatchObject({ seenElements: ["WATER"], defeated: 2, capturedPersonally: 1, capturedElements: ["EARTH"], ownedNow: 1, raisedLevel: 1 });
    expect(v.species.find((s) => s.speciesId === "species:lantern_snail")).toMatchObject({ seenElements: ["LIGHT"], defeated: 0, ownedNow: 0 });
    expect(v.maps).toEqual(["map:dawn_town"]);
    expect(await journal.view("acct:nobody")).toBeNull();
  });

  it("defeats and personal captures stay after the companion leaves; owned follows ownership", async () => {
    await ledger.grant(capture(4, "species:armor_crab", "WATER"), A);
    db.prepare("INSERT INTO accounts (id, created_at) VALUES ('acct:b', 'x') ON CONFLICT DO NOTHING").run();
    db.prepare("UPDATE monster_instances SET owner_id = 'acct:b' WHERE owner_id = ?").run(A);
    const crab = (await journal.view(A))!.species.find((s) => s.speciesId === "species:armor_crab")!;
    expect(crab).toMatchObject({ capturedPersonally: 1, capturedElements: ["WATER"], ownedNow: 0 });
  });

  it("titles: only earned ones can be shown, and none clears it", async () => {
    expect(await journal.setTitle(A, { titleId: "title:hunter" })).toMatchObject({ ok: false, code: "NOT_EARNED" });
    await journal.recordMap(A, "map:dawn_town");
    await journal.recordMap(A, "map:dawn_field");
    expect((await journal.view(A))!.titles).toEqual(["title:first_steps"]);
    expect(await journal.setTitle(A, { titleId: "title:first_steps" })).toEqual({ ok: true, titleId: "title:first_steps" });
    expect(await journal.title(A)).toBe("title:first_steps");
    expect(await journal.setTitle(A, { titleId: null })).toEqual({ ok: true, titleId: null });
    expect(await journal.setTitle(A, { titleId: "nope" })).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("counts Sigils received from drops and the ones worn", async () => {
    const sigilItem = [...content.items.values()].find((i) => i.kind === "sigil")!;
    await ledger.grant(kill(5, "species:ember_fox", [{ itemId: sigilItem.id, quantity: 1 }]), A);
    const v = (await journal.view(A))!;
    expect(v.sigilsReceived).toEqual({ [sigilItem.sigilId!]: 1 });
    expect(v.titles).toContain("title:sigil_finder");
  });
});
