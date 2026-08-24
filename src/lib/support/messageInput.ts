import { z } from "zod";

/**
 * What a support message may be — stated once, for both sides.
 *
 * The user's chat and the admin console are two ends of the SAME conversation,
 * so they must agree on what counts as a message. When they were validated
 * separately the console demanded words while the user's side did not, which
 * made an admin unable to answer "here is the screenshot of the setting you
 * need" with the screenshot alone.
 *
 * The rule: a message needs text OR a file, and either alone is enough.
 */
export const supportAttachmentInputSchema = z.object({
  name: z.string().min(1).max(200),
  data_base64: z.string().min(8),
});

export const supportMessageSchema = z.object({
  body: z.string().max(4000).optional(),
  attachment: supportAttachmentInputSchema.optional(),
});

export type SupportMessageInput = z.infer<typeof supportMessageSchema>;

export type SupportMessageCheck =
  | { ok: true; text: string; attachment: { name: string; data_base64: string } | null }
  | { ok: false; error: "empty_message" };

/**
 * Normalise a parsed message and refuse the empty one.
 *
 * Whitespace is not content: a body of spaces with no file is an empty message,
 * and storing it would put a blank bubble in someone's conversation.
 */
export function checkSupportMessage(input: SupportMessageInput): SupportMessageCheck {
  const text = input.body?.trim() ?? "";
  if (!text && !input.attachment) return { ok: false, error: "empty_message" };
  return { ok: true, text, attachment: input.attachment ?? null };
}
