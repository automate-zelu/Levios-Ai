// ─── AES-256-CBC ENCRYPTION HELPER ───────────────────────────────────────────
// Used to encrypt sensitive per-workspace credentials (Twilio sub-account SID
// and auth token) before storing them in the database.
//
// Key: ENCRYPTION_KEY env var — must be a 64-character hex string (32 bytes).
//   Generate with: openssl rand -hex 32
//
// Format: "<iv-hex>:<ciphertext-hex>"
// IV is randomly generated per encryption — same plaintext produces different
// ciphertext each time, preventing correlation attacks.

import crypto from "crypto";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string. Generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, encHex] = ciphertext.split(":");
  if (!ivHex || !encHex) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(ivHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
