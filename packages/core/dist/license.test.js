/**
 * Licence (license.ts): ověření podpisu Ed25519 ve tvaru serveru (apps/site/worker/license.js
 * `signLicense`), stav licence (platná / podvržená / prošlá / tolerance / zrušená), tarify, limit I/O
 * na hraně 64 / 65, odemčený projekt, patička a DXF, knihovna jen ve Firmě. Testovací pár klíčů
 * vzniká tady — produkční veřejný klíč v testu není a soukromý klíč serveru nikde v repu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleSmall } from "./samples.js";
import { genFor } from "./codegen.js";
import { allProjectFiles } from "./docs.js";
import { setLang } from "./i18n.js";
import { ST_MOTOR } from "./codegen.js";
import { attachLibrary, blankLibrary } from "./library.js";
import { verifyLicense, readLicense, licenseState, entitlements, projectGate, projectIoCount, applyLicenseToFile, licensedGen, licensedProjectFiles, licenseFileKind, isLicenseKey, isLicenseFile, licenseSiteUrl, GRACE_DAYS, LICENSE_PUBLIC_KEYS, } from "./license.js";
const subtle = globalThis.crypto.subtle;
const enc = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const b64url = (b) => enc(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function keyPair() {
    const k = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    return { priv: k.privateKey, pub: enc(await subtle.exportKey("raw", k.publicKey)) };
}
/** Tvar `signLicense` ze serveru: base64url(JSON).base64url(podpis). */
async function sign(priv, claims) {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, key: "PLCD-ABCD-EFGH-JKLM-NPQR", email: "a@b.cz", seats: 1, iat: "2026-10-01T00:00:00.000Z", ...claims }));
    const sig = await subtle.sign({ name: "Ed25519" }, priv, bytes);
    return b64url(bytes) + "." + b64url(sig);
}
const NOW = Date.parse("2026-10-06T12:00:00Z");
const DAY = 864e5;
test("licence: produkční veřejný klíč — konstanta (TODO), bez klíče nic neověří", async () => {
    assert.ok(Array.isArray(LICENSE_PUBLIC_KEYS));
    const { priv } = await keyPair();
    const lic = await sign(priv, { plan: "pro", exp: "2027-01-01T00:00:00Z" });
    if (!LICENSE_PUBLIC_KEYS.length) {
        const r = await verifyLicense(lic);
        assert.equal(r.ok, false);
        assert.equal(r.error, "nokey");
        assert.equal(licenseState(r, NOW).plan, "free");
    }
});
test("licence: platný soubor → Pro, podvržený / cizí klíč / poškozený → Free", async () => {
    setLang("cs");
    const a = await keyPair(), b = await keyPair();
    const lic = await sign(a.priv, { plan: "pro", exp: "2027-01-01T00:00:00Z" });
    assert.ok(isLicenseFile(lic));
    assert.equal(readLicense(lic).plan, "pro");
    const ok = await verifyLicense(lic, [a.pub]);
    assert.equal(ok.ok, true);
    const st = licenseState(ok, NOW);
    assert.equal(st.state, "active");
    assert.equal(st.plan, "pro");
    assert.equal(st.ent.dxf, true);
    assert.equal(st.ent.footer, false);
    assert.equal(st.ent.ioLimit, null);
    assert.match(st.message, /Pro platí do 2027-01-01/);
    /* víc klíčů (výměna klíče): stačí jeden platný */
    assert.equal((await verifyLicense(lic, [b.pub, a.pub])).ok, true);
    /* podvržený obsah (tarif firma, starý podpis) */
    const [, sig] = lic.split(".");
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ ...readLicense(lic), plan: "firma" }))) + "." + sig;
    const f = await verifyLicense(forged, [a.pub]);
    assert.equal(f.ok, false);
    assert.equal(f.error, "signature");
    const fs = licenseState(f, NOW);
    assert.equal(fs.state, "invalid");
    assert.equal(fs.plan, "free");
    assert.equal(fs.licPlan, "firma");
    assert.match(fs.message, /Podpis licence nesedí/);
    /* podepsaný jiným klíčem */
    assert.equal((await verifyLicense(await sign(b.priv, { plan: "pro", exp: "2027-01-01T00:00:00Z" }), [a.pub])).ok, false);
    /* poškozený / jiný text */
    for (const bad of ["", "PLCD-ABCD-EFGH-JKLM-NPQR", "abc.def", lic.slice(0, -10) + "AAAAAAAAAA", "x".repeat(30) + "." + "y".repeat(50)]) {
        const r = await verifyLicense(bad, [a.pub]);
        assert.equal(r.ok, false, bad);
        assert.equal(licenseState(r, NOW).plan, "free", bad);
    }
    assert.ok(isLicenseKey(" plcd-abcd-efgh-jklm-npqr "));
    assert.ok(!isLicenseKey("PLCD-ABCD-EFGH-JKLM-NPQ0")); // 0 v abecedě klíče není
});
test("licence: konec období → tolerance 30 dní (plný tarif), pak Free; zrušené = Free hned; past_due platí", async () => {
    setLang("cs");
    const a = await keyPair();
    const exp = "2026-10-01T00:00:00.000Z";
    const chk = await verifyLicense(await sign(a.priv, { plan: "firma", seats: 5, exp }), [a.pub]);
    const e = Date.parse(exp);
    const s1 = licenseState(chk, e - 1);
    assert.equal(s1.state, "active");
    assert.equal(s1.plan, "firma");
    assert.equal(s1.ent.library, true);
    assert.equal(s1.ent.seats, 5);
    const s2 = licenseState(chk, e + DAY);
    assert.equal(s2.state, "grace");
    assert.equal(s2.plan, "firma");
    assert.equal(s2.daysLeft, GRACE_DAYS - 1);
    assert.match(s2.message, /tolerance 30 dní/);
    const s3 = licenseState(chk, e + GRACE_DAYS * DAY); // poslední den tolerance
    assert.equal(s3.state, "grace");
    const s4 = licenseState(chk, e + GRACE_DAYS * DAY + 1);
    assert.equal(s4.state, "expired");
    assert.equal(s4.plan, "free");
    assert.equal(s4.ent.ioLimit, 64);
    /* zrušené předplatné: Free i uprostřed platnosti */
    const s5 = licenseState(chk, e - 10 * DAY, { status: "canceled" });
    assert.equal(s5.state, "canceled");
    assert.equal(s5.plan, "free");
    assert.match(s5.message, /zrušena/);
    /* neúspěšná platba nic nezamyká */
    const s6 = licenseState(chk, e - 10 * DAY, { status: "past_due" });
    assert.equal(s6.state, "active");
    assert.equal(s6.pastDue, true);
    /* nepodepsané valid_until ze serveru platnost neprodlouží (nová platnost = nový soubor aktivací) */
    assert.equal(licenseState(chk, e + 40 * DAY, { status: "active", valid_until: "2030-01-01T00:00:00Z" }).state, "expired");
    /* bez licence */
    const none = licenseState(null, NOW);
    assert.equal(none.state, "none");
    assert.equal(none.plan, "free");
    assert.match(none.message, /do 64 I\/O/);
});
test("licence: tarify trial a free-unlock, limit z /api/config", () => {
    assert.deepEqual(entitlements("trial"), entitlements("pro"));
    const fu = entitlements("free-unlock");
    assert.equal(fu.ioLimit, null);
    assert.equal(fu.footer, true);
    assert.equal(fu.dxf, false);
    assert.equal(entitlements("neznamy").plan, "free");
    assert.equal(entitlements("free", 100).ioLimit, 100);
    assert.equal(entitlements("free", 0).ioLimit, 64);
    assert.equal(entitlements("firma").library, true);
    assert.equal(entitlements("pro").library, false);
});
/** Projekt s přesně `n` I/O (sampleSmall má 11; doplní digitální vstupy). */
function withIo(n) {
    const p = sampleSmall();
    let id = 100;
    while (projectIoCount(p) < n)
        p.devices.push({ id: id, name: "B" + id++, cls: "DI", desc: "", opt: {}, unit: "", rmin: 0, rmax: 100 });
    assert.equal(projectIoCount(p), n);
    return p;
}
test("licence: limit I/O na hraně 64 / 65, odemčený projekt, Pro bez limitu", () => {
    setLang("cs");
    const free = entitlements("free");
    const g64 = projectGate(withIo(64), free);
    assert.equal(g64.over, false);
    assert.equal(g64.canExport, true);
    assert.equal(g64.canDxf, false);
    assert.equal(g64.footer, true);
    const p65 = withIo(65);
    const g65 = projectGate(p65, free);
    assert.equal(g65.over, true);
    assert.equal(g65.canExport, false);
    assert.match(g65.reason, /65 I\/O, tarif Free povoluje 64/);
    /* odemčený projekt (GUID) projde, jiný ne */
    assert.equal(projectGate(p65, free, [p65.guid]).over, false);
    assert.equal(projectGate(p65, free, [p65.guid]).unlocked, true);
    assert.equal(projectGate(p65, free, ["00000000-0000-4000-8000-000000000000"]).over, true);
    assert.equal(projectGate(p65, entitlements("pro")).over, false);
    assert.equal(projectGate(p65, entitlements("free-unlock")).over, false);
});
test("licence: soubory — patička jen v dokumentech a README (Free), DXF jen Pro+, projekt vždy, kód beze změny", () => {
    setLang("cs");
    const p = sampleSmall();
    const free = projectGate(p, entitlements("free")), pro = projectGate(p, entitlements("pro"));
    assert.equal(licenseFileKind("siemens_README.txt"), "readme");
    assert.equal(licenseFileKind("01_funkcni_specifikace_FDS.md"), "doc");
    assert.equal(licenseFileKind("hmi_web.html"), "doc");
    assert.equal(licenseFileKind("01_DI1_X1.dxf"), "dxf");
    assert.equal(licenseFileKind("Stroj.plcstudio.json"), "own");
    assert.equal(licenseFileKind("siemens_Gen_Main.scl"), "out");
    const md = applyLicenseToFile("01_fds.md", "# FDS\n\ntext\n", free);
    assert.match(md.body, /text\n\n---\n\*Vytvořeno v PLCdesk Free — https:\/\/plcdesk\.podlena-t\.workers\.dev\*\n$/);
    assert.equal(applyLicenseToFile("01_fds.md", "# FDS\n", pro).body, "# FDS\n");
    const html = applyLicenseToFile("hmi_web.html", "<html><body><p>x</p></body></html>", free).body;
    assert.match(html, /<p>x<\/p><p style=[^>]*>Vytvořeno v PLCdesk Free — https:\/\/plcdesk[^<]*<\/p>\n<\/body>/);
    /* README ASCII (Unitronics) zůstane ASCII, CRLF zůstane CRLF */
    const r = applyLicenseToFile("unitronics_README.txt", "PLCdesk export\r\nline\r\n", free).body;
    assert.match(r, /^[\x00-\x7F]*$/);
    assert.match(r, /\r\n-----\r\nVytvoreno v PLCdesk Free/);
    /* kód a data beze změny i ve Free */
    const code = "FUNCTION_BLOCK FB_Motor\nEND_FUNCTION_BLOCK\n";
    assert.equal(applyLicenseToFile("codesys_Gen_Library.st", code, free).body, code);
    assert.equal(applyLicenseToFile("02_io_list.csv", "a;b\n", free).body, "a;b\n");
    /* DXF */
    assert.match(applyLicenseToFile("01_DI1_X1.dxf", "0\nEOF\n", free).blocked, /DXF je v tarifu Pro a Firma/);
    assert.equal(applyLicenseToFile("01_DI1_X1.dxf", "0\nEOF\n", pro).body, "0\nEOF\n");
    /* nad limitem: nic kromě projektu */
    const over = projectGate(withIo(65), entitlements("free"));
    assert.ok(applyLicenseToFile("siemens_Gen_Main.scl", code, over).blocked);
    assert.ok(applyLicenseToFile("01_fds.md", "x", over).blocked);
    assert.equal(applyLicenseToFile("Stroj.plcstudio.json", "{}", over).body, "{}");
    assert.equal(applyLicenseToFile("knihovna.plcdesk-library.json", "{}", over).body, "{}");
    /* bez brány (volající licenci neřeší) beze změny */
    assert.equal(applyLicenseToFile("01_fds.md", "x", null).body, "x");
});
test("licence: firemní knihovna v generátoru jen ve Firmě, jinak vestavěné bloky + poznámka v README", () => {
    setLang("cs");
    const p = sampleSmall();
    p.platforms = ["codesys", "unitronics"];
    attachLibrary(p, {
        ...blankLibrary("ACME"), version: "1.0",
        company: { name: "ACME Automation" },
        fbTemplates: [{ id: "AcmeMotor", cls: "Motor", dialect: "st", source: ST_MOTOR.replace("(* Sablona: motor", "(* ACME firemni blok: motor") }],
    }, false);
    const firma = projectGate(p, entitlements("firma")), pro = projectGate(p, entitlements("pro"));
    /* Firma = přesně výstup jádra */
    assert.deepEqual(licensedGen(p, "codesys", firma), genFor(p, "codesys"));
    /* Pro: vestavěné šablony, bez firemní hlavičky, README to řekne */
    const g = licensedGen(p, "codesys", pro);
    assert.doesNotMatch(g["Gen_Library.st"], /ACME firemni/);
    assert.match(genFor(p, "codesys")["Gen_Library.st"], /ACME firemni/);
    assert.doesNotMatch(g["MAIN.st"].slice(0, 300), /ACME Automation/);
    assert.match(g["README.txt"], /^FIREMNÍ KNIHOVNA ACME 1\.0 NEPOUŽITA: .*tarifu Firma/);
    const u = licensedGen(p, "unitronics", pro);
    assert.match(u["README.txt"], /^FIREMN/);
    /* kód bez knihovny = kód projektu bez knihovny (nic jiného se nemění) */
    const bare = { ...p, library: undefined };
    assert.equal(g["Gen_Library.st"], genFor(bare, "codesys")["Gen_Library.st"]);
    assert.equal(p.library.fbTemplates.length, 1, "projekt se nemění");
    /* sada souborů projektu: README platforem s poznámkou, Firma beze změny */
    const fs = licensedProjectFiles(p, pro);
    assert.ok(fs.filter(f => /README\.txt$/.test(f.save)).every(f => /FIREMNÍ KNIHOVNA ACME/.test(f.body)));
    assert.deepEqual(licensedProjectFiles(p, firma).map(f => f.body), allProjectFiles(p).map(f => f.body));
    /* bez knihovny nic */
    const q = sampleSmall();
    assert.deepEqual(licensedGen(q, "codesys", pro), genFor(q, "codesys"));
});
test("licence: odkazy na web podle jazyka", () => {
    assert.equal(licenseSiteUrl("cenik", "cs"), "https://plcdesk.podlena-t.workers.dev/cenik/");
    assert.equal(licenseSiteUrl("cenik", "de"), "https://plcdesk.podlena-t.workers.dev/de/cenik/");
    assert.equal(licenseSiteUrl("kontakt", "zh"), "https://plcdesk.podlena-t.workers.dev/en/kontakt/");
});
