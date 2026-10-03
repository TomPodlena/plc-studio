// Offline licence: server podepise JSON tvrzeni klicem Ed25519, aplikace ho overi
// verejnym klicem zabudovanym v aplikaci. Online kontrola je jen obcasna a s dlouhou
// toleranci - DRM u nastroje za tisicovku jen otravuje poctive a stejne se obejde.
// (Prevzato z vetve web-a-licencni-api, beze zmeny chovani.)

const b64 = {
  enc(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  },
  dec(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

// base64url bez paddingu - licencni soubor se posila e-mailem a kopiruje rucne
export function b64url(buf) {
  return b64.enc(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pkcs8Base64) {
  return crypto.subtle.importKey("pkcs8", b64.dec(pkcs8Base64), { name: "Ed25519" }, false, ["sign"]);
}

/**
 * Podepsany licencni soubor ve tvaru <base64url(payload)>.<base64url(podpis)>.
 * Aplikace si payload precte i bez overeni (ukaze tarif), funkce odemkne az po overeni podpisu.
 */
export async function signLicense(env, claims) {
  if (!env.LICENSE_PRIVATE_KEY) throw new Error("LICENSE_PRIVATE_KEY neni nastaveny");
  const payload = {
    v: 1,
    key: claims.key,
    email: claims.email,
    plan: claims.plan,
    seats: claims.seats ?? 1,
    // konec platnosti licence, ne predplatneho: mesic navrch, at vypadek platby
    // neshodi cloveka uprostred zakazky
    exp: claims.validUntil,
    iat: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const priv = await importPrivateKey(env.LICENSE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, bytes);
  return `${b64url(bytes)}.${b64url(sig)}`;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bez I, O, 0, 1 - diktuje se po telefonu

export function newLicenseKey() {
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += ALPHABET[rnd[i] % ALPHABET.length];
  }
  return `PLCD-${out}`;
}

export function newToken(bytes = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function newId() {
  return crypto.randomUUID();
}

// Porovnani retezcu v konstantnim case (tokeny, podpisy)
export function safeEqual(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
