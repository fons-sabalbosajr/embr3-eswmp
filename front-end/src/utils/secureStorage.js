import CryptoJS from "crypto-js";

const _PK = "embr3-eswmp-2026-storage-key";

function obfuscateKey(key) {
  return CryptoJS.SHA256(key + _PK).toString(CryptoJS.enc.Hex).substring(0, 16);
}

function encrypt(value) {
  if (value === null || value === undefined) return null;
  return CryptoJS.AES.encrypt(String(value), _PK).toString();
}

function decrypt(cipher) {
  if (!cipher) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, _PK);
    const text = bytes.toString(CryptoJS.enc.Utf8);
    return text || null;
  } catch {
    return null;
  }
}

// One-time migration: move old plaintext keys to obfuscated keys
["token", "user", "admin-theme", "admin-primary-color"].forEach((k) => {
  const old = localStorage.getItem(k);
  if (old !== null) {
    localStorage.setItem(obfuscateKey(k), old);
    localStorage.removeItem(k);
  }
});

const secureStorage = {
  get(key) {
    return decrypt(localStorage.getItem(obfuscateKey(key)));
  },
  set(key, value) {
    localStorage.setItem(obfuscateKey(key), encrypt(value));
  },
  remove(key) {
    localStorage.removeItem(obfuscateKey(key));
  },
  getJSON(key) {
    const str = secureStorage.get(key);
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  },
  setJSON(key, obj) {
    secureStorage.set(key, JSON.stringify(obj));
  },
  clearAll() {
    localStorage.clear();
    sessionStorage.clear();
  },
};

export default secureStorage;
