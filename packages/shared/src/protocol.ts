/**
 * Wire contracts between the Phaser client and the server (chapter 12 §4).
 * The client sends intents; the server decides. accountId is never taken from the client body:
 * the server resolves it from auth (chapter 11 §2).
 */
import { z } from "zod";
import type { BattleCommand, BattleEvent, BattleState } from "./battle/types";
import type { ErrorCode } from "./validators";

const Row = z.enum(["front", "back"]);
const UnitRef = z.string().min(1).max(80);

export const BattleCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attack"), actorId: UnitRef, targetId: UnitRef }).strict(),
  z.object({ type: z.literal("skill"), actorId: UnitRef, skillId: z.string().min(1).max(80), targetId: UnitRef }).strict(),
  z.object({ type: z.literal("guard"), actorId: UnitRef }).strict(),
  z.object({ type: z.literal("item"), actorId: UnitRef, itemId: z.string().min(1).max(80), targetId: UnitRef }).strict(),
  z.object({ type: z.literal("capture"), actorId: UnitRef, targetId: UnitRef, itemId: z.string().min(1).max(80) }).strict(),
  z.object({ type: z.literal("move"), actorId: UnitRef, row: Row, slot: z.number().int().min(0).max(4) }).strict(),
  z.object({ type: z.literal("flee"), actorId: UnitRef }).strict(),
]);

// Compile-time guard: the wire schema and the kernel's command type must stay in sync.
type WireMatchesKernel = z.infer<typeof BattleCommandSchema> extends BattleCommand
  ? BattleCommand extends z.infer<typeof BattleCommandSchema>
    ? true
    : false
  : false;
export const WIRE_MATCHES_KERNEL: WireMatchesKernel = true;

export const CommandEnvelopeSchema = z
  .object({
    commandId: z.string().uuid(),
    sessionGeneration: z.number().int().min(0),
    expectedStateVersion: z.number().int().min(0),
    command: BattleCommandSchema,
  })
  .strict();
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export type CommandResponse =
  | {
      status: "accepted";
      commandId: string;
      stateVersion: number;
      /** Last event seq included; the client resumes from here after reconnect. */
      eventCursor: number;
      events: BattleEvent[];
      /** True when this is a stored answer to a repeated commandId. */
      replayed: boolean;
    }
  | {
      status: "rejected";
      commandId: string;
      reasonCode: ErrorCode;
      message: string;
      stateVersion: number;
      eventCursor: number;
    };

export type PublicBattleState = Omit<BattleState, "rng">;
