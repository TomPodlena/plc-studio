// Platby: Stripe NEBO Paddle Billing, volba jednim nastavenim PAYMENT_PROVIDER ve wrangler.toml.
//
//   PAYMENT_PROVIDER = "stripe"  -> POST /api/stripe/webhook, secret STRIPE_WEBHOOK_SECRET
//   PAYMENT_PROVIDER = "paddle"  -> POST /api/paddle/webhook, secret PADDLE_WEBHOOK_SECRET
//                                   (+ volitelne PADDLE_API_KEY k dohledani e-mailu zakaznika)
//
// Webhook nezvoleneho poskytovatele vraci 404. Bez secretu zvoleneho poskytovatele 503
// (chybejici nastaveni zavira - jinak by kdokoli mohl poslat "zaplaceno").
// Kazda udalost se zpracuje jen jednou (tabulka payment_events podle id udalosti) a na jedno
// predplatne vznikne nejvys jedna licence (licenses.sub_id).
// Licence: plati mesic za koncem obdobi; neuspesna platba jen oznaci past_due, zamyka az zruseni.

import { signLicense, newLicenseKey, safeEqual } from "./license.js";
import { sendLicense } from "./email.js";

const TOLERANCE_S = 300; // okno proti prehrani stare zpravy
const VALID_DAYS = 37;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const now = () => new Date().toISOString();
const plusDays = (d) => new Date(Date.now() + d * 864e5).toISOString();
const validEmail = (s) => typeof s === "string" && s.length < 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const planOf = (p) => (p === "firma" ? "firma" : "pro");
const LANGS = ["cs", "en", "de"];
const langOf = (...c) => c.find((l) => LANGS.includes(l)) || "cs";

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Hlavicka "k=v<sep>k=v…"; podpisu muze byt vic (rotace klice)
function parseSig(header, sep, sigKey, tsKey) {
  const out = { sigs: [] };
  for (const p of String(header || "").split(sep)) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (k === sigKey) out.sigs.push(v);
    else if (k === tsKey) out.ts = v;
  }
  return out;
}

async function verify(raw, header, secret, { sep, sigKey, tsKey, join }) {
  const { ts, sigs } = parseSig(header, sep, sigKey, tsKey);
  if (!ts || !sigs.length || !/^\d+$/.test(ts)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > TOLERANCE_S) return false;
  const expected = await hmacHex(secret, `${ts}${join}${raw}`);
  return sigs.some((s) => safeEqual(expected, s));
}

// Stripe: "Stripe-Signature: t=<ts>,v1=<hex>"; podepisuje se "<ts>.<telo>"
export const verifyStripe = (raw, header, secret) => verify(raw, header, secret, { sep: ",", sigKey: "v1", tsKey: "t", join: "." });
// Paddle Billing: "Paddle-Signature: ts=<ts>;h1=<hex>"; podepisuje se "<ts>:<telo>"
export const verifyPaddle = (raw, header, secret) => verify(raw, header, secret, { sep: ";", sigKey: "h1", tsKey: "ts", join: ":" });

// ---------------------------------------------------------------- spolecne

async function seen(env, eventId) {
  if (!eventId) return false;
  return !!(await env.DB.prepare("SELECT event_id FROM payment_events WHERE event_id = ?").bind(eventId).first());
}
async function markSeen(env, provider, eventId, type) {
  if (!eventId) return;
  await env.DB.prepare("INSERT OR IGNORE INTO payment_events (event_id, provider, type, received_at) VALUES (?, ?, ?, ?)")
    .bind(eventId, provider, type ?? null, now())
    .run();
}

async function issueLicense(env, { provider, subId, email, plan, locale }) {
  if (subId) {
    const dup = await env.DB.prepare("SELECT key FROM licenses WHERE sub_id = ?").bind(subId).first();
    if (dup) return dup.key; // stejne predplatne -> zadna druha licence
  }
  const seats = plan === "firma" ? 5 : 1;
  const key = newLicenseKey();
  const validUntil = plusDays(VALID_DAYS);
  await env.DB.prepare(
    `INSERT INTO licenses (key, email, plan, seats, status, valid_until, payment_provider, sub_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  )
    .bind(key, email, plan, seats, validUntil, provider, subId ?? null, now(), now())
    .run();
  const file = await signLicense(env, { key, email, plan, seats, validUntil });
  await sendLicense(env, { to: email, key, file, plan, locale });
  return key;
}

const setStatus = (env, subId, status) =>
  env.DB.prepare("UPDATE licenses SET status = ?, updated_at = ? WHERE sub_id = ?").bind(status, now(), subId ?? "").run();
const extend = (env, subId) =>
  env.DB.prepare("UPDATE licenses SET valid_until = ?, status = 'active', updated_at = ? WHERE sub_id = ?")
    .bind(plusDays(VALID_DAYS), now(), subId ?? "")
    .run();

function closed(env, provider, secretName) {
  if ((env.PAYMENT_PROVIDER || "") !== provider) return json({ error: "not found" }, 404);
  if (!env[secretName]) {
    console.error(`${secretName} neni nastaveny - webhook je zavreny.`);
    return json({ error: "not configured" }, 503);
  }
  return null;
}

// ---------------------------------------------------------------- Stripe

export async function handleStripeWebhook(req, env) {
  const stop = closed(env, "stripe", "STRIPE_WEBHOOK_SECRET");
  if (stop) return stop;
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: "bad signature" }, 400);
  }
  const event = JSON.parse(raw);
  if (await seen(env, event.id)) return json({ received: true, duplicate: true });
  const obj = event.data?.object ?? {};

  switch (event.type) {
    case "checkout.session.completed": {
      const email = String(obj.customer_details?.email ?? obj.customer_email ?? "").trim().toLowerCase();
      if (!validEmail(email)) break;
      await issueLicense(env, {
        provider: "stripe",
        subId: obj.subscription ?? null,
        email,
        plan: planOf(obj.metadata?.plan),
        locale: langOf(obj.metadata?.locale, obj.client_reference_id, obj.locale),
      });
      break;
    }
    case "invoice.paid":
      await extend(env, obj.subscription);
      break;
    case "invoice.payment_failed":
      await setStatus(env, obj.subscription, "past_due");
      break;
    case "customer.subscription.deleted":
      await setStatus(env, obj.id, "canceled");
      break;
  }
  await markSeen(env, "stripe", event.id, event.type);
  return json({ received: true });
}

// ---------------------------------------------------------------- Paddle Billing

// E-mail zakaznika: z custom_data (checkout ho posila), jinak dotazem na Paddle API.
async function paddleEmail(env, data) {
  const direct = data.custom_data?.email ?? data.customer?.email;
  if (validEmail(String(direct ?? "").toLowerCase())) return String(direct).toLowerCase();
  if (!env.PADDLE_API_KEY || !data.customer_id) return "";
  const base = env.PADDLE_API_KEY.includes("_sdbx_") || env.PADDLE_SANDBOX ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  const r = await fetch(`${base}/customers/${encodeURIComponent(data.customer_id)}`, {
    headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` },
  });
  if (!r.ok) throw new Error(`Paddle API ${r.status}`);
  return String((await r.json()).data?.email ?? "").toLowerCase();
}

export async function handlePaddleWebhook(req, env) {
  const stop = closed(env, "paddle", "PADDLE_WEBHOOK_SECRET");
  if (stop) return stop;
  const raw = await req.text();
  if (!(await verifyPaddle(raw, req.headers.get("paddle-signature"), env.PADDLE_WEBHOOK_SECRET))) {
    return json({ error: "bad signature" }, 400);
  }
  const event = JSON.parse(raw);
  if (await seen(env, event.event_id)) return json({ received: true, duplicate: true });
  const data = event.data ?? {};

  switch (event.event_type) {
    case "transaction.completed":
    case "subscription.activated": {
      const subId = event.event_type === "subscription.activated" ? data.id : data.subscription_id;
      // obnova predplatneho = dalsi zaplacena transakce -> jen prodlouzit
      if (subId && (await env.DB.prepare("SELECT key FROM licenses WHERE sub_id = ?").bind(subId).first())) {
        if (event.event_type === "transaction.completed") await extend(env, subId);
        break;
      }
      const email = await paddleEmail(env, data);
      if (!validEmail(email)) {
        console.error("Paddle: udalost bez e-mailu zakaznika", event.event_id);
        break;
      }
      await issueLicense(env, {
        provider: "paddle",
        subId: subId ?? null,
        email,
        plan: planOf(data.custom_data?.plan),
        locale: langOf(data.custom_data?.locale),
      });
      break;
    }
    case "subscription.past_due":
      await setStatus(env, data.id, "past_due");
      break;
    case "subscription.canceled":
      await setStatus(env, data.id, "canceled");
      break;
  }
  await markSeen(env, "paddle", event.event_id, event.event_type);
  return json({ received: true });
}
