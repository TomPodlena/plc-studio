/**
 * Balík k ověření (verify_pack.ts): každá beta platforma × 5 jazyků — návod, protokol, manifest,
 * otisky SHA-256 sedí, bez češtiny mimo obsah projektu, deterministický (pevný čas), ZIP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import "./index.js";
import { PLAT, blankProject, syncIO } from "./model.js";
import { setLang, LANGS } from "./i18n.js";
import { VERIFICATION } from "./verification.js";
import { withFixedClock, GOLDEN_TIME } from "./golden.js";
import { genFor } from "./codegen.js";
import { sampleSmall } from "./samples.js";
import { verifyPackFiles, verifyPackArchive, verifyPackName, PLCDESK_VERSION, VERIFY_PACK_SCHEMA, } from "./verify_pack.js";
import { VP_SAMPLE_PS11, VP_SAMPLE_PM12 } from "./verify_pack_samples.js";
const ROOT = new URL("../../../", import.meta.url); // dist/ → kořen repozitáře
const CZ = /[ěščřžůďťňĚŠČŘŽŮĎŤŇ]/;
const BETA = Object.keys(VERIFICATION).filter(k => VERIFICATION[k].state === "beta");
const LANG_LIST = Object.keys(LANGS);
const enc = new TextEncoder();
const u8 = (b) => typeof b === "string" ? enc.encode(b) : b;
/* otisk nezávisle na jádře (node:crypto); bajty jako řetězec latin1 = tytéž bajty */
const sha = (b) => createHash("sha256").update(Array.from(u8(b), c => String.fromCharCode(c)).join(""), "latin1").digest("hex");
const size = (b) => u8(b).length;
/** Řetězce obsahu projektu vzorů s českým obsahem (nepřekládají se) — z testu češtiny se vyjmou. */
function projectStrings() {
    const out = new Set();
    const walk = (v) => {
        if (typeof v === "string") {
            if (CZ.test(v))
                out.add(v);
        }
        else if (Array.isArray(v))
            v.forEach(walk);
        else if (v && typeof v === "object")
            Object.values(v).forEach(walk);
    };
    for (const raw of [VP_SAMPLE_PS11, VP_SAMPLE_PM12]) {
        const p = Object.assign(blankProject(), JSON.parse(JSON.stringify(raw)));
        walk(raw);
        syncIO(p);
        walk(p);
    }
    return [...out].sort((a, b) => b.length - a.length);
}
const PROJECT_STRINGS = projectStrings();
const stripProject = (s) => PROJECT_STRINGS.reduce((t, x) => t.split(x).join(""), s);
const pack = (plat, lang) => {
    setLang(lang);
    return withFixedClock(() => verifyPackFiles(plat, { commit: "abc1234" }));
};
test("balík k ověření: beta platformy existují (dnes Siemens, Rockwell, Mitsubishi, OMRON)", () => {
    assert.ok(BETA.length >= 1);
    for (const k of BETA)
        assert.ok(PLAT[k], k);
});
test("balík k ověření: data vzorů = samples/ (11 PS-11, 12 PM-12); verze = package.json a desktop", () => {
    const rd = (f) => JSON.parse(readFileSync(new URL("samples/" + f, ROOT), "utf8")).prj;
    assert.deepEqual(VP_SAMPLE_PS11, rd("11_podavaci_lisovaci_stanice_PS-11.plcstudio.json"), "přenes vzor 11 do verify_pack_samples.ts");
    assert.deepEqual(VP_SAMPLE_PM12, rd("12_portalovy_manipulator_PM-12.plcstudio.json"), "přenes vzor 12 do verify_pack_samples.ts");
    assert.equal(JSON.parse(readFileSync(new URL("packages/core/package.json", ROOT), "utf8")).version, PLCDESK_VERSION);
    const py = readFileSync(new URL("apps/desktop/plc_studio/__init__.py", ROOT), "utf8").match(/__version__\s*=\s*"([^"]+)"/);
    assert.equal(py && py[1], PLCDESK_VERSION, "verze desktopu");
    assert.equal(verifyPackName("siemens"), "PLCdesk-overeni-siemens-" + PLCDESK_VERSION + ".zip");
});
test("balík k ověření: beta platforma × 5 jazyků — návod, protokol, manifest, otisky, bez češtiny, deterministický", async () => {
    try {
        for (const plat of BETA)
            for (const lang of LANG_LIST) {
                const where = plat + " / " + lang;
                const files = await pack(plat, lang);
                const names = Object.keys(files);
                for (const f of ["NAVOD.md", "PROTOKOL.md", "MANIFEST.json"])
                    assert.ok(names.includes(f), where + ": chybí " + f);
                assert.equal(names[names.length - 1], "MANIFEST.json", where + ": manifest poslední");
                /* vzory: malý, pohony, velký; servoosa jen README tam, kde ji platforma nepodporuje */
                for (const d of ["01_small_machine", "02_drives_PS-11", "03_large_machine_LL-03", "04_servo_axis_PM-12"]) {
                    assert.ok(names.includes(d + "/README.txt"), where + ": " + d + "/README.txt");
                }
                const m = JSON.parse(files["MANIFEST.json"]);
                assert.equal(m.format, "plcdesk-verify-pack");
                assert.equal(m.schema, VERIFY_PACK_SCHEMA);
                assert.equal(m.version, PLCDESK_VERSION);
                assert.equal(m.commit, "abc1234");
                assert.equal(m.platform, plat);
                assert.equal(m.created, new Date(GOLDEN_TIME).toISOString(), where + ": pevný čas");
                assert.equal(m.verification.state, "beta");
                assert.equal(m.samples.length, 4);
                const axis = m.samples.find((s) => s.dir === "04_servo_axis_PM-12");
                if (plat === "mitsubishi") {
                    assert.ok(axis.blocked, where + ": FX5 osu negeneruje");
                    assert.deepEqual(names.filter(n => n.startsWith("04_")), ["04_servo_axis_PM-12/README.txt"]);
                }
                else {
                    assert.ok(!axis.blocked, where + ": osa");
                    assert.ok(names.filter(n => n.startsWith("04_")).length > 1, where + ": kód osy");
                }
                /* beta platformy OOP nemají */
                assert.ok(!names.some(n => n.includes("/oop/")), where + ": OOP");
                /* otisky: každý soubor kromě manifestu, SHA-256 a velikost sedí */
                assert.deepEqual(m.files.map((f) => f.path), names.slice(0, -1), where + ": seznam souborů");
                for (const f of m.files) {
                    assert.equal(f.sha256, sha(files[f.path]), where + ": otisk " + f.path);
                    assert.equal(f.size, size(files[f.path]), where + ": velikost " + f.path);
                }
                /* obsah vzorů = genFor */
                const small = sampleSmall();
                small.platforms = [plat];
                syncIO(small);
                const g = withFixedClock(() => genFor(small, plat));
                for (const [n, b] of Object.entries(g))
                    assert.equal(files["01_small_machine/" + n], b, where + ": genFor " + n);
                /* návod a protokol */
                const navod = files["NAVOD.md"], prot = files["PROTOKOL.md"];
                assert.ok(navod.includes(PLAT[plat].ide), where + ": IDE v návodu");
                assert.ok(navod.includes("README.txt") && navod.includes("PROTOKOL.md") && navod.includes("MANIFEST.json"));
                assert.ok(navod.includes("/kontakt") || navod.includes("contact"), where + ": odkaz na Kontakt");
                for (const n of names.filter(n => /^0\d_[^/]+\/[^/]+$/.test(n) && !n.endsWith("README.txt"))) {
                    assert.ok(prot.includes(n.split("/")[1]), where + ": protokol má řádek pro " + n);
                }
                for (const [n, b] of Object.entries(files)) {
                    if (typeof b !== "string")
                        continue;
                    const left = n.endsWith(".md") ? b.match(/\{[a-z][A-Za-z]*\}/) : null;
                    assert.ok(!left, where + ": " + n + " nevyplněný zástupný znak " + (left && left[0]));
                    if (lang === "cs")
                        continue;
                    const body = stripProject(b), hit = body.match(CZ);
                    assert.ok(!hit, where + ": " + n + " nepřeložený český text kolem „" + (hit ? body.slice(Math.max(0, hit.index - 50), hit.index + 50) : "") + "“");
                }
                /* deterministický: druhý běh = totéž */
                const again = await pack(plat, lang);
                assert.deepEqual(Object.keys(again), names, where);
                for (const n of names)
                    assert.equal(again[n], files[n], where + ": " + n + " se liší mezi běhy");
            }
    }
    finally {
        setLang("cs");
    }
});
test("balík k ověření: OOP podoba u platforem s OOP, ZIP s kořenovou složkou", async () => {
    try {
        setLang("en");
        const files = await withFixedClock(() => verifyPackFiles("codesys"));
        assert.ok(Object.keys(files).some(n => n.startsWith("01_small_machine/oop/")), "OOP vzor");
        assert.ok(!Object.keys(files).some(n => n.startsWith("04_servo_axis_PM-12/oop/")), "osa jen klasicky");
        assert.ok(files["PROTOKOL.md"].includes("oop/"));
        const a = await withFixedClock(() => verifyPackArchive("omron", { version: "9.9.9" }));
        assert.equal(a.name, "PLCdesk-overeni-omron-9.9.9.zip");
        const z = new DataView(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength), n0 = a.bytes.length;
        assert.equal(z.getUint32(0, true), 0x04034b50, "lokální hlavička ZIP");
        assert.equal(z.getUint32(n0 - 22, true), 0x06054b50, "konec centrálního adresáře");
        assert.equal(z.getUint16(n0 - 22 + 10, true), a.files.length, "počet souborů");
        const text = new TextDecoder("latin1").decode(a.bytes);
        for (const n of a.files)
            assert.ok(text.includes("PLCdesk-overeni-omron-9.9.9/" + n), "v ZIPu: " + n);
        const m = JSON.parse((await withFixedClock(() => verifyPackFiles("omron", { version: "9.9.9" })))["MANIFEST.json"]);
        assert.equal(m.version, "9.9.9");
    }
    finally {
        setLang("cs");
    }
});
