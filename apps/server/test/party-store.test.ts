/**
 * Parties on the D1 migrations (node:sqlite stand-in): size cap and one party per account under races.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { PartyStore } from "../src/party-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

let db: Db;
let parties: PartyStore;
const who = ["a", "b", "c", "d", "e", "f"].map((x) => `acct:${x}`);

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const store = new CharacterStore(d1, R, exampleContentMaps(), () => "2026-10-03T00:00:00Z");
  for (const [i, id] of who.entries()) {
    await store.create(id, { operationId: `op_create_${i}x`, name: `ผู้เล่น${i}`, classId: "class:striker", raceId: "race:human", element: "FIRE" });
  }
  let n = 0;
  parties = new PartyStore(d1, R, () => "2026-10-03T00:00:00Z", () => `pt_${String(++n).padStart(10, "0")}`);
});

describe("party (P02)", () => {
  it("start, join by code, see members, leave; an empty party disappears", async () => {
    const made = await parties.create(who[0]!);
    if (made.status !== "ok" || made.party === null) throw new Error("create failed");
    const code = made.party.partyId;
    expect(await parties.create(who[0]!)).toMatchObject({ party: { partyId: code } });
    expect(await parties.join(who[1]!, { partyId: code })).toMatchObject({ status: "ok", party: { members: [{ name: "ผู้เล่น0" }, { name: "ผู้เล่น1" }] } });
    expect(await parties.partners(who[1]!)).toEqual([who[0]]);
    expect(await parties.join(who[2]!, { partyId: "pt_zzzzzzzzzz" })).toMatchObject({ reason: "NO_SUCH_PARTY" });
    await parties.create(who[2]!);
    expect(await parties.join(who[2]!, { partyId: code })).toMatchObject({ reason: "ALREADY_IN_PARTY" });
    await parties.leave(who[0]!);
    await parties.leave(who[1]!);
    expect(db.prepare("SELECT COUNT(*) AS n FROM parties WHERE id = ?").get(code)).toEqual({ n: 0 });
  });

  it("at most 5 (Nut 2026-10-07): two players racing for the last place, one gets in", async () => {
    const made = await parties.create(who[0]!);
    const code = made.status === "ok" ? made.party!.partyId : "";
    await parties.join(who[1]!, { partyId: code });
    await parties.join(who[2]!, { partyId: code });
    await parties.join(who[3]!, { partyId: code });
    const r = await Promise.all([parties.join(who[4]!, { partyId: code }), parties.join(who[5]!, { partyId: code })]);
    expect(r.map((x) => x.status).sort()).toEqual(["ok", "rejected"]);
    expect(r.find((x) => x.status === "rejected")).toMatchObject({ reason: "PARTY_FULL" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?").get(code)).toEqual({ n: 5 });
  });

  it("counts only partners who started a fight in the window", async () => {
    const made = await parties.create(who[0]!);
    const code = made.status === "ok" ? made.party!.partyId : "";
    await parties.join(who[1]!, { partyId: code });
    await parties.join(who[2]!, { partyId: code });
    const claim = (acct: string, at: string) =>
      db.prepare("INSERT INTO encounter_claims (account_id, pack_instance_id, battle_id, roster_json, created_at) VALUES (?, ?, ?, '[]', ?)").run(acct, `p:${acct}:${at}`, `battle:${acct}:${at}`, at);
    claim(who[1]!, "2026-10-03T00:10:00.000Z");
    claim(who[2]!, "2026-10-03T00:01:00.000Z");
    expect(await parties.recentlyFought([who[1]!, who[2]!], "2026-10-03T00:05:00.000Z")).toEqual(new Set([who[1]]));
  });
});
