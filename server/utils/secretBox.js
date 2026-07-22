const crypto = require("crypto");

// ── Reversible secret storage for at-rest config secrets ────────────────────
// Small helper for encrypting short config secrets (e.g. the Automation Agent's
// Anthropic API key) before they are written to the database. The encryption key
// is derived from an environment variable — it lives OUTSIDE the database, so a
// stolen DB dump never yields the plaintext secret.
//
// Serialized form (a single string, safe to store in a Mongo String field):
//   v1:<ivHex>:<authTagHex>:<cipherHex>
//
// This mirrors utils/mediaSecurity.js (AES-256-GCM) but works on strings and
// produces a compact, self-describing text blob instead of a binary buffer.

const ENC_ALGO = "aes-256-gcm";
const IV_LEN = 12;
const VERSION = "v1";

// Derive the 32-byte key. Prefers a dedicated SECRET_ENCRYPTION_KEY (64 hex
// chars). Falls back to a key derived from JWT_SECRET so the feature works out
// of the box in dev, while warning operators to set a dedicated key in prod.
let warnedAboutKey = false;
function getKey() {
  const raw = process.env.SECRET_ENCRYPTION_KEY || process.env.MEDIA_ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    return Buffer.from(raw.trim(), "hex");
  }
  if (!warnedAboutKey) {
    warnedAboutKey = true;
    console.warn(
      "[secretBox] SECRET_ENCRYPTION_KEY not set (need 64 hex chars); deriving a " +
        "key from JWT_SECRET. Set SECRET_ENCRYPTION_KEY for stronger key separation."
    );
  }
  const secret = process.env.JWT_SECRET || "eswmp-secretbox-fallback";
  return crypto.createHash("sha256").update(`secretbox:${secret}`).digest();
}

/** Encrypt a plaintext string → "v1:iv:tag:cipher" (all hex). Empty/blank → "". */
function encryptSecret(plaintext) {
  const text = String(plaintext == null ? "" : plaintext);
  if (!text) return "";
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ENC_ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt a "v1:iv:tag:cipher" blob back to plaintext. Returns "" for empty
 * input, and null if the blob is malformed or authentication fails (e.g. the
 * encryption key changed) — callers treat null as "no usable key".
 */
function decryptSecret(blob) {
  const s = String(blob || "");
  if (!s) return "";
  const parts = s.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const ciphertext = Buffer.from(parts[3], "hex");
    const decipher = crypto.createDecipheriv(ENC_ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** True if the value is one of our serialized ciphertext blobs (not plaintext). */
function isEncrypted(blob) {
  const s = String(blob || "");
  return s.startsWith(`${VERSION}:`) && s.split(":").length === 4;
}

// A short, non-reversible hint for the UI: last 4 chars of the secret, masked.
// e.g. "••••••••AB12". Never exposes enough to reconstruct the key.
function maskHint(plaintext) {
  const text = String(plaintext || "");
  if (!text) return "";
  const tail = text.slice(-4);
  return `••••••••${tail}`;
}

module.exports = { encryptSecret, decryptSecret, isEncrypted, maskHint };
