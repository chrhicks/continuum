import { webcrypto } from "node:crypto";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// Generate a random ID with a prefix and a random suffix such as "tkt-a7f3b2c1"
export function randomId(prefix: string, length = 8): string {
  let out = "";
  const bytes = new Uint8Array(16);
  while (out.length < length) {
    webcrypto.getRandomValues(bytes);
    for (const b of bytes) {
      // 36 * 7 = 252, so reject 252-255 to avoid bias
      if (b < 252) {
        out += ID_ALPHABET[b % 36];
        if (out.length === length) break;
      }
    }
  }
  return `${prefix}-${out}`;
}
