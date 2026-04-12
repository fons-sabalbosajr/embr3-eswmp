import CryptoJS from "crypto-js";

/*  ── Derived secret key ────────────────────────────────
    Assembled at runtime from char-code arrays so the key
    never appears as a searchable string in the bundle.    */
const _S = [101,109,98,114,51,45,101,115,119,109,112,45,50,48,50,54];
const _PK = _S.map((c) => String.fromCharCode(c)).join("") + "-sk";
const _XK = _S.map((c, i) => String.fromCharCode(c ^ ((i + 1) * 5))).join("");

/*  ── Key obfuscation ───────────────────────────────────
    Produces short opaque identifiers prefixed with "_"
    so they blend in with framework-internal cache keys —
    not traceable to their original human-readable names.  */
function obfuscateKey(key) {
  return "_" + CryptoJS.SHA256(key + _PK + _XK)
    .toString(CryptoJS.enc.Hex).substring(0, 22);
}

// Previous key format (migration only)
function _legacyKey(key) {
  return CryptoJS.SHA256(key + _PK)
    .toString(CryptoJS.enc.Hex).substring(0, 16);
}

/*  ── Encryption ────────────────────────────────────────
    A random 8-byte nonce is prepended before encryption
    so identical values never produce the same ciphertext.
    This prevents fingerprinting by storage-pattern analysis. */
function encrypt(value) {
  if (value === null || value === undefined) return null;
  const nonce = CryptoJS.lib.WordArray.random(8).toString(CryptoJS.enc.Hex);
  return CryptoJS.AES.encrypt(nonce + "." + String(value), _PK).toString();
}

function decrypt(cipher) {
  if (!cipher) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, _PK);
    const text = bytes.toString(CryptoJS.enc.Utf8);
    if (!text) return null;
    // New format: 16-char hex nonce + "." + value
    if (/^[0-9a-f]{16}\./.test(text)) return text.substring(17);
    return text; // Legacy format (no nonce prefix)
  } catch {
    return null;
  }
}

/*  ── Storage routing ───────────────────────────────────
    Auth-critical keys use sessionStorage so that every
    browser tab holds its own isolated session.  Two or
    more users can be logged in side-by-side without data
    leaking between tabs.  Everything else (theme, caches)
    stays in localStorage.                                */
const SESSION_KEYS = new Set([
  "token", "user", "portal_token", "portal_user",
]);
function _store(key) {
  return SESSION_KEYS.has(key) ? sessionStorage : localStorage;
}

/*  ── One-time migration ────────────────────────────────
    Runs on first import.  Converts:
      1. Old plaintext keys → encrypted
      2. Old 16-char hex keys → new 22-char prefixed keys
      3. Auth keys from localStorage → sessionStorage      */
const _KNOWN = [
  "token", "user", "portal_token", "portal_user",
  "admin-theme", "admin-primary-color", "dashboard-stats-cache",
];
(function _migrate() {
  _KNOWN.forEach((k) => {
    const dest = _store(k);
    const newKey = obfuscateKey(k);
    // Already migrated?
    if (dest.getItem(newKey) !== null) return;

    // 1. Plaintext key sitting in localStorage
    const plain = localStorage.getItem(k);
    if (plain !== null) {
      dest.setItem(newKey, encrypt(plain));
      localStorage.removeItem(k);
      return;
    }

    // 2. Legacy obfuscated (16-char hex) key in localStorage
    const legKey = _legacyKey(k);
    const legVal = localStorage.getItem(legKey);
    if (legVal !== null) {
      const dec = decrypt(legVal);
      dest.setItem(newKey, dec !== null ? encrypt(dec) : legVal);
      localStorage.removeItem(legKey);
    }
  });
})();

/*  ── Public API ────────────────────────────────────────  */
const secureStorage = {
  get(key) {
    return decrypt(_store(key).getItem(obfuscateKey(key)));
  },
  set(key, value) {
    _store(key).setItem(obfuscateKey(key), encrypt(value));
  },
  remove(key) {
    _store(key).removeItem(obfuscateKey(key));
  },
  getJSON(key) {
    const str = secureStorage.get(key);
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  },
  setJSON(key, obj) {
    secureStorage.set(key, JSON.stringify(obj));
  },

  /* Explicit session/local overrides for non-standard keys */
  sessionGet(key) {
    return decrypt(sessionStorage.getItem(obfuscateKey(key)));
  },
  sessionSet(key, value) {
    sessionStorage.setItem(obfuscateKey(key), encrypt(value));
  },
  sessionRemove(key) {
    sessionStorage.removeItem(obfuscateKey(key));
  },
  sessionGetJSON(key) {
    const str = secureStorage.sessionGet(key);
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  },
  sessionSetJSON(key, obj) {
    secureStorage.sessionSet(key, JSON.stringify(obj));
  },

  /** Wipe everything — both stores (used on every logout) */
  clearAll() {
    localStorage.clear();
    sessionStorage.clear();
  },
  /** Remove dashboard stats cache so next load fetches fresh data */
  invalidateDashboard() {
    secureStorage.remove("dashboard-stats-cache");
  },
};

export default secureStorage;
