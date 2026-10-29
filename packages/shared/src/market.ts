/**
 * World Market and direct trade (Nut 2026-10-07; chapter 11 §4 "escrow before direct trade").
 *
 * - World Market: a seller lists one thing (a stack of an item, one piece of gear, or one companion) for
 *   a coin price everyone can see. The thing moves into escrow when it is listed, so it cannot be used,
 *   sold twice or fought with; buying moves it to the buyer and the coins (less the sale tax) to the
 *   seller in one D1 transaction. Cancelling returns it; the listing fee is not refunded (chapter 06).
 * - Direct trade: one player offers something to another by that player's trade code. Item trade moves
 *   items, gear and coins; companion trade moves companions and coins. The proposer's side is held in
 *   escrow; the other side is checked again when they accept, then both sides move in one transaction.
 * - ห้ามขาย (noSell) keeps a thing off the World Market and away from NPC buyers; ห้ามเทรด (noTrade)
 *   keeps it out of direct trades. Items carry the flags on their definition; gear and companions can
 *   carry them on the definition or on the single piece / companion.
 * - Every companion that changes owner starts at Bond 0 (chapter 04 §6), loses its nickname and protect
 *   flag, and must pass the O01 level gap for its new owner (trade.ts) at the moment it moves.
 *
 * Numbers are P23 (market) and P24 (trade).
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import type { RulesConfig } from "./rules";
import type { Element, EquipmentDefinition, ItemDefinition, PrimaryStats, Rarity, RolledAffix } from "./schemas";

const AssetId = z.string().min(1).max(128);
const Coins = z.number().int().min(0).max(1_000_000_000);

// ------------------------------------------------------------------ flags

export interface Restrictable {
  noSell?: boolean;
  noTrade?: boolean;
}
/** A definition flag or the instance's own flag forbids it. */
export const sellable = (def: Restrictable | undefined, instanceNoSell = false) => def !== undefined && def.noSell !== true && !instanceNoSell;
export const tradeable = (def: Restrictable | undefined, instanceNoTrade = false) => def !== undefined && def.noTrade !== true && !instanceNoTrade;

// ------------------------------------------------------------------ World Market

export const MARKET_KINDS = ["item", "equipment", "companion"] as const;
export type MarketKind = (typeof MARKET_KINDS)[number];

export const MarketListRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    kind: z.enum(MARKET_KINDS),
    /** item: the item id; equipment / companion: the instance id. */
    assetId: AssetId,
    /** Items only: how many of the stack go into this listing. Gear and companions are always 1. */
    quantity: z.number().int().min(1).max(9999).default(1),
    /** Total price for the whole listing. */
    price: z.number().int().min(1).max(1_000_000_000),
    /** The fee the player was shown; refused if it no longer matches. */
    expectedFee: Coins,
  })
  .strict();
export type MarketListRequest = z.input<typeof MarketListRequestSchema>;

export const MarketListingRefSchema = z.object({ operationId: OperationIdSchema, listingId: z.string().min(1).max(64) }).strict();
export const MarketBuyRequestSchema = MarketListingRefSchema.extend({ expectedPrice: z.number().int().min(1) }).strict();
export type MarketBuyRequest = z.infer<typeof MarketBuyRequestSchema>;

export const MarketBrowseQuerySchema = z
  .object({
    kind: z.enum(MARKET_KINDS).optional(),
    /** Part of the Thai name, or an id. */
    q: z.string().max(40).optional(),
    sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
    page: z.number().int().min(0).max(500).default(0),
  })
  .strict();
export type MarketBrowseQuery = z.input<typeof MarketBrowseQuerySchema>;

/** Listing fee: P23 basis points of the price, at least the minimum. Paid when listing, never refunded. */
export function marketFee(rules: RulesConfig, price: number): number {
  const m = rules.provisional.market.value;
  return Math.max(m.minListingFee, Math.floor((price * m.listingFeeBps) / 10_000));
}
/** Sale tax taken from the seller's proceeds when the listing sells. */
export function marketTax(rules: RulesConfig, price: number): number {
  return Math.floor((price * rules.provisional.market.value.saleTaxBps) / 10_000);
}

/** What the buyer gets, frozen when the thing went into escrow (it cannot change while listed). */
export type AssetSnapshot =
  | { kind: "item"; itemId: string; name: string; quantity: number }
  | {
      kind: "equipment";
      equipmentId: string;
      definitionId: string;
      name: string;
      requiredLevel: number;
      rarity: Rarity;
      refineLevel: number;
      affixes: RolledAffix[];
      /** Sigils installed in it travel with the piece (a bundle, chapter 05 §6). */
      sigils: string[];
    }
  | {
      kind: "companion";
      companionId: string;
      speciesId: string;
      name: string;
      element: Element;
      level: number;
      rebirthStage: number;
      primaryStats: PrimaryStats;
      trainedSkillLevels: Record<string, number>;
      /** Always 0: Bond belongs to the old owner (chapter 04 §6). */
      bondAfterTransfer: 0;
      /** The new owner must be at least this level (O01). */
      minRecipientLevel: number;
    };

export interface MarketListingView {
  listingId: string;
  sellerName: string;
  mine: boolean;
  kind: MarketKind;
  price: number;
  /** Only on your own listings: what you will receive if it sells. */
  proceeds?: number;
  status: "active" | "expired" | "sold" | "cancelled";
  createdAt: string;
  expiresAt: string;
  asset: AssetSnapshot;
}
export interface MarketView {
  listings: MarketListingView[];
  page: number;
  hasMore: boolean;
  mine: MarketListingView[];
  feeBps: number;
  taxBps: number;
  listingHours: number;
  maxActiveListings: number;
}

// ------------------------------------------------------------------ direct trade

export const TRADE_KINDS = ["item", "companion"] as const;
export type TradeKind = (typeof TRADE_KINDS)[number];

/** Trade codes: 8 characters, no look-alikes (0/O, 1/I/L). Shown as XXXX-XXXX; the dash is optional. */
export const TRADE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TradeCodeSchema = z
  .string()
  .transform((s) => s.toUpperCase().replace(/[\s-]/g, ""))
  .pipe(z.string().regex(new RegExp(`^[${TRADE_CODE_ALPHABET}]{8}$`), "a trade code is 8 letters/digits"));
export const formatTradeCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const TradeSideSchema = z
  .object({
    items: z
      .array(z.object({ itemId: AssetId, quantity: z.number().int().min(1).max(9999) }).strict())
      .default([])
      .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, "each item once"),
    equipmentIds: z.array(AssetId).default([]).refine((ids) => new Set(ids).size === ids.length, "each piece once"),
    companionIds: z.array(AssetId).default([]).refine((ids) => new Set(ids).size === ids.length, "each companion once"),
    coins: Coins.default(0),
  })
  .strict();
export type TradeSide = z.infer<typeof TradeSideSchema>;

export const TradeOfferRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    kind: z.enum(TRADE_KINDS),
    toCode: TradeCodeSchema,
    /** What the proposer gives (held in escrow from now). */
    give: TradeSideSchema,
    /** What the proposer asks for in return (checked when the other player accepts). */
    want: TradeSideSchema,
  })
  .strict();
export type TradeOfferRequest = z.input<typeof TradeOfferRequestSchema>;

export const TradeRespondRequestSchema = z.object({ operationId: OperationIdSchema, offerId: z.string().min(1).max(64) }).strict();

/** Shape rules shared by client and server: which assets each trade kind moves, and the P24 caps. */
export function tradeShapeIssue(rules: RulesConfig, kind: TradeKind, give: TradeSide, want: TradeSide): string | null {
  const t = rules.provisional.playerTrade.value;
  for (const [label, side] of [
    ["give", give],
    ["want", want],
  ] as const) {
    if (kind === "item" && side.companionIds.length > 0) return `item trade moves items, gear and coins; use a companion trade for companions (${label})`;
    if (kind === "companion" && (side.items.length > 0 || side.equipmentIds.length > 0)) return `companion trade moves companions and coins; use an item trade for items and gear (${label})`;
    if (side.items.length > t.maxItemLines) return `at most ${t.maxItemLines} item lines per side`;
    if (side.equipmentIds.length > t.maxEquipment) return `at most ${t.maxEquipment} pieces per side`;
    if (side.companionIds.length > t.maxCompanions) return `at most ${t.maxCompanions} companions per side`;
  }
  const things = (s: TradeSide) => s.items.length + s.equipmentIds.length + s.companionIds.length;
  if (things(give) + things(want) === 0) return "a trade must move at least one item, piece or companion";
  if (kind === "companion" && give.companionIds.length + want.companionIds.length === 0) return "a companion trade must move at least one companion";
  return null;
}

export interface TradeSideView {
  coins: number;
  assets: AssetSnapshot[];
}
export interface TradeOfferView {
  offerId: string;
  kind: TradeKind;
  fromName: string;
  toName: string;
  /** "out" = you proposed it; "in" = it was offered to you. */
  direction: "in" | "out";
  status: "open" | "expired" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  expiresAt: string;
  /** What the proposer gives / asks for. */
  give: TradeSideView;
  want: TradeSideView;
}
export interface TradeView {
  /** Your trade code; give it to the player you want to trade with. */
  myCode: string;
  open: TradeOfferView[];
  recent: TradeOfferView[];
  offerHours: number;
}

/** Display names for snapshots, from content (server and client agree). */
export function itemName(items: ReadonlyMap<string, ItemDefinition>, itemId: string) {
  return items.get(itemId)?.name.th ?? itemId;
}
export function equipmentName(equipment: ReadonlyMap<string, EquipmentDefinition>, definitionId: string) {
  return equipment.get(definitionId)?.name.th ?? definitionId;
}
