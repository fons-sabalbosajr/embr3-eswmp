const crypto = require("crypto");

// ── Encryption at rest for restricted (admin-side) media ────────────────────
// Restricted uploads are stored on disk as AES-256-GCM ciphertext so that a
// stolen disk / backup never exposes the raw file. The on-disk layout is:
//   [12-byte IV][16-byte authTag][ciphertext]
// stored in a file whose name ends with ".enc" so the serve layer knows to
// decrypt before streaming.

const ENC_ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Derive the 32-byte media encryption key. Prefers MEDIA_ENCRYPTION_KEY (64 hex
 * chars). Falls back to a key derived from JWT_SECRET so the feature works out
 * of the box, while logging a warning so operators set a dedicated key.
 */
let warnedAboutKey = false;
function getEncryptionKey() {
  const raw = process.env.MEDIA_ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    return Buffer.from(raw.trim(), "hex");
  }
  if (!warnedAboutKey) {
    warnedAboutKey = true;
    console.warn(
      "[mediaSecurity] MEDIA_ENCRYPTION_KEY not set (need 64 hex chars); " +
        "deriving a key from JWT_SECRET. Set MEDIA_ENCRYPTION_KEY for stronger key separation."
    );
  }
  const secret = process.env.JWT_SECRET || "eswmp-media-fallback-secret";
  return crypto.createHash("sha256").update(`media-at-rest:${secret}`).digest();
}

function encryptBuffer(plainBuffer) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ENC_ALGO, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBuffer(storedBuffer) {
  const iv = storedBuffer.subarray(0, IV_LEN);
  const authTag = storedBuffer.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = storedBuffer.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ENC_ALGO, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── Signed capability URLs ──────────────────────────────────────────────────
// Browser <img> tags cannot attach Authorization headers, so restricted media
// is referenced by an unguessable, server-minted signed URL. Only the server
// (holding MEDIA_URL_SECRET / JWT_SECRET) can produce a valid signature, and the
// underlying Google Drive file is NOT public — it is only reachable through the
// authenticated proxy below. Serve routes additionally accept a Bearer token
// from admin/developer callers (used by download/fetch flows).

function getUrlSecret() {
  return process.env.MEDIA_URL_SECRET || process.env.JWT_SECRET || "eswmp-media-url-secret";
}

/**
 * Sign a media reference. `ref` uniquely identifies the file, e.g.
 * "drive:<fileId>" or "local:<fileName>". Returns a base64url signature.
 * expiresAt (ms epoch, optional) binds the signature to a lifetime.
 */
function signMediaRef(ref, expiresAt) {
  const payload = expiresAt ? `${ref}|${expiresAt}` : ref;
  return crypto
    .createHmac("sha256", getUrlSecret())
    .update(payload)
    .digest("base64url");
}

function verifyMediaSignature(ref, sig, expiresAt) {
  if (!sig) return false;
  if (expiresAt && Date.now() > Number(expiresAt)) return false;
  const expected = signMediaRef(ref, expiresAt);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  ENCRYPTED_SUFFIX: ".enc",
  getEncryptionKey,
  encryptBuffer,
  decryptBuffer,
  signMediaRef,
  verifyMediaSignature,
};
