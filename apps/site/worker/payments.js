// Platby: Stripe NEBO Paddle Billing, volba jednim nastavenim PAYMENT_PROVIDER ve wrangler.toml.
//
//   PAYMENT_PROVIDER = "stripe"  -> POST /api/stripe/webhook, secret STRIPE_WEBHOOK_SECRET
//   PAYMENT_PROVIDER = "paddle"  -> POST /api/paddle/webhook, secrety PADDLE_WEBHOOK_SECRET a PADDLE_API_KEY
//                                   (e-mail zakaznika z Paddle API) + mapovani cen na tarif
//                                   (PADDLE_PRICE_PRO / _FIRMA nebo site.json payments.paddle_price_*)
//
// Webhook nezvoleneho poskytovatele vraci 404. Bez secretu zvoleneho poskytovatele 503
// (chybejici nastaveni zavira - jinak by kdokoli mohl poslat "zaplaceno").
// Kazda udalost se zpracuje jen jednou (tabulka payment_events podle id udalosti) a na jedno
// predplatne vznikne nejvys jedna licence (licenses.sub_id).
// Licence: plati mesic za koncem obdobi; neuspesna platba jen oznaci past_due, zamyka az zruseni.

import { signLicense, newLicenseKey, safeEqual } from "./license.js";
import { sendLicense } from "./email.js";
import SITE from "../content/site.json" with { type: "json" };

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
async function markSeen(env, provider, eventId, type, info = {}) {
  if (!eventId) return;
  await env.DB.prepare("INSERT OR IGNORE INTO payment_events (event_id, provider, type, received_at) VALUES (?, ?, ?, ?)")
    .bind(eventId, provider, type ?? null, now())
    .run();
  // Prehled plateb ve sprave zakazniku (schema_admin.sql). Jen evidence: chybejici tabulka
  // (migrace jeste neprobehla) nesmi shodit zpracovani platby.
  try {
    const subId = info.subId ? String(info.subId).slice(0, 200) : null;
    const email = validEmail(String(info.email ?? "").toLowerCase()) ? String(info.email).toLowerCase() : null;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO payment_log (event_id, provider, type, sub_id, email, received_at)
       VALUES (?, ?, ?, ?, COALESCE(?, (SELECT email FROM licenses WHERE sub_id = ?)), ?)`
    )
      .bind(eventId, provider, type ?? null, subId, email, subId ?? "", now())
      .run();
  } catch (err) {
    console.error("payment_log: zapis se nezdaril (spustena migrace schema_admin.sql?)", err?.message ?? err);
  }
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

// Podepsane telo, ktere neni JSON objekt -> 400 (ne 500)
function parseEvent(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Stripe

// ID objektu: webhook posila retezec, rozbaleny objekt (expand) ma .id
const idOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" && typeof v.id === "string" ? v.id : null);

// Predplatne faktury. Stripe API 2025-03-31.basil a novejsi pole invoice.subscription odstranilo:
// predplatne je v invoice.parent.subscription_details.subscription (parent.type = "subscription_details"),
// https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects
// Starsi verze API webhooku (nastavena u endpointu) posilaji invoice.subscription - bereme oba tvary.
export function invoiceSub(inv) {
  const p = inv?.parent;
  const fromParent = p && (p.type == null || p.type === "subscription_details") ? idOf(p.subscription_details?.subscription) : null;
  return fromParent ?? idOf(inv?.subscription);
}

export async function handleStripeWebhook(req, env) {
  const stop = closed(env, "stripe", "STRIPE_WEBHOOK_SECRET");
  if (stop) return stop;
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: "bad signature" }, 400);
  }
  const event = parseEvent(raw);
  if (!event) return json({ error: "bad json" }, 400);
  if (await seen(env, event.id)) return json({ received: true, duplicate: true });
  const obj = event.data?.object ?? {};

  switch (event.type) {
    case "checkout.session.completed": {
      const email = String(obj.customer_details?.email ?? obj.customer_email ?? "").trim().toLowerCase();
      if (!validEmail(email)) break;
      await issueLicense(env, {
        provider: "stripe",
        subId: idOf(obj.subscription),
        email,
        plan: planOf(obj.metadata?.plan),
        locale: langOf(obj.metadata?.locale, obj.client_reference_id, obj.locale),
      });
      break;
    }
    case "invoice.paid":
      await extend(env, invoiceSub(obj));
      break;
    case "invoice.payment_failed":
      await setStatus(env, invoiceSub(obj), "past_due");
      break;
    case "customer.subscription.deleted":
      await setStatus(env, obj.id, "canceled");
      break;
  }
  await markSeen(env, "stripe", event.id, event.type, {
    subId: event.type === "customer.subscription.deleted" ? obj.id : String(event.type).startsWith("invoice.") ? invoiceSub(obj) : idOf(obj.subscription),
    email: obj.customer_details?.email ?? obj.customer_email,
  });
  return json({ received: true });
}

// ---------------------------------------------------------------- Paddle Billing

// custom_data plni prohlizec pri otevreni checkoutu (Paddle.Checkout.open) - kdokoli ho muze zmenit.
// Proto z nej bereme JEN jazyk e-mailu. Tarif urcuje zaplacena cena (data.items[].price.id) podle
// mapovani na serveru, e-mail zakaznik ulozeny v Paddle (customer_id -> Paddle API).

// Mapovani ceny -> tarif: promenne PADDLE_PRICE_PRO / PADDLE_PRICE_FIRMA (ID pri_…, vic oddelit carkou,
// napr. mesicni a rocni), jinak content/site.json payments.paddle_price_pro / paddle_price_firma
// (tytez ceny, ktere otevira tlacitko na strance Cenik).
const priceIds = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export function paddlePrices(env) {
  return {
    pro: priceIds(env.PADDLE_PRICE_PRO || SITE.payments?.paddle_price_pro),
    firma: priceIds(env.PADDLE_PRICE_FIRMA || SITE.payments?.paddle_price_firma),
  };
}
/** Tarif podle zaplacenych cen: "firma" | "pro" | null (zadna znama cena -> zadna licence). */
export function paddlePlan(env, items) {
  const map = paddlePrices(env);
  const ids = (Array.isArray(items) ? items : []).map((i) => i?.price?.id ?? i?.price_id).filter((x) => typeof x === "string");
  if (ids.some((id) => map.firma.includes(id))) return "firma";
  if (ids.some((id) => map.pro.includes(id))) return "pro";
  return null;
}

// E-mail zakaznika z Paddle: objekt customer v udalosti (kdyby ho Paddle poslal), jinak Paddle API.
async function paddleEmail(env, data) {
  const direct = data.customer?.email;
  if (validEmail(String(direct ?? "").toLowerCase())) return String(direct).toLowerCase();
  if (!env.PADDLE_API_KEY || typeof data.customer_id !== "string" || !data.customer_id) return "";
  const base = env.PADDLE_API_KEY.includes("_sdbx_") || env.PADDLE_SANDBOX ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  const r = await fetch(`${base}/customers/${encodeURIComponent(data.customer_id)}`, {
    headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` },
  });
  if (r.status === 404) return ""; // zakaznik neexistuje - trvale, licence se nevyda (chyba v logu)
  if (!r.ok) throw new Error(`Paddle API ${r.status}`); // docasna chyba -> 500, Paddle udalost zopakuje
  return String((await r.json()).data?.email ?? "").toLowerCase();
}

export async function handlePaddleWebhook(req, env) {
  const stop = closed(env, "paddle", "PADDLE_WEBHOOK_SECRET");
  if (stop) return stop;
  // Bez API klice (e-mail zakaznika) nebo bez mapovani cen nelze licenci vydat spravne -> zavreno (503,
  // Paddle udalost zopakuje, az bude nastaveni doplnene).
  const prices = paddlePrices(env);
  if (!env.PADDLE_API_KEY || (!prices.pro.length && !prices.firma.length)) {
    console.error("Paddle: chybi PADDLE_API_KEY nebo ceny (PADDLE_PRICE_PRO / _FIRMA, site.json payments.paddle_price_*) - webhook je zavreny.");
    return json({ error: "not configured" }, 503);
  }
  const raw = await req.text();
  if (!(await verifyPaddle(raw, req.headers.get("paddle-signature"), env.PADDLE_WEBHOOK_SECRET))) {
    return json({ error: "bad signature" }, 400);
  }
  const event = parseEvent(raw);
  if (!event) return json({ error: "bad json" }, 400);
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
      const plan = paddlePlan(env, data.items);
      if (!plan) {
        console.error("Paddle: zaplacena cena neni v mapovani tarifu - licence nevydana", event.event_id);
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
        plan,
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
  await markSeen(env, "paddle", event.event_id, event.event_type, {
    subId: String(event.event_type).startsWith("subscription.") ? data.id : data.subscription_id,
    email: data.customer?.email,
  });
  return json({ received: true });
}
