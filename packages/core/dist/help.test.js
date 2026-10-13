/**
 * Nápověda (help.ts): každý krok workflow má kapitolu, odkazy vedou na existující id, žádný prázdný
 * text, hledání vrací rozumné výsledky v češtině i angličtině, všechny texty mají překlad do všech jazyků.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, catalog, setLang } from "./i18n.js";
import { helpChapters, helpChapter, helpForStep, searchHelp, helpTour, helpSiteUrl, helpVideoUrl, helpSourceTexts, helpFold, HELP_STEP_IDS, HELP_IDS, HELP_GROUPS, HELP_UI, } from "./help.js";
const STEP_COUNT = 13; // Projekt … Oživení (lišta kroků webu i desktopu)
test("nápověda: každý krok workflow má kapitolu se správným číslem kroku", () => {
    assert.equal(HELP_STEP_IDS.length, STEP_COUNT);
    for (let i = 0; i < STEP_COUNT; i++) {
        const ch = helpChapter(helpForStep(i), "cs");
        assert.ok(ch, "krok " + i);
        assert.equal(ch.step, i, "kapitola " + ch.id + " patří kroku " + i);
        assert.equal(ch.group, "step");
    }
    assert.equal(helpForStep("help"), "start");
    assert.equal(helpForStep(99), "start");
});
test("nápověda: jedinečná ASCII id, odkazy vedou na existující kapitoly, nic prázdného", () => {
    assert.equal(new Set(HELP_IDS).size, HELP_IDS.length, "duplicitní id");
    for (const id of HELP_IDS)
        assert.match(id, /^[a-z][a-z0-9-]*$/, id);
    for (const ch of helpChapters("cs")) {
        assert.ok(ch.title.trim() && ch.summary.trim(), ch.id + ": nadpis a shrnutí");
        assert.ok(HELP_GROUPS[ch.group], ch.id + ": skupina");
        assert.ok(ch.keywords.length >= 3, ch.id + ": klíčová slova");
        assert.ok(ch.steps.length + ch.tips.length + ch.issues.length > 0, ch.id + ": obsah");
        for (const x of [...ch.steps, ...ch.tips])
            assert.ok(x.text.trim(), ch.id + ": prázdný bod");
        for (const x of ch.issues)
            assert.ok(x.problem.trim() && x.fix.trim(), ch.id + ": prázdná chyba");
        for (const s of ch.see)
            assert.ok(HELP_IDS.includes(s), ch.id + ": odkaz na neexistující " + s);
        assert.ok(!ch.see.includes(ch.id), ch.id + ": odkaz sám na sebe");
        // zvýraznění ** v páru
        for (const t of [ch.summary, ...ch.steps.map(x => x.text), ...ch.tips.map(x => x.text)]) {
            assert.equal((t.match(/\*\*/g) || []).length % 2, 0, ch.id + ": nespárované ** v " + t.slice(0, 50));
        }
    }
});
test("nápověda: filtr klienta vynechá položky a kapitoly druhého klienta", () => {
    const all = helpChapters("cs");
    const web = helpChapters("cs", "web"), desk = helpChapters("cs", "desktop");
    assert.ok(all.some(c => c.only === "desktop"), "kapitola jen pro desktop existuje");
    assert.ok(!web.some(c => c.only === "desktop"));
    for (const c of web)
        for (const x of [...c.steps, ...c.tips])
            assert.notEqual(x.only, "desktop", c.id);
    for (const c of desk)
        for (const x of [...c.steps, ...c.tips])
            assert.notEqual(x.only, "web", c.id);
    for (const c of web)
        for (const s of c.see)
            assert.ok(web.some(x => x.id === s), "web: odkaz " + c.id + " → " + s);
    assert.equal(helpChapter("simulace", "cs", "web"), null);
    assert.ok(helpChapter("simulace", "cs", "desktop"));
});
test("nápověda: průvodce má 5–7 zastavení s platným cílem", () => {
    const t = helpTour("cs");
    assert.ok(t.length >= 5 && t.length <= 7, String(t.length));
    for (const s of t) {
        assert.ok(s.title && s.text);
        assert.ok(s.target === "help" || s.target === "samples" || (typeof s.target === "number" && s.target >= 0 && s.target < STEP_COUNT), s.id);
    }
    assert.equal(t[t.length - 1].target, "help");
    assert.ok(helpChapter("tour", "cs").steps.length >= 5);
});
test("nápověda: hledání bez diakritiky, váha nadpisu, úryvek s kontextem", () => {
    assert.equal(helpFold("Oživení ŽLUŤOUČKÝ"), "oziveni zlutoucky");
    const a = searchHelp("oziveni", "cs");
    assert.ok(a.length, "něco najde");
    assert.equal(a[0].id, "ozivovani", "nadpis vyhrává: " + a.map(h => h.id).join(","));
    const b = searchHelp("Kusovník", "cs");
    assert.equal(b[0].id, "kusovnik");
    const c = searchHelp("licence klíč", "cs");
    assert.equal(c[0].id, "licence");
    const d = searchHelp("svorkovnice", "cs");
    assert.ok(d.some(h => h.id === "schema"));
    for (const h of [...a, ...b, ...c, ...d])
        assert.ok(h.snippet && h.snippet.length <= 180, h.id + ": úryvek");
    assert.ok(helpFold(searchHelp("hlidaci cas", "cs")[0].snippet).includes("hlidaci"), "úryvek obsahuje shodu");
    assert.deepEqual(searchHelp("", "cs"), []);
    assert.deepEqual(searchHelp("xyzneexistuje", "cs"), []);
    // klient web nevrátí kapitolu jen pro desktop
    assert.ok(!searchHelp("živá simulace", "cs", "web").some(h => h.id === "simulace"));
    assert.ok(searchHelp("živá simulace", "cs", "desktop").some(h => h.id === "simulace"));
});
test("nápověda: hledání v angličtině a dalších jazycích", () => {
    const en = searchHelp("bill of materials", "en");
    assert.ok(en.length && en[0].id === "kusovnik", en.map(h => h.id).join(","));
    const lic = searchHelp("license", "en");
    assert.equal(lic[0].id, "licence");
    const sc = searchHelp("shortcuts", "en");
    assert.equal(sc[0].id, "zkratky");
    // mimo češtinu najdou i česká klíčová slova
    assert.ok(searchHelp("kusovník", "en").some(h => h.id === "kusovnik"));
    const de = searchHelp("Stückliste", "de");
    assert.ok(de.some(h => h.id === "kusovnik"), de.map(h => h.id).join(","));
    const zh = searchHelp("许可", "zh");
    assert.ok(zh.some(h => h.id === "licence"), zh.map(h => h.id).join(","));
    setLang("cs");
});
test("nápověda: všechny texty mají překlad ve všech jazycích (bez češtiny ve výstupu)", () => {
    const texts = helpSourceTexts();
    assert.ok(texts.length > 100);
    for (const l of Object.keys(LANGS)) {
        if (l === "cs")
            continue;
        const cat = catalog(l);
        const missing = texts.filter(t => !cat[t]);
        assert.deepEqual(missing.slice(0, 5), [], l + ": chybí " + missing.length + " překladů");
        for (const ch of helpChapters(l)) {
            const all = [ch.title, ch.summary, ...ch.keywords, ...ch.steps.map(x => x.text), ...ch.tips.map(x => x.text)].join(" ");
            assert.ok(!/[ěščřžůťď]/i.test(all), l + "/" + ch.id + ": čeština ve výstupu");
        }
    }
    for (const v of Object.values(HELP_UI))
        assert.ok(texts.includes(v));
});
test("nápověda: adresa kapitoly na webu PLCdesk", () => {
    assert.equal(helpSiteUrl("kusovnik", "cs"), "https://plcdesk.podlena-t.workers.dev/napoveda/kusovnik/");
    assert.equal(helpSiteUrl("kusovnik", "de"), "https://plcdesk.podlena-t.workers.dev/de/napoveda/kusovnik/");
    assert.equal(helpSiteUrl("kusovnik", "zh"), "https://plcdesk.podlena-t.workers.dev/en/napoveda/kusovnik/");
    assert.equal(helpSiteUrl(undefined, "cs"), "https://plcdesk.podlena-t.workers.dev/napoveda/");
    assert.equal(helpSiteUrl("neexistuje", "en"), "https://plcdesk.podlena-t.workers.dev/en/napoveda/");
});
test("nápověda: adresa videoprůvodce (jazyk videa = jazyk UI, es / zh na anglické stránce)", () => {
    const S = "https://plcdesk.podlena-t.workers.dev";
    assert.equal(helpVideoUrl("cs"), S + "/video/?v=cs");
    assert.equal(helpVideoUrl("en"), S + "/en/video/?v=en");
    assert.equal(helpVideoUrl("de"), S + "/de/video/?v=de");
    assert.equal(helpVideoUrl("es"), S + "/en/video/?v=es");
    assert.equal(helpVideoUrl("zh"), S + "/en/video/?v=zh");
    for (const l of Object.keys(LANGS))
        assert.ok(helpVideoUrl(l).endsWith("?v=" + l), l);
});
