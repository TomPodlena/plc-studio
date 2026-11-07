/**
 * PLCdesk — kabelový seznam (CSV, středník): jeden řádek = jeden signál v poli (kanál svorkovnice X<n>:<k>).
 * Svorky a čísla vodičů přesně jako `svorkyCSV` (`modules()` + `wireNo`), typ kabelu jen z řádku kusovníku
 * téhož zařízení. Délku a průřez zadání (bez 3D) neobsahuje → sloupce prázdné, poznámka „doplní projektant“.
 */
import { modules, wireNo, devById, lineSafe, outputSafe } from "./model.js";
import { buildBom } from "./bom.js";
import { tr } from "./i18n.js";
export const CABLE_LIST_FILE = "03_kabelovy_seznam.csv";
export function cableListCsv(prj0) {
    const prj = outputSafe(prj0);
    const cables = buildBom(prj).lines.filter(l => /^cable/.test(l.cat) && l.devId !== undefined);
    const rows = [tr("Kabel;Zařízení;Signál (tag);Odkud;Kam;Vodič;Typ kabelu;Délka;Průřez;Poznámka")];
    const tbd = tr("doplní projektant");
    modules(prj).forEach((m, mi) => m.ch.forEach((e, i) => {
        const w = wireNo(mi + 1, i), d = devById(prj, e.devId);
        const cab = cables.find(l => l.devId === e.devId);
        rows.push([
            "-WK" + w.slice(2), d?.name || "", e.tag, d?.name || "", "X" + (mi + 1) + ":" + (i + 1), w,
            cab ? (cab.orderCode || cab.type) : "", "", "", tbd + (cab ? "" : ", " + tr("typ kabelu")),
        ].map(lineSafe).join(";"));
    }));
    return rows.join("\n");
}
