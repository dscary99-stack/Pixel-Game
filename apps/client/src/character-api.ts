/**
 * Character and team requests (server mode). The server decides everything; the client shows
 * what it gets back. Identity uses the dev header until O11 picks auth.
 */
import { authHeaders, type Identity } from "./identity";
import type { AssetSnapshot, CharacterView, CreateCharacterRequest, MarketBrowseQuery, MarketKind, MarketView, TradeKind, TradeSide, TradeView, VaultView, MailView, DisposeQuote, EquipSlot, EquipmentView, FrontierView, PracticeView, MonsterInstance, JournalSummary, NpcOrder, PartyView, PrimaryStats, Profession, QuestBoardView, QuestReward, Rarity, RefineResult, RolledAffix, SecretQuestView } from "@pmrpg/shared";

export type StoredCompanion = MonsterInstance & { hp: number | null; mp: number | null };

export interface CharacterBundle {
  character: CharacterView;
  companions: StoredCompanion[];
  equipment: EquipmentView[];
  coins: number;
  /** Crafting mastery per profession (0..1000). */
  craftMastery: Record<Profession, number>;
  /** Cosmetic title shown before the name (chapter 09 journal). */
  titleId?: string | null;
  /** Item balances (materials, potions, capture items, Sigils). */
  bag: Record<string, number>;
}

/** One id per player action: a retried request with it can never apply twice. */
const opId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class CharacterApi {
  constructor(
    private readonly base: string,
    private readonly identity: Identity,
  ) {}

  /** The caller's character, or null when they have not made one yet. */
  async get(): Promise<CharacterBundle | null> {
    try {
      return await this.call<CharacterBundle>("GET", "/character");
    } catch (e) {
      if (e instanceof ApiError && e.code === "NO_CHARACTER") return null;
      throw e;
    }
  }

  create(req: Omit<CreateCharacterRequest, "operationId">, operationId: string) {
    return this.call<{ character: CharacterView }>("POST", "/character", { ...req, operationId });
  }

  /** Save the team; `formation` places each companion (omitted: the server's default formation). */
  setTeam(expectedVersion: number, companionIds: string[], formation?: { instanceId: string; row: "front" | "back"; slot: number }[]) {
    return this.call<{ character: CharacterView }>("PUT", "/character/team", { expectedVersion, companionIds, ...(formation === undefined ? {} : { formation }) });
  }

  /** Put a piece in a slot, or empty it with null. */
  equip(expectedVersion: number, slot: EquipSlot, instanceId: string | null) {
    return this.call<{ character: CharacterView; equipment: EquipmentView[] }>("PUT", "/character/equipment", { expectedVersion, slot, instanceId });
  }

  allocate(expectedVersion: number, stats: PrimaryStats) {
    return this.call<{ character: CharacterView }>("PUT", "/character/stats", { expectedVersion, stats });
  }

  installSigil(equipmentId: string, sigilItemId: string) {
    return this.call<{ coins: number }>("POST", "/character/equipment/sigil", { operationId: opId("sigil"), equipmentId, sigilItemId });
  }

  removeSigil(equipmentId: string, socket: number, expectedCost: number) {
    return this.call<{ coins: number }>("POST", "/character/equipment/sigil/remove", { operationId: opId("unsigil"), equipmentId, socket, expectedCost });
  }

  rerollAffix(equipmentId: string, slot: number, expectedAffixes: RolledAffix[], expectedCost: { coins: number; itemId: string; quantity: number }) {
    return this.call<{ coins: number }>("POST", "/town/affix/reroll", { operationId: opId("reroll"), equipmentId, slot, expectedAffixes, expectedCost });
  }

  chooseAffix(equipmentId: string, rerollOperationId: string, keep: "old" | "new") {
    return this.call<{ coins: number }>("POST", "/character/equipment/affix/choose", { operationId: opId("affix"), equipmentId, rerollOperationId, keep });
  }

  /** One refine attempt at the level, version and cost shown; `wardItemId` only when the player ticked it. */
  refine(equipmentId: string, expectedLevel: number, expectedVersion: number, wardItemId: string | null, expectedCost: { coins: number; stoneItemId: string; stones: number }, acceptSigilLoss = false) {
    return this.call<{ coins: number; result: RefineResult; equipment: EquipmentView[] }>("POST", "/town/refine", {
      operationId: opId("refine"),
      equipmentId,
      expectedLevel,
      expectedVersion,
      wardItemId,
      expectedCost,
      acceptSigilLoss,
    });
  }

  /** Make a recipe 1–10 times at the coins shown. */
  craft(recipeId: string, times: number, expectedCoins: number) {
    return this.call<{
      coins: number;
      result: { items: { itemId: string; quantity: number }[]; equipment: { id: string; definitionId: string; rarity: Rarity; affixes: RolledAffix[] }[]; mastery: { before: number; after: number } };
    }>("POST", "/town/craft", { operationId: opId("craft"), recipeId, times, expectedCoins });
  }

  sell(lines: { itemId: string; quantity: number }[]) {
    return this.call<{ coins: number; result: { total: number } }>("POST", "/town/sell", { operationId: opId("sell"), lines });
  }

  /** One id per tap, made by the caller, so a retried tap never buys twice. */
  buyGear(operationId: string, shopId: string, definitionId: string, quantity: number, expectedTotal: number) {
    return this.call<{ coins: number; result: { definitionId: string; equipmentIds: string[]; total: number } }>("POST", "/town/buy-gear", { operationId, shopId, definitionId, quantity, expectedTotal });
  }

  buy(shopId: string, lines: { itemId: string; quantity: number }[], expectedTotal: number) {
    return this.call<{ coins: number; result: { total: number } }>("POST", "/town/buy", { operationId: opId("buy"), shopId, lines, expectedTotal });
  }

  /** Sell or salvage pieces at the price the confirm screen showed. */
  disposeGear(mode: "sell" | "salvage", equipmentIds: string[], expected: DisposeQuote) {
    return this.call<{ coins: number; result: { paid: DisposeQuote } }>("POST", "/town/gear/dispose", { operationId: opId(mode), mode, equipmentIds, expected });
  }

  releaseCompanion(companionId: string) {
    return this.call<{ result: { companionId: string } }>("POST", "/character/companion/release", { operationId: opId("release"), companionId });
  }

  protect(kind: "equipment" | "companion", id: string, isProtected: boolean) {
    return this.call<{ protected: boolean }>("PUT", "/character/protect", { kind, id, protected: isProtected });
  }

  nickname(companionId: string, nickname: string | null) {
    return this.call<{ nickname: string | null }>("PUT", "/character/companion/nickname", { companionId, nickname });
  }

  orders() {
    return this.call<{ periodId: string; endsAt: string; orders: { order: NpcOrder; filled: number; left: number }[] }>("GET", "/town/orders");
  }

  fillOrder(orderId: string) {
    return this.call<{ coins: number; result: { reward: NpcOrder["reward"] } }>("POST", "/town/order", { operationId: opId("order"), orderId });
  }

  journal() {
    return this.call<JournalSummary & { titles: string[]; titleId: string | null }>("GET", "/journal");
  }

  setTitle(titleId: string | null) {
    return this.call<{ titleId: string | null }>("PUT", "/character/title", { titleId });
  }

  quests() {
    return this.call<{ daily: QuestBoardView; weekly: QuestBoardView }>("GET", "/quests");
  }

  /** The claim key is the period + slot, so a retried claim never pays twice. */
  claimQuest(periodId: string, slot: number | "main") {
    return this.call<{ coins: number; replayed: boolean; result: { reward: QuestReward; delivered?: { itemId: string; quantity: number } } }>("POST", "/quests/claim", { periodId, slot });
  }

  /** Secret quests: `{ locked: true }` and nothing else until the server opens the set. */
  secretQuests() {
    return this.call<SecretQuestView>("GET", "/character/secret-quests");
  }
  /** Hand in materials for a deliver quest; one id per tap, so a retry never takes items twice. */
  secretDeliver(questId: string, quantity: number) {
    return this.call<{ replayed: boolean; view: SecretQuestView }>("POST", "/character/secret-quests/deliver", { operationId: opId("secret"), questId, quantity });
  }
  /** Claim a finished quest; the server keys the claim by quest, so it grants once. */
  secretClaim(questId: string) {
    return this.call<{ replayed: boolean; result: { rewards: { kind: string; rewardId: string; ref: string | null }[] }; view: SecretQuestView }>("POST", "/character/secret-quests/claim", { questId });
  }

  /** The weekly tower: entry used, current and best floor (the server settles a finished floor first). */
  practice() {
    return this.call<PracticeView>("GET", "/practice");
  }

  practiceStart(operationId: string, bossId: string) {
    return this.call<{ battleId: string; resumed: boolean }>("POST", "/practice/start", { operationId, bossId });
  }

  frontier() {
    return this.call<FrontierView>("GET", "/frontier");
  }
  /** One id per tap of "enter": a retried request gets the same run, never a second entry. */
  frontierEnter(operationId: string) {
    return this.call<{ replayed: boolean; view: FrontierView }>("POST", "/frontier/enter", { operationId });
  }
  /** Start (or resume) the floor shown; the answer is the fight to open. */
  frontierStart(runId: string, floor: number) {
    return this.call<{ battleId: string; floor: number; boss: boolean; resumed: boolean }>("POST", "/frontier/floor/start", { runId, floor });
  }
  frontierLeave(runId: string) {
    return this.call<{ view: FrontierView }>("POST", "/frontier/leave", { runId });
  }

  party() {
    return this.call<{ party: PartyView | null }>("GET", "/party");
  }
  createParty() {
    return this.call<{ party: PartyView | null }>("POST", "/party", {});
  }
  joinParty(partyId: string) {
    return this.call<{ party: PartyView | null }>("POST", "/party/join", { partyId });
  }
  leaveParty() {
    return this.call<{ party: PartyView | null }>("POST", "/party/leave", {});
  }

  /** Companion Rebirth at the town NPC. The panel keeps one operation id per companion and stage. */
  rebirth(operationId: string, companionId: string, expectedStage: number, branch?: "A" | "B") {
    return this.call<{ coins: number; result: { stage: number } }>("POST", "/town/rebirth", {
      operationId,
      companionId,
      expectedStage,
      ...(branch === undefined ? {} : { branch }),
    });
  }

  changeRebirthBranch(operationId: string, companionId: string, stage: number, expectedBranch: "A" | "B", branch: "A" | "B", expectedCost: number) {
    return this.call<{ coins: number; result: { branch: "A" | "B" } }>("POST", "/town/rebirth/branch", {
      operationId,
      companionId,
      stage,
      expectedBranch,
      branch,
      expectedCost,
    });
  }

  trainSkill(operationId: string, companionId: string, skillId: string, expectedLevel: number) {
    return this.call<{ coins: number; result: { level: number } }>("POST", "/town/skill", { operationId, companionId, skillId, expectedLevel });
  }

  /** World Market page (anyone can browse anywhere; listing and buying are in town). */
  market(query: MarketBrowseQuery = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") p.set(k, String(v));
    const qs = p.toString();
    return this.call<MarketView>("GET", `/market${qs === "" ? "" : `?${qs}`}`);
  }
  /** List at the price and fee shown; the thing goes into escrow until it sells or is taken back. */
  marketList(kind: MarketKind, assetId: string, quantity: number, price: number, expectedFee: number) {
    return this.call<{ coins: number; result: { listingId: string; fee: number; expiresAt: string } }>("POST", "/market/list", { operationId: opId("mlist"), kind, assetId, quantity, price, expectedFee });
  }
  marketBuy(listingId: string, expectedPrice: number) {
    return this.call<{ coins: number; result: { listingId: string; price: number; asset: AssetSnapshot } }>("POST", "/market/buy", { operationId: opId("mbuy"), listingId, expectedPrice });
  }
  marketCancel(listingId: string) {
    return this.call<{ coins: number; result: { listingId: string } }>("POST", "/market/cancel", { operationId: opId("mcancel"), listingId });
  }

  /** Your trade code and your open and recent offers. */
  trades() {
    return this.call<TradeView>("GET", "/trade");
  }
  /** Offer `give` (held from now) for `want` to the player with that trade code. */
  tradeOffer(kind: TradeKind, toCode: string, give: Partial<TradeSide>, want: Partial<TradeSide>) {
    return this.call<{ coins: number; result: { offerId: string; expiresAt: string } }>("POST", "/trade/offer", { operationId: opId("toffer"), kind, toCode, give, want });
  }
  tradeRespond(how: "accept" | "decline" | "cancel", offerId: string) {
    return this.call<{ coins: number; result: { offerId: string; status: string } }>("POST", `/trade/${how}`, { operationId: opId(`t${how}`), offerId });
  }

  /** This character's mailbox; claim anywhere outside a fight. */
  mail() {
    return this.call<MailView>("GET", "/mail");
  }
  mailClaim(mailIds: string[]) {
    return this.call<{ coins: number }>("POST", "/mail/claim", { operationId: opId("mail"), mailIds });
  }
  /** The account vault (shared by this login's characters); look anywhere, move at the town NPC. */
  vault() {
    return this.call<VaultView>("GET", "/vault");
  }
  vaultDeposit(move: { items?: { itemId: string; quantity: number }[]; equipmentIds?: string[]; coins?: number }) {
    return this.call<{ coins: number }>("POST", "/vault/deposit", { operationId: opId("vin"), ...move });
  }
  vaultWithdraw(move: { items?: { itemId: string; quantity: number }[]; equipmentIds?: string[]; coins?: number }) {
    return this.call<{ coins: number }>("POST", "/vault/withdraw", { operationId: opId("vout"), ...move });
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...authHeaders(this.identity) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new ApiError(json.error ?? String(res.status), json.message ?? json.error ?? res.statusText);
    return json as T;
  }
}
