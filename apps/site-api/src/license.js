// Offline licence: server podepíše JSON tvrzení klíčem Ed25519,
// aplikace ho ověří veřejným klíčem zabudovaným v binárce.
// Online kontrola je pak jen občasná a s dlouhou tolerancí — DRM u nástroje
// za tisícovku jen otravuje poctivé a stejně se obejde.

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

// base64url bez paddingu — licenční soubor se posílá e-mailem a kopíruje ručně
function b64url(buf) {
  return b64.enc(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pkcs8Base64) {
  return crypto.subtle.importKey(
    'pkcs8',
    b64.dec(pkcs8Base64),
    { name: 'Ed25519' },
    false,
    ['sign']
  );
}

/**
 * Vyrobí podepsaný licenční soubor.
 * Formát: <base64url(payload)>.<base64url(signature)>
 * Aplikace si payload přečte i bez ověření (ukáže tarif), ale funkce
 * odemkne teprve po ověření podpisu.
 */
export async function signLicense(env, claims) {
  const payload = {
    v: 1,
    key: claims.key,
    email: claims.email,
    plan: claims.plan,
    seats: claims.seats ?? 1,
    // valid_until je konec platnosti licence, ne předplatného:
    // dáváme měsíc navrch, ať výpadek platby neshodí člověka uprostřed zakázky
    exp: claims.validUntil,
    iat: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const priv = await importPrivateKey(env.LICENSE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, priv, bytes);
  return `${b64url(bytes)}.${b64url(sig)}`;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bez I,O,0,1 — diktuje se po telefonu

export function newLicenseKey() {
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += '-';
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
