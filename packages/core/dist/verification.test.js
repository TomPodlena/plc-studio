/**
 * Ověření platforem (data/verification.json → verification_data.ts → verification.ts):
 * každá platforma z PLAT má záznam a žádný navíc, generovaný TS odpovídá JSON, protokoly existují,
 * README každé platformy nese generovaný štítek ověření (a žádnou ručně psanou větu o ověření).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PLAT, syncIO } from "./model.js";
import { genFor } from "./codegen.js";
import { sampleSmall } from "./samples.js";
import { setLang, LANGS } from "./i18n.js";
import { VERIFICATION, VERIF_STATE_LABEL, VERIF_FORMAT_LABEL, VERIF_SCOPE_LABEL, verificationInfo, verificationReadme, verificationLatest, } from "./verification.js";
const ROOT = new URL("../../../", import.meta.url); // dist/ → kořen repozitáře
const JSON_SRC = JSON.parse(readFileSync(new URL("data/verification.json", ROOT), "utf8"));
const PLATS = Object.keys(PLAT);
test("ověření: každá platforma z PLAT má záznam, žádný navíc; TS = data/verification.json", () => {
    assert.deepEqual(Object.keys(VERIFICATION).sort(), [...PLATS].sort());
    assert.deepEqual(Object.keys(JSON_SRC.platforms).sort(), [...PLATS].sort(), "JSON a PLAT");
    for (const k of PLATS) {
        const v = VERIFICATION[k], j = JSON_SRC.platforms[k];
        assert.equal(v.state, j.state, k + ": stav (přegeneruj: python scripts/build_verification.py)");
        assert.equal(v.date, j.date, k + ": datum");
        assert.equal(v.ide, j.ide, k + ": IDE");
        assert.equal(v.summary, j.summary, k + ": summary");
        assert.equal(v.notVerified, j.notVerified, k + ": notVerified");
        assert.deepEqual(v.scope, j.scope, k + ": rozsah");
        assert.deepEqual(v.evidence, j.evidence, k + ": protokoly");
        assert.deepEqual(v.formats.map(f => f.file + "|" + f.state), j.formats.map((f) => f.file + "|" + f.state), k + ": výstupy");
    }
});
test("ověření: stavy, data, protokoly v repozitáři", () => {
    for (const k of PLATS) {
        const v = VERIFICATION[k];
        assert.ok(v.state in VERIF_STATE_LABEL, k + ": stav");
        assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/, k + ": datum");
        assert.ok(v.state === "beta" || v.state === "unsupported" || !!v.ide, k + ": ověřeno bez IDE / překladače");
        assert.ok(v.evidence.length, k + ": bez protokolu");
        for (const e of v.evidence)
            assert.ok(existsSync(new URL(e, ROOT)), k + ": protokol " + e + " neexistuje");
        for (const f of v.formats)
            assert.ok(f.state in VERIF_FORMAT_LABEL, k + ": stav výstupu " + f.file);
        for (const s of v.scope)
            assert.ok(s in VERIF_SCOPE_LABEL, k + ": rozsah " + s);
    }
    assert.equal(verificationLatest(), PLATS.map(k => VERIFICATION[k].date).sort().pop());
    /* rozhodnutí 2026-10-05: CODESYS ověřen v IDE; Schneider, WAGO, Delta, profily a Unitronics jazykově */
    assert.equal(VERIFICATION.codesys.state, "verified");
    for (const k of PLATS.filter(k => PLAT[k].base === "codesys" || k === "schneider"))
        assert.equal(VERIFICATION[k].state, "lang", k);
});
test("ověření: README každé platformy nese generovaný štítek ve všech jazycích", () => {
    const prj = sampleSmall();
    prj.platforms = PLATS;
    syncIO(prj);
    try {
        for (const lang of Object.keys(LANGS)) {
            setLang(lang);
            for (const k of PLATS) {
                const rd = genFor(prj, k)["README.txt"];
                const lbl = verificationReadme(k);
                assert.ok(rd.includes(lbl), lang + "/" + k + ": štítek ověření v README");
                assert.equal(rd.split(lbl).length, 2, lang + "/" + k + ": štítek jednou");
                assert.ok(verificationInfo(k).tip.includes(verificationInfo(k).notVerified), k + ": bublina s tím, co neověřeno");
                if (lang === "cs") {
                    /* ručně psané věty o ověření v README nepatří (zdroj = data/verification.json) */
                    assert.ok(!/OVĚŘENO JAZYKOVĚ|NEOVĚŘENO PŘEKLADEM|NEOVĚŘENO importem v GX|^- OVĚŘENO:/m.test(rd), k + ": ručně psaný štítek");
                }
                else {
                    assert.ok(!/[ěščřžůĚŠČŘŽŮ]/.test(lbl), lang + "/" + k + ": štítek přeložen");
                }
            }
        }
    }
    finally {
        setLang("cs");
    }
});
