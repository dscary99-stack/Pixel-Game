/**
 * Login accounts and characters (O10/O11, Nut 2026-10-07). A person signs in with Google, Facebook or an
 * ID made in the game (`RULES.confirmed.loginProviders`) and keeps up to `maxCharactersPerAccount` (10)
 * characters. Each character is its own play account (`acct:…`): every store keys on it, so characters
 * share nothing (bag, coins, companions, quests). A shared vault is not decided (O10).
 */
import { z } from "zod";
import { PRODUCTION_RULES, type RulesConfig } from "./rules";

export type LoginProvider = (typeof PRODUCTION_RULES.confirmed.loginProviders.value)[number];

const L = PRODUCTION_RULES.provisional.login.value;

/** IDs are compared in lower case; the pattern keeps them readable and URL-safe. */
export const LoginIdSchema = z
  .string()
  .min(L.loginIdMin)
  .max(L.loginIdMax)
  .regex(/^[A-Za-z0-9_.-]+$/)
  .transform((s) => s.toLowerCase());
export const PasswordSchema = z.string().min(L.passwordMin).max(L.passwordMax);

export const RegisterRequestSchema = z.object({ loginId: LoginIdSchema, password: PasswordSchema }).strict();
export const PasswordLoginRequestSchema = z.object({ loginId: LoginIdSchema, password: z.string().min(1).max(L.passwordMax) }).strict();
export const GoogleLoginRequestSchema = z.object({ idToken: z.string().min(20).max(4096) }).strict();
export const FacebookLoginRequestSchema = z.object({ accessToken: z.string().min(20).max(1024) }).strict();
export const SelectCharacterRequestSchema = z.object({ slot: z.number().int().min(1).max(PRODUCTION_RULES.confirmed.maxCharactersPerAccount.value) }).strict();
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type SelectCharacterRequest = z.infer<typeof SelectCharacterRequestSchema>;

/** One of the 10 places on the character screen; `character` is null while the place is empty. */
export interface CharacterSlotView {
  slot: number;
  character: { name: string; level: number; classId: string } | null;
}

export interface AccountView {
  userId: string;
  providers: LoginProvider[];
  maxCharacters: number;
  /** Always `maxCharacters` places, in order. */
  slots: CharacterSlotView[];
  /** The character this sign-in is playing, or null on the character screen. */
  selectedSlot: number | null;
}

export interface SessionGrant {
  token: string;
  expiresAt: string;
  account: AccountView;
}

/** Valid character places for these rules: 1..maxCharactersPerAccount. */
export const characterSlots = (rules: RulesConfig = PRODUCTION_RULES) => Array.from({ length: rules.confirmed.maxCharactersPerAccount.value }, (_, i) => i + 1);

/** The play account that holds one character. User ids are `u` + lower-case hex, so this stays short. */
export const playAccountId = (userId: string, slot: number) => `acct:${userId}-c${slot}`;
