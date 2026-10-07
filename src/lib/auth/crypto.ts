import crypto from "crypto";

/**
 * AES-256-GCM encryption for the portal PIN at rest,
 * ported from MSR-Insight's backend/express/src/utils/crypto.js. Key material
 * is derived from ENCRYPTION_SECRET (falling back to JWT_SECRET, then a default)
 * so a fresh checkout still works before secrets are configured, matching the source.
 */
const ALGORITHM = "aes-256-gcm";

function getSecretKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_SECRET ||
    process.env.JWT_SECRET ||
    "msr-insight-secret-key-default-2026";
  return crypto.createHash("sha256").update(secret).digest();
}

/** Encrypts a plain text string (e.g. a 4-digit PIN). Returns "iv:authTag:encrypted" hex. */
export function encryptText(text: string | null | undefined): string {
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(), iv);

  let encrypted = cipher.update(String(text), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/** Decrypts a string produced by encryptText. Returns "" on any failure. */
export function decryptText(encryptedHash: string | null | undefined): string {
  if (!encryptedHash || !encryptedHash.includes(":")) return "";
  try {
    const [ivHex, authTagHex, encryptedText] = encryptedHash.split(":");
    if (!ivHex || !authTagHex || !encryptedText) return "";

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, getSecretKey(), iv);

    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "";
  }
}
