// Omezeni pokusu z jedne IP pro verejne endpointy (vzor: beta_attempts v beta.js).
//
//   lead     POST /api/lead              5 / hodinu  (zapis do D1 + e-mail; Turnstile je prvni ochrana)
//   unlock   POST /api/unlock            5 / hodinu
//   license  POST /api/license/activate  30 / hodinu dohromady (aktivace + kontroly; aplikace kontroluje
//            POST /api/license/check     nejvys 1x denne, firma ma nejvys 5 mist -> rezerva i za NAT)
//
// Pokus se zapise PRED vyhodnocenim (soubezne pokusy se navzajem vidi), pak se spocita okno.
// Zaznamy starsi nez den se mazou. IPv6 = prefix /64 (clientIp). Tabulka rate_attempts: schema_ratelimit.sql.
// Ve vyvojovem rezimu (DEV_MODE, lokalni nahled serve.js) vypnute - stejne jako u /api/beta.
// Chybejici tabulka (migrace jeste neprobehla) limit vypne a zapise chybu do logu - licence a formular
// musi fungovat dal; limit je druha vrstva za Turnstile a 80bitovymi klici.

import { clientIp, isoAgo, nowIso, num } from "./admin_util.js";

export const RATE_LIMITS = {
  lead: { max: 5, windowMs: 3600e3 },
  unlock: { max: 5, windowMs: 3600e3 },
  license: { max: 30, windowMs: 3600e3 },
};

/** true = pokus je nad limitem (odpovedet 429). */
export async function overLimit(env, req, bucket) {
  if (env.DEV_MODE) return false;
  const lim = RATE_LIMITS[bucket];
  if (!lim) throw new Error("neznamy limit " + bucket);
  const ip = clientIp(req);
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rate_attempts WHERE at < ?").bind(isoAgo(864e5)),
      env.DB.prepare("INSERT INTO rate_attempts (bucket, ip, at) VALUES (?, ?, ?)").bind(bucket, ip, nowIso()),
    ]);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_attempts WHERE bucket = ? AND ip = ? AND at > ?")
      .bind(bucket, ip, isoAgo(lim.windowMs))
      .first();
    return num(row?.n) > lim.max;
  } catch (err) {
    console.error("rate_attempts: limit pokusu nelze vyhodnotit (spustena migrace schema_ratelimit.sql?)", err?.message ?? err);
    return false;
  }
}
