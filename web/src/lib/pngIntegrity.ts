/**
 * Is this buffer a *complete* PNG?
 *
 * A truncated PNG keeps a perfect 8-byte signature, so the usual
 * `bytes[0] === 0x89` sniff waves half-written files straight through. Only the
 * trailing IEND chunk proves the encoder — or the writer — actually finished.
 *
 * This matters on the EA capture path, where a poller can open a file the
 * upload handler is still writing: the reader gets a valid-looking header, a
 * plausible byte count, and an image that renders as nothing.
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** Length 0 + "IEND" + its constant CRC — the last 12 bytes of every PNG. */
const PNG_IEND = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
/** signature(8) + IHDR chunk(25) + IEND chunk(12) */
const PNG_MIN_BYTES = 45;

export function isCompletePng(buffer: Buffer | null | undefined): boolean {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < PNG_MIN_BYTES) {
    return false;
  }
  return (
    buffer.subarray(0, 8).equals(PNG_SIGNATURE) &&
    buffer.subarray(buffer.length - 12).equals(PNG_IEND)
  );
}
