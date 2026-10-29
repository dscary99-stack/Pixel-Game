/**
 * What runs after `AccountStore.deleteCharacter` (Nut 2026-10-18), outside its batch because it goes through
 * other stores: offers made to the deleted character are declined so their proposers get their side back,
 * and it leaves its party. Every step is idempotent (derived operation ids, leave is a no-op when out), so
 * the route runs it after the deletion and again on a retry; a run cut short is finished by the retry.
 */
import type { PartyStore } from "./party-store";
import type { TradeStore } from "./exchange-store";

export async function afterCharacterDeleted(accountId: string, trade: TradeStore, parties: PartyStore): Promise<void> {
  for (const offerId of await trade.openOffersTo(accountId)) {
    await trade.close(accountId, { operationId: `del_${offerId.replace(/^to_/, "")}`, offerId }, "declined");
  }
  await parties.leave(accountId);
}
