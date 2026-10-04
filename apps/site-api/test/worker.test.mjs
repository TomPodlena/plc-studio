// Prožene Worker reálnými požadavky proti SQLite místo D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import worker from '../src/index.js';

const db = new DatabaseSync(':memory:');
for (const stmt of readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').split(';')) {
  if (stmt.trim()) db.exec(stmt + ';');
}

// --- D1 shim ---
const D1 = {
  prepare(sql) {
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() { return { success: true, meta: db.prepare(sql).run(...args) }; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      _exec() { return db.prepare(sql).run(...args); },
    };
    return api;
  },
  async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
};

const { privateKey } = generateKeyPairSync('ed25519');

// --- R2 shim ---
const files = new Map([
  ['latest.json', JSON.stringify({
    version: '1.0.0',
    assets: {
      portable: { key: 'win/PLCdesk-1.0.0-portable.zip', filename: 'PLCdesk-1.0.0-portable.zip' },
    },
  })],
  ['win/PLCdesk-1.0.0-portable.zip', 'PK\x03\x04 pretend-binary'],
]);
const RELEASES = {
  async get(key) {
    if (!files.has(key)) return null;
    const body = files.get(key);
    return { body, size: body.length, text: async () => body };
  },
  async head(key) {
    return files.has(key) ? { key, size: files.get(key).length } : null;
  },
  async put(key, value) {
    files.set(key, value);
    return { key };
  },
  async delete(key) {
    files.delete(key);
  },
  // stránkuje po 2 záznamech, ať se otestuje i průchod kurzorem
  async list({ prefix = '', cursor } = {}) {
    const keys = [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
    const from = cursor ? Number(cursor) : 0;
    const page = keys.slice(from, from + 2);
    const next = from + 2;
    return {
      objects: page.map((key) => ({ key, size: files.get(key).length })),
      truncated: next < keys.length,
      cursor: String(next),
    };
  },
};

const env = {
  DB: D1,
  RELEASES,
  PUBLIC_SITE: 'https://plcdesk.io',
  MAIL_FROM: 'PLCdesk <noreply@mail.plcdesk.io>',
  MAIL_REPLY_TO: 'podlena.t@gmail.com',
  FREE_IO_LIMIT: '64',
  LICENSE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  ADMIN_TOKEN: 'test-admin',
  // TURNSTILE_SECRET a RESEND_API_KEY schválně nenastavené
};

// Resend odchytíme, ať nic neodchází
const sentMail = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('resend.com')) {
    sentMail.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'mock' }), { status: 200 });
  }
  throw new Error('neočekávaný odchozí požadavek: ' + url);
};

let pass = 0, fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('  ok   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + ' → ' + e.message);
    fail++;
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
};

const call = (method, path, body, headers = {}) =>
  worker.fetch(new Request('https://api.plcdesk.io' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), env);

console.log('\nkonfigurace a leady');
await check('GET /api/config vrací limit', async () => {
  const r = await call('GET', '/api/config');
  eq((await r.json()).free_io_limit, 64, 'limit');
});
await check('neplatný e-mail odmítnut', async () => {
  const r = await call('POST', '/api/lead', { email: 'neni-email' });
  eq(r.status, 400, 'status');
});
await check('platný e-mail → mail s odkazem', async () => {
  const r = await call('POST', '/api/lead', { email: 'Integrator@Firma.CZ' });
  eq(r.status, 200, 'status');
  if (sentMail.length !== 1) throw new Error('mail neodešel');
  if (!sentMail[0].text.includes('/stazeni?t=')) throw new Error('chybí odkaz');
});
await check('druhý pokus nezaloží duplicitní lead', async () => {
  await call('POST', '/api/lead', { email: 'integrator@firma.cz' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  eq(n, 1, 'počet leadů');
});

console.log('\nstahování');
const token = db.prepare('SELECT token FROM download_tokens LIMIT 1').get().token;
await check('platný token stáhne soubor', async () => {
  const r = await call('GET', '/api/download?t=' + token);
  eq(r.status, 200, 'status');
  const cd = r.headers.get('Content-Disposition');
  if (!cd.includes('PLCdesk-1.0.0-portable.zip')) throw new Error('špatný soubor: ' + cd);
});
await check('neplatný token odmítnut', async () => {
  eq((await call('GET', '/api/download?t=nesmysl')).status, 404, 'status');
});
await check('vypršelý token odmítnut', async () => {
  db.prepare("UPDATE download_tokens SET expires_at='2020-01-01T00:00:00.000Z'").run();
  eq((await call('GET', '/api/download?t=' + token)).status, 410, 'status');
});
await check('stažení označí lead jako potvrzený', async () => {
  const lead = db.prepare('SELECT confirmed_at FROM leads').get();
  if (!lead.confirmed_at) throw new Error('confirmed_at nenastaveno');
});

console.log('\nlicence');
let licKey;
await check('admin vystaví licenci', async () => {
  const r = await call('POST', '/api/admin/license',
    { email: 'beta@firma.cz', plan: 'pro', days: 365, note: 'beta' },
    { 'X-Admin-Token': 'test-admin' });
  eq(r.status, 200, 'status');
  licKey = (await r.json()).key;
  if (!/^PLCD-/.test(licKey)) throw new Error('špatný tvar klíče');
});
await check('admin bez tokenu odmítnut', async () => {
  const r = await call('POST', '/api/admin/license', { email: 'x@y.cz' });
  eq(r.status, 401, 'status');
});
await check('aktivace vrátí podepsanou licenci', async () => {
  const r = await call('POST', '/api/license/activate', { key: licKey, device_hash: 'stroj-A' });
  eq(r.status, 200, 'status');
  const d = await r.json();
  if (!d.license.includes('.')) throw new Error('chybí podpis');
  eq(d.plan, 'pro', 'tarif');
});
await check('druhý stroj nad počet seatů odmítnut', async () => {
  const r = await call('POST', '/api/license/activate', { key: licKey, device_hash: 'stroj-B' });
  eq(r.status, 409, 'status');
});
await check('reaktivace téhož stroje projde', async () => {
  const r = await call('POST', '/api/license/activate', { key: licKey, device_hash: 'stroj-A' });
  eq(r.status, 200, 'status');
  eq(db.prepare('SELECT COUNT(*) AS n FROM activations').get().n, 1, 'počet aktivací');
});
await check('neznámý klíč → 404', async () => {
  const r = await call('POST', '/api/license/activate', { key: 'PLCD-XXXX-XXXX-XXXX-XXXX', device_hash: 'x' });
  eq(r.status, 404, 'status');
});
await check('check hlásí stav a toleranci', async () => {
  const r = await call('POST', '/api/license/check', { key: licKey, device_hash: 'stroj-A' });
  const d = await r.json();
  eq(d.status, 'active', 'stav');
  eq(d.grace_days, 30, 'tolerance');
});

console.log('\nodemčení projektu');
await check('první odemčení projde', async () => {
  const r = await call('POST', '/api/unlock', { email: 'maly@integrator.cz', project_id: 'p-1', io_count: 78 });
  eq(r.status, 200, 'status');
  if (!sentMail.at(-1).subject.includes('odemčen')) throw new Error('mail neodešel');
});
await check('druhé odemčení odmítnuto s odkazem na ceník', async () => {
  const r = await call('POST', '/api/unlock', { email: 'maly@integrator.cz', project_id: 'p-2' });
  eq(r.status, 409, 'status');
  if (!(await r.json()).upgrade) throw new Error('chybí odkaz na ceník');
});

console.log('\nStripe');
await check('checkout.session.completed vystaví licenci a pošle ji', async () => {
  const before = sentMail.length;
  const r = await call('POST', '/api/stripe/webhook', {
    type: 'checkout.session.completed',
    data: { object: { customer_details: { email: 'platil@firma.cz' }, subscription: 'sub_1', metadata: { plan: 'pro' } } },
  });
  eq(r.status, 200, 'status');
  if (sentMail.length !== before + 1) throw new Error('licence neodešla');
  const lic = db.prepare("SELECT * FROM licenses WHERE email='platil@firma.cz'").get();
  eq(lic.status, 'active', 'stav');
});
await check('payment_failed → past_due, ne zamčeno', async () => {
  await call('POST', '/api/stripe/webhook', {
    type: 'invoice.payment_failed', data: { object: { subscription: 'sub_1' } },
  });
  const lic = db.prepare("SELECT status FROM licenses WHERE stripe_sub_id='sub_1'").get();
  eq(lic.status, 'past_due', 'stav');
});
await check('past_due licence pořád aktivuje', async () => {
  const key = db.prepare("SELECT key FROM licenses WHERE stripe_sub_id='sub_1'").get().key;
  const r = await call('POST', '/api/license/activate', { key, device_hash: 'stroj-C' });
  eq(r.status, 200, 'status');
});
await check('subscription.deleted → zrušeno a zamčeno', async () => {
  await call('POST', '/api/stripe/webhook', {
    type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } },
  });
  const key = db.prepare("SELECT key FROM licenses WHERE stripe_sub_id='sub_1'").get().key;
  eq((await call('POST', '/api/license/activate', { key, device_hash: 'stroj-D' })).status, 403, 'status');
});

console.log('\nvydani verze a uklid buildu');
await check('publikace verze, jejiz soubor v R2 neni, je odmitnuta', async () => {
  const r = await call('POST', '/api/admin/release',
    { version: '9.9.9', assets: { portable: { key: 'win/neexistuje.zip', filename: 'x.zip' } } },
    { 'X-Admin-Token': 'test-admin' });
  eq(r.status, 409, 'status');
});
await check('drzi se jen posledni 3 verze, starsi se mazou', async () => {
  // pet verzi v R2, zamerne v nahodnem poradi a s dvojici souboru u kazde
  for (const v of ['1.0.0', '1.2.0', '1.10.0', '1.3.0', '2.0.1']) {
    files.set(`win/PLCdesk-${v}-portable.zip`, `zip ${v}`);
    files.set(`win/PLCdesk-${v}.msi`, `msi ${v}`);
  }
  const r = await call('POST', '/api/admin/release', {
    version: '2.0.1',
    assets: { portable: { key: 'win/PLCdesk-2.0.1-portable.zip', filename: 'PLCdesk-2.0.1-portable.zip' } },
  }, { 'X-Admin-Token': 'test-admin' });
  eq(r.status, 200, 'status');
  const d = await r.json();
  // 1.10.0 je novejsi nez 1.3.0 — porovnava se po cislech, ne jako text
  eq(d.kept, ['2.0.1', '1.10.0', '1.3.0'], 'ponechane verze');
  eq(d.removed, ['1.2.0', '1.0.0'], 'smazane verze');
  if (files.has('win/PLCdesk-1.0.0-portable.zip')) throw new Error('stary build zustal');
  if (files.has('win/PLCdesk-1.2.0.msi')) throw new Error('stary msi zustalo');
  if (!files.has('win/PLCdesk-1.10.0-portable.zip')) throw new Error('smazana ponechana verze');
});
await check('manifest uklid prezije', async () => {
  if (!files.has('latest.json')) throw new Error('manifest smazan');
  const r = await call('GET', '/api/release/latest');
  eq((await r.json()).version, '2.0.1', 'verze v manifestu');
});
await check('prune bez tokenu odmitnut', async () => {
  eq((await call('POST', '/api/admin/releases/prune')).status, 401, 'status');
});

console.log('\nostatní');
await check('neznámá cesta → 404', async () => {
  eq((await call('GET', '/api/nic')).status, 404, 'status');
});
await check('OPTIONS vrací CORS', async () => {
  const r = await call('OPTIONS', '/api/lead');
  eq(r.status, 204, 'status');
  eq(r.headers.get('Access-Control-Allow-Origin'), 'https://plcdesk.io', 'origin');
});

console.log(`\n${pass} prošlo, ${fail} selhalo`);
process.exit(fail ? 1 : 0);
