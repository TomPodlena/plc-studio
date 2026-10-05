import { tr } from "../i18n.js";
import { xmlProblems } from "../logix.js";
import { parseStPou, splitLibrary } from "../plcopen.js";
import { IEC10_NS, IEC10_FILE, IEC10_PROFILES, IEC10_SRC, stSections, iec10Source } from "../iec61131_10.js";
const unEsc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (tag, n) => { const m = new RegExp("\\s" + n + '="([^"]*)"').exec(tag); return m ? unEsc(m[1]) : undefined; };
const typeOf = (v) => { const m = /<Type>\s*<TypeName>([^<]*)<\/TypeName>\s*<\/Type>/.exec(v); return m ? unEsc(m[1]).trim().toUpperCase() : "?"; };
const PARAM_KIND = { InputVars: "in", OutputVars: "out", InoutVars: "inout" };
/** Proměnné jedné sekce (`<Variable …>…</Variable>` i `<Variable … />`). */
function vars(x) {
    return [...x.matchAll(/<Variable\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Variable>)/g)].map(m => ({ head: m[1], inner: m[2] || "", name: attr(m[1], "name") || "" }));
}
/**
 * Problémy XML proti finálním textům platformy (prázdné pole = v pořádku).
 * `src` = Gen_Library / MAIN / globální návěští, ze kterých XML vzniklo (ruční cesta importu).
 */
export function iec10Problems(xml, src, target) {
    const out = [];
    const p = IEC10_PROFILES[target];
    for (const e of xmlProblems(xml))
        out.push(tr("XML není well-formed: {e}", { e }));
    if (out.length)
        return out;
    /* 1. kořen a pořadí hlavních prvků */
    const root = /<Project\b([^>]*)>([\s\S]*)<\/Project>/.exec(xml);
    if (!root || attr(root[1], "xmlns") !== IEC10_NS || attr(root[1], "schemaVersion") !== "1.0") {
        out.push(tr("Kořen musí být Project s xmlns {ns} a schemaVersion 1.0 (IEC 61131-10 Ed. 1.0)", { ns: IEC10_NS }));
        return out;
    }
    const top = [...root[2].matchAll(/<(FileHeader|ContentHeader|Types|Instances|AddData|Documentation)\b/g)].map(m => m[1]);
    const order = ["FileHeader", "ContentHeader", "Types", "Instances"];
    if (order.some(n => !top.includes(n)) || order.map(n => top.indexOf(n)).some((v, i, a) => i && v < a[i - 1]))
        out.push(tr("Hlavní prvky musí být v pořadí FileHeader, ContentHeader, Types, Instances (XSD)"));
    const gnsM = /<Types>\s*<GlobalNamespace>([\s\S]*?)<\/GlobalNamespace>\s*<\/Types>/.exec(xml);
    if (!gnsM) {
        out.push(tr("Chybí Types/GlobalNamespace"));
        return out;
    }
    const gns = gnsM[1];
    /* 2. jedinečnost jmen */
    const pous = [...gns.matchAll(/<(FunctionBlock|Program|Function)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map(m => ({ tag: m[1], name: unEsc(m[2]), body: m[3] }));
    const types = [...gns.matchAll(/<DataTypeDecl\s+name="([^"]+)"/g)].map(m => unEsc(m[1]));
    const seen = new Set();
    for (const n of [...pous.map(x => x.name), ...types]) {
        if (seen.has(n.toUpperCase()))
            out.push(tr("Jméno {name} je v XML dvakrát (velikost písmen se nerozlišuje) — import vezme jen první", { name: n }));
        seen.add(n.toUpperCase());
    }
    const inst = /<Instances>([\s\S]*?)<\/Instances>/.exec(xml)?.[1] || "";
    const glLists = [...inst.matchAll(/<GlobalVars\b[^>]*>([\s\S]*?)<\/GlobalVars>/g)];
    const glVars = glLists.flatMap(m => vars(m[1]));
    const gseen = new Set();
    for (const v of glVars) {
        const k = v.name.toUpperCase();
        if (gseen.has(k))
            out.push(tr("Globální proměnná {name} je v XML dvakrát", { name: v.name }));
        if (seen.has(k))
            out.push(tr("Globální proměnná {name} má stejné jméno jako POU nebo typ", { name: v.name }));
        gseen.add(k);
    }
    /* 3. POU = ST */
    const st = [...splitLibrary(src.lib), src.main].map(t => ({ t, pou: parseStPou(t) }));
    const progName = p.program || parseStPou(src.main).name;
    const xmlName = (s) => s.pou.kind === "program" ? progName : s.pou.name;
    for (const s of st)
        if (!pous.some(x => x.name.toUpperCase() === xmlName(s).toUpperCase()))
            out.push(tr("POU {name} z ST chybí v XML", { name: xmlName(s) }));
    for (const x of pous) {
        const s = st.find(y => xmlName(y).toUpperCase() === x.name.toUpperCase());
        if (!s) {
            out.push(tr("POU {name} z XML není v ST souborech", { name: x.name }));
            continue;
        }
        const want = s.pou.kind === "program" ? "Program" : "FunctionBlock";
        if (x.tag !== want)
            out.push(tr("POU {name}: druh v XML ({a}) ≠ ST ({b})", { name: x.name, a: x.tag, b: want }));
        /* rozhraní: sekce v pořadí, jména a typy */
        const body = x.body.replace(/<MainBody>[\s\S]*<\/MainBody>/, "");
        const got = [], orders = [];
        const params = /<Parameters>([\s\S]*?)<\/Parameters>/.exec(body)?.[1] || "";
        for (const m of params.matchAll(/<(InputVars|OutputVars|InoutVars)\b[^>]*>([\s\S]*?)<\/\1>/g))
            for (const v of vars(m[2])) {
                got.push(PARAM_KIND[m[1]] + ":" + v.name.toUpperCase() + ":" + typeOf(v.inner));
                orders.push(Number(attr(v.head, "orderWithinParamSet")));
            }
        for (const m of body.matchAll(/<Vars\b([^>]*)>([\s\S]*?)<\/Vars>/g)) {
            /* GX Works3: Vars private = lokální návěští (VAR), public = VAR_PUBLIC */
            if (attr(m[1], "accessSpecifier") !== "private")
                out.push(tr("POU {name}: Vars musí mít accessSpecifier private (lokální proměnné VAR)", { name: x.name }));
            for (const v of vars(m[2]))
                got.push("var:" + v.name.toUpperCase() + ":" + typeOf(v.inner));
        }
        for (const m of body.matchAll(/<TempVars\b[^>]*>([\s\S]*?)<\/TempVars>/g))
            for (const v of vars(m[1]))
                got.push("temp:" + v.name.toUpperCase() + ":" + typeOf(v.inner));
        const RANK = ["in", "out", "inout", "var", "temp"];
        const exp = stSections(s.t).flatMap(y => y.vars.map(v => y.kind + ":" + v.name.toUpperCase() + ":" + v.type.toUpperCase()));
        const sortK = (a) => RANK.flatMap(r => a.filter(z => z.startsWith(r + ":")));
        if (sortK(got).join(",") !== sortK(exp).join(","))
            out.push(tr("POU {name}: proměnné v XML ({a}) neodpovídají deklaraci ST ({b})", { name: x.name, a: got.slice(0, 6).join(", ") || "—", b: exp.slice(0, 6).join(", ") || "—" }));
        if (orders.some((o, i) => o !== i + 1))
            out.push(tr("POU {name}: orderWithinParamSet musí jít 1…n v pořadí parametrů", { name: x.name }));
        /* tělo: jen ST, shodné s ST */
        const bc = [...x.body.matchAll(/<BodyContent\b([^>]*)>([\s\S]*?)<\/BodyContent>/g)];
        if (bc.length !== 1 || attr(bc[0][1], "xsi:type") !== "ST") {
            out.push(tr("POU {name}: tělo musí být jedno BodyContent typu ST (GX Works3 importuje jen ST)", { name: x.name }));
            continue;
        }
        const stm = /<ST>([\s\S]*)<\/ST>/.exec(bc[0][2]);
        const text = stm ? unEsc(stm[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")) : "";
        if (text.trim() !== s.pou.body.trim())
            out.push(tr("POU {name}: tělo ST v XML se liší od ST souboru", { name: x.name }));
    }
    /* 4. globální proměnné = tabulka návěští */
    const gx = glVars.map(v => v.name.toUpperCase() + ":" + typeOf(v.inner) + "@" + (attr(/<Address\b[^>]*>/.exec(v.inner)?.[0] || "", "address") || ""));
    const gs = src.globals.map(g => g.name.toUpperCase() + ":" + g.type.toUpperCase() + "@" + (target === "mitsubishi" ? g.address || "" : ""));
    if (gx.join(",") !== gs.join(",")) {
        const miss = gs.filter(v => !gx.includes(v)), extra = gx.filter(v => !gs.includes(v));
        out.push(tr("Globální proměnné v XML se liší od tabulky návěští (jméno : typ @ operand) — chybí v XML: {a}; navíc v XML: {b}", { a: miss.slice(0, 5).join(", ") || "—", b: extra.slice(0, 5).join(", ") || "—" }));
    }
    /* 5. registrace programu a pravidla cíle */
    const res = [...inst.matchAll(/<Resource\b([^>]*)>([\s\S]*?)<\/Resource>/g)];
    const reg = res.some(r => [...r[2].matchAll(/<ProgramInstance\b([^>]*)>/g)].some(m => (attr(m[1], "typeName") || "").toUpperCase() === progName.toUpperCase()));
    if (!reg)
        out.push(tr("Program {name} není registrovaný v Instances/Configuration/Resource/ProgramInstance", { name: progName }));
    if (target === "mitsubishi") {
        if (/<InitialValue\b/.test(xml))
            out.push(tr("XML nese počáteční hodnoty — FX5 je nepodporuje (hodnotu je nutné předat při volání)"));
        if (glLists.length !== 1)
            out.push(tr("GX Works3: globální návěští mají být v jedné sadě GlobalVars (každá je seznam „Global“; duplicitní jméno se přeskočí), je jich {n}", { n: glLists.length }));
        for (const m of xml.matchAll(/<Address\b([^>]*)\/?>/g)) {
            const a = attr(m[1], "address") || "";
            if (/^%/.test(a) || attr(m[1], "location") || attr(m[1], "size"))
                out.push(tr("GX Works3: přiřazení operandu se zapisuje jen do Address.address bez % (např. X0), ne {a}", { a: a || m[0] }));
        }
    }
    return out;
}
/** Emulátor (Mitsubishi): IEC61131-10_Import.xml × Gen_Library.st / MAIN.st / GlobalLabels.csv. */
export function checkIec10Files(files, plat, out) {
    const x = files[IEC10_FILE];
    if (x === undefined || plat !== "mitsubishi")
        return;
    if (files["Gen_Library.st"] === undefined || files["MAIN.st"] === undefined || files["GlobalLabels.csv"] === undefined)
        return;
    /* iec10Source s předanými soubory nic negeneruje (prj se nečte) */
    const src = iec10Source(undefined, "mitsubishi", files);
    for (const msg of iec10Problems(x, src, "mitsubishi"))
        out.push({ level: "error", rule: "iec61131_10", file: IEC10_FILE, line: 0, col: 0, platform: plat, source: IEC10_SRC.gxw3, msg });
}
