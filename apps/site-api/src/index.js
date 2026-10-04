// PLCdesk API — Cloudflare Worker
//
// Endpointy:
//   POST /api/lead              e-mail z formuláře → mail s odkazem ke stažení
//   GET  /api/download          ?t=<token>&ch=<kanál> → stažení z R2
//   GET  /api/release/latest    manifest pro autoupdater
//   GET  /api/config            veřejná konfigurace (limit I/O)
//   POST /api/license/activate  klíč + otisk stroje → podepsaný licenční soubor
//   POST /api/license/check     občasná kontrola stavu, tolerantní
//   POST /api/unlock            žádost o odemčení jednoho projektu nad limit
//   POST /api/stripe/webhook    platby
//   POST /api/admin/license     ruční vystavení licence (beta, školy)

import { signLicense, newLicenseKey, newToken, newId } from './license.js';
import { sendDownloadLink, sendLicense, sendUnlockConfirmation } from './email.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.PUBLIC_SITE,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const now = () => new Date().toISOString();
const plusDays = (d) => new Date(Date.now() + d * 864e5).toISOString();

function validEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length < 254;
}

// Turnstile — nenápadnější než captcha a spam-boty to zastaví.
async function checkTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // ve vývoji bez klíče
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token ?? '');
  if (ip) body.append('remoteip', ip);
  const res = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body }
  );
  const data = await res.json();
  return data.success === true;
}

// ---------------------------------------------------------------- lead

async function handleLead(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = (body.email ?? '').trim().toLowerCase();

  if (!validEmail(email)) {
    return json({ error: 'Zadejte platnou e-mailovou adresu.' }, 400);
  }
  const ip = req.headers.get('CF-Connecting-IP');
  if (!(await checkTurnstile(env, body.turnstile, ip))) {
    return json({ error: 'Ověření se nezdařilo, zkuste to prosím znovu.' }, 403);
  }

  const existing = await env.DB.prepare('SELECT id FROM leads WHERE email = ?')
    .bind(email)
    .first();

  let leadId = existing?.id;
  if (!leadId) {
    leadId = newId();
    await env.DB.prepare(
      `INSERT INTO leads (id, email, locale, source, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(leadId, email, body.locale ?? 'cs', body.source ?? null, now())
      .run();
  }

  const token = newToken();
  await env.DB.prepare(
    `INSERT INTO download_tokens (token, lead_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(token, leadId, plusDays(7), now())
    .run();

  await sendDownloadLink(env, { to: email, token });

  // Vždy stejná odpověď, i pro známý e-mail — ať se přes formulář nedá
  // zjišťovat, kdo je zákazník.
  return json({ ok: true, message: 'Odkaz ke stažení je na cestě.' });
}

// ------------------------------------------------------------ download

async function handleDownload(req, env) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  const channel = url.searchParams.get('ch') === 'msi' ? 'msi' : 'portable';

  const row = await env.DB.prepare(
    'SELECT token, lead_id, expires_at FROM download_tokens WHERE token = ?'
  )
    .bind(token ?? '')
    .first();

  if (!row) return json({ error: 'Odkaz je neplatný.' }, 404);
  if (row.expires_at < now()) {
    return json({ error: 'Odkaz vypršel. Vyžádejte si nový na plcdesk.io.' }, 410);
  }

  const manifest = await readManifest(env);
  const asset = manifest.assets[channel];
  if (!asset) return json({ error: 'Build není k dispozici.' }, 503);

  const object = await env.RELEASES.get(asset.key);
  if (!object) return json({ error: 'Soubor nenalezen.' }, 404);

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE download_tokens SET used_count = used_count + 1 WHERE token = ?'
    ).bind(token),
    env.DB.prepare(
      'UPDATE leads SET confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?'
    ).bind(now(), row.lead_id),
  ]);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asset.filename}"`,
      'Content-Length': String(object.size),
      // R2 nemá egress poplatky, takže se nemusíme bát velkých balíků
      'Cache-Control': 'private, no-store',
    },
  });
}

async function readManifest(env) {
  const obj = await env.RELEASES.get('latest.json');
  if (!obj) {
    return { version: '0.0.0', assets: {} };
  }
  return JSON.parse(await obj.text());
}

// Manifest pro autoupdater v Tauri. Binárky jsou podepsané,
// aplikace ověřuje podpis před instalací.
async function handleLatestRelease(env) {
  const manifest = await readManifest(env);
  return json(manifest, 200, { 'Cache-Control': 'public, max-age=300' });
}

// --- úklid starých buildů ---------------------------------------------
// V R2 držíme jen poslední 3 verze. Starší se po vydání nové mažou:
// na stažení se používá vždy manifest, takže starý build nikdo nepotřebuje,
// a nechat je tam znamená jen platit za uložiště.

const KEEP_RELEASES = 3;

// z klíče 'win/PLCdesk-1.2.3-portable.zip' vytáhne '1.2.3'
function verFromKey(key) {
  const m = /-(\d+\.\d+\.\d+)(?:[-.]|$)/.exec(key);
  return m ? m[1] : null;
}

function cmpVer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i]; // sestupně, nejnovější první
  }
  return 0;
}

async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.RELEASES.list({ prefix, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * Smaže buildy starší než poslední `keep` verze.
 * Manifest ani nic bez čísla verze v názvu se nemaže.
 */
export async function pruneReleases(env, keep = KEEP_RELEASES) {
  const objects = await listAll(env, 'win/');

  const byVersion = new Map();
  for (const o of objects) {
    const v = verFromKey(o.key);
    if (!v) continue; // soubory bez verze v názvu necháváme být
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(o.key);
  }

  const versions = [...byVersion.keys()].sort(cmpVer);
  const stale = versions.slice(keep);
  const deleted = stale.flatMap((v) => byVersion.get(v));

  for (const key of deleted) {
    await env.RELEASES.delete(key);
  }
  return { kept: versions.slice(0, keep), removed: stale, deleted };
}

// Vydání nové verze: zapíše manifest a hned uklidí staré buildy.
// Binárky se nahrávají zvlášť přes `wrangler r2 object put` — tohle je
// krok, který je zveřejní.
async function handleAdminRelease(req, env) {
  if (req.headers.get('X-Admin-Token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }
  const manifest = await req.json().catch(() => null);
  if (!manifest?.version || !manifest?.assets) {
    return json({ error: 'Chybí version nebo assets.' }, 400);
  }

  // ověřit, že soubory z manifestu v R2 opravdu leží — ať autoupdater
  // neukáže verzi, kterou si pak nikdo nestáhne
  for (const [channel, asset] of Object.entries(manifest.assets)) {
    const head = await env.RELEASES.head(asset.key);
    if (!head) {
      return json({ error: `V R2 chybí ${asset.key} (kanál ${channel}).` }, 409);
    }
  }

  await env.RELEASES.put('latest.json', JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  const prune = await pruneReleases(env);
  return json({ ok: true, version: manifest.version, ...prune });
}

// ------------------------------------------------------------- licence

async function handleActivate(req, env) {
  const body = await req.json().catch(() => ({}));
  const key = (body.key ?? '').trim().toUpperCase();
  const device = (body.device_hash ?? '').trim();

  if (!key || !device) return json({ error: 'Chybí klíč nebo otisk stroje.' }, 400);

  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE key = ?')
    .bind(key)
    .first();

  if (!lic) return json({ error: 'Licenční klíč jsme nenašli.' }, 404);
  if (lic.status === 'canceled') {
    return json({ error: 'Licence byla zrušena.' }, 403);
  }

  const seatsUsed = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM activations
      WHERE license_key = ? AND revoked_at IS NULL AND device_hash != ?`
  )
    .bind(key, device)
    .first();

  if ((seatsUsed?.n ?? 0) >= lic.seats) {
    return json(
      {
        error: `Licence je použitá na ${lic.seats} ${
          lic.seats === 1 ? 'počítači' : 'počítačích'
        }. Napište nám a uvolníme ji.`,
      },
      409
    );
  }

  await env.DB.prepare(
    `INSERT INTO activations (id, license_key, device_hash, device_label, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(license_key, device_hash)
     DO UPDATE SET last_seen_at = excluded.last_seen_at, revoked_at = NULL`
  )
    .bind(newId(), key, device, body.device_label ?? null, now(), now())
    .run();

  const file = await signLicense(env, {
    key: lic.key,
    email: lic.email,
    plan: lic.plan,
    seats: lic.seats,
    validUntil: lic.valid_until,
  });

  return json({ ok: true, license: file, plan: lic.plan, valid_until: lic.valid_until });
}

// Kontrola na pozadí. Záměrně tolerantní: když server neodpoví nebo je
// předplatné po splatnosti, aplikace běží dál. Zamyká se až po zrušení.
async function handleCheck(req, env) {
  const body = await req.json().catch(() => ({}));
  const key = (body.key ?? '').trim().toUpperCase();

  const lic = await env.DB.prepare(
    'SELECT key, plan, status, valid_until, seats FROM licenses WHERE key = ?'
  )
    .bind(key)
    .first();

  if (!lic) return json({ status: 'unknown' }, 404);

  if (body.device_hash) {
    await env.DB.prepare(
      `UPDATE activations SET last_seen_at = ?
        WHERE license_key = ? AND device_hash = ?`
    )
      .bind(now(), key, body.device_hash)
      .run();
  }

  return json({
    status: lic.status,
    plan: lic.plan,
    seats: lic.seats,
    valid_until: lic.valid_until,
    // Jak dlouho smí aplikace běžet bez spojení, než znovu zkusí server.
    grace_days: 30,
  });
}

// ------------------------------------------------------- odemčení projektu

// Marketingový nástroj z ceníku: člověk narazí na limit 64 I/O u reálné
// zakázky, napíše, a první projekt mu odemkneme. Chytá přesně toho,
// koho chceme, v momentě nejvyšší motivace.
async function handleUnlock(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = (body.email ?? '').trim().toLowerCase();
  const projectId = (body.project_id ?? '').trim();

  if (!validEmail(email) || !projectId) {
    return json({ error: 'Chybí e-mail nebo projekt.' }, 400);
  }
  if (!(await checkTurnstile(env, body.turnstile, req.headers.get('CF-Connecting-IP')))) {
    return json({ error: 'Ověření se nezdařilo.' }, 403);
  }

  const already = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM project_unlocks WHERE email = ?'
  )
    .bind(email)
    .first();

  if ((already?.n ?? 0) >= 1) {
    return json(
      {
        error:
          'Jeden projekt už máte odemčený. Další stroje nad limit potřebují tarif Pro.',
        upgrade: `${env.PUBLIC_SITE}/cenik`,
      },
      409
    );
  }

  await env.DB.prepare(
    `INSERT INTO project_unlocks (id, email, project_id, io_count, granted_at, granted_by)
     VALUES (?, ?, ?, ?, ?, 'self-serve')`
  )
    .bind(newId(), email, projectId, body.io_count ?? null, now())
    .run();

  await sendUnlockConfirmation(env, { to: email, ioCount: body.io_count });
  return json({ ok: true, unlocked: projectId });
}

// ------------------------------------------------------------- Stripe

async function handleStripeWebhook(req, env) {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();

  if (!(await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: 'bad signature' }, 400);
  }

  const event = JSON.parse(raw);
  const obj = event.data?.object ?? {};

  switch (event.type) {
    case 'checkout.session.completed': {
      const email = (obj.customer_details?.email ?? obj.customer_email ?? '')
        .trim()
        .toLowerCase();
      if (!validEmail(email)) break;

      const plan = obj.metadata?.plan === 'firma' ? 'firma' : 'pro';
      const seats = plan === 'firma' ? 5 : 1;
      const key = newLicenseKey();

      await env.DB.prepare(
        `INSERT INTO licenses (key, email, plan, seats, status, valid_until, stripe_sub_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
      )
        .bind(key, email, plan, seats, plusDays(37), obj.subscription ?? null, now(), now())
        .run();

      const file = await signLicense(env, {
        key,
        email,
        plan,
        seats,
        validUntil: plusDays(37),
      });
      await sendLicense(env, { to: email, key, file, plan });
      break;
    }

    case 'invoice.paid': {
      // Platnost licence držíme měsíc za koncem období — výpadek platby
      // tak neshodí člověka uprostřed zakázky.
      await env.DB.prepare(
        `UPDATE licenses SET valid_until = ?, status = 'active', updated_at = ?
          WHERE stripe_sub_id = ?`
      )
        .bind(plusDays(37), now(), obj.subscription ?? '')
        .run();
      break;
    }

    case 'invoice.payment_failed': {
      await env.DB.prepare(
        `UPDATE licenses SET status = 'past_due', updated_at = ? WHERE stripe_sub_id = ?`
      )
        .bind(now(), obj.subscription ?? '')
        .run();
      break;
    }

    case 'customer.subscription.deleted': {
      await env.DB.prepare(
        `UPDATE licenses SET status = 'canceled', updated_at = ? WHERE stripe_sub_id = ?`
      )
        .bind(now(), obj.id ?? '')
        .run();
      break;
    }
  }

  return json({ received: true });
}

async function verifyStripeSignature(payload, header, secret) {
  if (!secret) return true; // ve vývoji
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim()))
  );
  if (!parts.t || !parts.v1) return false;

  // Okno 5 minut proti přehrání staré zprávy
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parts.t}.${payload}`)
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Porovnání v konstantním čase
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  }
  return diff === 0;
}

// -------------------------------------------------------------- admin

// Ruční vystavení licence — beta program, školy, reference.
async function handleAdminLicense(req, env) {
  if (req.headers.get('X-Admin-Token') !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }
  const body = await req.json().catch(() => ({}));
  const email = (body.email ?? '').trim().toLowerCase();
  if (!validEmail(email)) return json({ error: 'bad email' }, 400);

  const plan = body.plan === 'firma' ? 'firma' : 'pro';
  const key = newLicenseKey();
  const validUntil = body.valid_until ?? plusDays(body.days ?? 365);

  await env.DB.prepare(
    `INSERT INTO licenses (key, email, plan, seats, status, valid_until, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  )
    .bind(key, email, plan, body.seats ?? 1, validUntil, body.note ?? null, now(), now())
    .run();

  const file = await signLicense(env, {
    key,
    email,
    plan,
    seats: body.seats ?? 1,
    validUntil,
  });

  if (body.send !== false) {
    await sendLicense(env, { to: email, key, file, plan });
  }
  return json({ ok: true, key, license: file });
}

// --------------------------------------------------------------- router

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const headers = cors(env);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      let res;
      switch (`${req.method} ${url.pathname}`) {
        case 'POST /api/lead':
          res = await handleLead(req, env);
          break;
        case 'GET /api/download':
          return handleDownload(req, env); // stream, bez CORS hlaviček
        case 'GET /api/release/latest':
          res = await handleLatestRelease(env);
          break;
        case 'GET /api/config':
          res = json({
            free_io_limit: Number(env.FREE_IO_LIMIT ?? 64),
            site: env.PUBLIC_SITE,
          });
          break;
        case 'POST /api/license/activate':
          res = await handleActivate(req, env);
          break;
        case 'POST /api/license/check':
          res = await handleCheck(req, env);
          break;
        case 'POST /api/unlock':
          res = await handleUnlock(req, env);
          break;
        case 'POST /api/stripe/webhook':
          return handleStripeWebhook(req, env); // bez CORS, volá Stripe
        case 'POST /api/admin/license':
          res = await handleAdminLicense(req, env);
          break;
        case 'POST /api/admin/release':
          res = await handleAdminRelease(req, env);
          break;
        case 'POST /api/admin/releases/prune':
          if (req.headers.get('X-Admin-Token') !== env.ADMIN_TOKEN) {
            res = json({ error: 'unauthorized' }, 401);
          } else {
            res = json({ ok: true, ...(await pruneReleases(env)) });
          }
          break;
        default:
          res = json({ error: 'not found' }, 404);
      }
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
      return out;
    } catch (err) {
      console.error(err?.stack ?? String(err));
      return json({ error: 'Došlo k chybě na serveru.' }, 500, headers);
    }
  },
};
