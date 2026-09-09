/**
 * Stored as an admin message so a rating request is unread like a reply.
 * Both chat surfaces render this body as a card, never as these characters.
 *
 * Kept in a file with no database imports: the user chat is a client
 * component and must not pull the store (or the DB) into the browser bundle.
 */
export const RATING_REQUEST_BODY = "__lonora_rating_request__";

export function isRatingRequestMessage(body: string): boolean {
  return body === RATING_REQUEST_BODY;
}
