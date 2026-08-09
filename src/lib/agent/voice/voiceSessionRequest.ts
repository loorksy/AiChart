/**
 * Bounded validation for the voice session request body. Shared by the route
 * and its tests so payload limits are enforced identically.
 */
import { z } from "zod";

export const voiceSessionRequestSchema = z.object({
  chatId: z.string().min(1).max(64),
  locale: z.enum(["ar", "en"]),
  symbol: z.string().min(1).max(20),
  interval: z.string().min(1).max(8),
  sessionId: z.string().max(64).optional(),
});

export type VoiceSessionRequest = z.infer<typeof voiceSessionRequestSchema>;

export function parseVoiceSessionRequest(raw: unknown):
  | { ok: true; value: VoiceSessionRequest }
  | { ok: false; error: string } {
  const parsed = voiceSessionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }
  return { ok: true, value: parsed.data };
}
