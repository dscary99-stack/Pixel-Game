/**
 * Wearing fashion แฟชั่น (secret-quest rewards, secret-quests.ts; Claude's draft, STATUS A151). A
 * character wears at most one owned fashion piece per layer: head, body, back and aura. Fashion is a
 * look only (no stats, chapter 09): the character view and the fight's player unit carry the worn
 * looks so the client can draw them; nothing in the kernel reads them for numbers.
 *
 * The server keeps the worn looks per layer (one JSON object on the character), set one layer at a time
 * with an atomic json_set, so two quick changes to different layers never undo each other. A piece the
 * character does not own, or one for another layer, is refused.
 */
import { z } from "zod";
import type { SecretRewardDefinition } from "./secret-quests";

export const FASHION_LAYERS = ["head", "body", "back", "aura"] as const;
export type FashionLayer = (typeof FASHION_LAYERS)[number];
export const FASHION_LAYER_TH: Record<FashionLayer, string> = { head: "หัว", body: "ตัว", back: "หลัง", aura: "รัศมี" };

/** One worn look: what the client draws for that layer. */
export interface FashionLook {
  layer: FashionLayer;
  rewardId: string;
  effect: string;
  color: string;
}

export const FashionWearRequestSchema = z
  .object({ layer: z.enum(FASHION_LAYERS), rewardId: z.string().regex(/^srw:[a-z0-9_]+$/).nullable() })
  .strict();
export type FashionWearRequest = z.infer<typeof FashionWearRequestSchema>;

/** The look to store for a fashion reward on its layer, or why not. */
export function fashionLookFor(
  def: SecretRewardDefinition | undefined,
  layer: FashionLayer,
): { ok: true; look: FashionLook } | { ok: false; code: "NOT_FASHION" | "WRONG_LAYER" } {
  if (def === undefined || def.kind !== "fashion") return { ok: false, code: "NOT_FASHION" };
  if (def.layer !== layer) return { ok: false, code: "WRONG_LAYER" };
  return { ok: true, look: { layer, rewardId: def.id, effect: def.look.effect, color: def.look.color } };
}

/** The stored object (layer → look) as a list in layer order; bad entries are dropped. */
export function fashionLooks(json: string | null | undefined): FashionLook[] {
  if (json == null) return [];
  const o = JSON.parse(json) as Partial<Record<FashionLayer, Omit<FashionLook, "layer">>>;
  return FASHION_LAYERS.flatMap((layer) => {
    const x = o[layer];
    return x === undefined || x === null ? [] : [{ layer, rewardId: x.rewardId, effect: x.effect, color: x.color }];
  });
}
