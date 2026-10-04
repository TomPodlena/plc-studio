// Vygeneruje pár klíčů Ed25519 pro podepisování licencí.
//   node tools/keygen.mjs
//
// Soukromý klíč → wrangler secret put LICENSE_PRIVATE_KEY
// Veřejný klíč  → zabudovat do aplikace (Tauri/Rust), tím se ověřují licence.
//
// Soukromý klíč si zálohuj mimo repozitář. Když o něj přijdeš, všechny
// vydané licence přestanou jít ověřit novou verzí aplikace.

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const pub = publicKey.export({ type: 'spki', format: 'der' });

// Posledních 32 bajtů SPKI je surový veřejný klíč — ten jde do aplikace.
const rawPub = pub.subarray(pub.length - 32).toString('base64');

console.log('LICENSE_PRIVATE_KEY (pkcs8 base64) — do wrangler secret:\n');
console.log(priv);
console.log('\nVeřejný klíč (raw 32 B base64) — do aplikace:\n');
console.log(rawPub);
console.log('\nSPKI base64 (když by ho knihovna chtěla v tomhle tvaru):\n');
console.log(pub.toString('base64'));
