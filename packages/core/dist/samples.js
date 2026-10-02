/** Ukázkové projekty (demo, testy). */
import { blankProject, syncIO } from "./model.js";
import { tr } from "./i18n.js";
function mk(prj, name, cls, desc, opt, unit, rmin, rmax) {
    const d = { id: prj.nextId++, name, cls, desc, opt: opt || {}, unit: unit || "", rmin: rmin ?? 0, rmax: rmax ?? 100 };
    prj.devices.push(d);
    return d;
}
/*
 * Texty ukázek se překládají při vytvoření (ukázka se načte v právě nastaveném jazyce);
 * pak už jsou obsahem projektu. Zkratka „(NC)" v popisu řídí příznak rozpínacího kontaktu
 * v syncIO — v překladu musí zůstat doslova.
 */
/** Malá hydraulická zkušební stanice (7 zařízení, 5 kroků sekvence). */
export function sampleSmall() {
    const p = blankProject();
    p.meta = {
        name: tr("Hydraulická zkušební stanice (ukázka)"),
        desc: tr("Ukázkový projekt — čerpadlo, upínací ventil, tlak, teplota, bezpečnostní vstupy."),
    };
    const M1 = mk(p, "M1", "Motor", tr("Čerpadlo hydrauliky"), { fbk: true, fault: true });
    const Y1 = mk(p, "Y1", "Ventil", tr("Ventil upínání"), { fbkOpen: true, fbkClosed: true });
    mk(p, "B1", "AnalogIn", tr("Tlak hydrauliky"), {}, "bar", 0, 250);
    mk(p, "B2", "AnalogIn", tr("Teplota oleje"), {}, "°C", 0, 100);
    const S1 = mk(p, "S1", "DI", tr("Nouzové zastavení (NC)"));
    const S2 = mk(p, "S2", "DI", tr("Krytí zavřeno"));
    mk(p, "H1", "DO", tr("Signálka Připraveno"));
    syncIO(p);
    p.program = {
        modes: true, estop: S1.id, interlocks: [S2.id], seq: [
            { dev: Y1.id, act: "open", cond: "fbk", timeS: 5 },
            { dev: M1.id, act: "start", cond: "fbk", timeS: 3 },
            { dev: 0, act: "wait", cond: "time", timeS: 5 },
            { dev: M1.id, act: "stop", cond: "fbk", timeS: 3 },
            { dev: Y1.id, act: "close", cond: "fbk", timeS: 5 },
        ],
    };
    return p;
}
/** Lisovací a značicí linka LL-03 (29 zařízení, 18 kroků sekvence). */
export function sampleComplex() {
    const p = blankProject();
    p.meta = {
        name: tr("Lisovací a značicí linka LL-03 (složitý příklad)"),
        desc: tr("Podavač dílů, manipulátor s vakuem, hydraulický lis se značením a výstupní dopravník; dvouruční spouštění, světelná závora, dva kryty."),
    };
    mk(p, "M1", "Motor", tr("Vstupní pásový dopravník"), { fbk: true, fault: true });
    mk(p, "M2", "Motor", tr("Výstupní pásový dopravník"), { fbk: true, fault: true });
    mk(p, "M3", "Motor", tr("Vibrační podavač dílů"), { fbk: false, fault: false });
    mk(p, "M4", "Motor", tr("Čerpadlo hydraulického agregátu"), { fbk: true, fault: true });
    mk(p, "Y1", "Ventil", tr("Lisovací válec"), { fbkOpen: true, fbkClosed: true });
    mk(p, "Y2", "Ventil", tr("Upínací válec levý"), { fbkOpen: true, fbkClosed: true });
    mk(p, "Y3", "Ventil", tr("Upínací válec pravý"), { fbkOpen: true, fbkClosed: true });
    mk(p, "Y4", "Ventil", tr("Manipulátor — přesuv do lisu"), { fbkOpen: true, fbkClosed: true });
    mk(p, "Y5", "Ventil", tr("Vakuová přísavka manipulátoru"), { fbkOpen: true, fbkClosed: false });
    mk(p, "Y6", "Ventil", tr("Značicí jednotka (razicí válec)"), { fbkOpen: false, fbkClosed: false });
    mk(p, "B1", "AnalogIn", tr("Tlak hydrauliky"), {}, "bar", 0, 250);
    mk(p, "B2", "AnalogIn", tr("Teplota oleje"), {}, "°C", 0, 100);
    mk(p, "B3", "AnalogIn", tr("Lisovací síla (tenzometr)"), {}, "kN", 0, 400);
    mk(p, "B4", "AnalogIn", tr("Poloha lisu (lineární snímač)"), {}, "mm", 0, 500);
    mk(p, "B5", "AnalogIn", tr("Průtok chlazení"), {}, "l/min", 0, 60);
    mk(p, "U1", "AnalogOut", tr("Proporcionální ventil tlaku"), {}, "%", 0, 100);
    mk(p, "U2", "AnalogOut", tr("Žádaná rychlost dopravníku M2"), {}, "%", 0, 100);
    mk(p, "S1", "DI", tr("Nouzové zastavení (NC)"));
    mk(p, "S2", "DI", tr("Kryt levý zavřen (NC)"));
    mk(p, "S3", "DI", tr("Kryt pravý zavřen (NC)"));
    mk(p, "S4", "DI", tr("Světelná závora volná"));
    mk(p, "S5", "DI", tr("Dvouruční spouštění — tlačítko A"));
    mk(p, "S6", "DI", tr("Dvouruční spouštění — tlačítko B"));
    mk(p, "S7", "DI", tr("Díl v pozici pod manipulátorem"));
    mk(p, "S8", "DI", tr("Zásobník dílů prázdný"));
    mk(p, "H1", "DO", tr("Maják zelená — chod"));
    mk(p, "H2", "DO", tr("Maják červená — porucha"));
    mk(p, "H3", "DO", tr("Houkačka — start cyklu"));
    mk(p, "H4", "DO", tr("Elektromagnetický zámek krytů"));
    syncIO(p);
    const id = (n) => (p.devices.find(d => d.name === n) || { id: 0 }).id;
    p.program = {
        modes: true, estop: id("S1"), interlocks: [id("S2"), id("S3"), id("S4")], seq: [
            { dev: id("M3"), act: "start", cond: "time", timeS: 2 },
            { dev: id("M1"), act: "start", cond: "fbk", timeS: 3 },
            { dev: id("Y4"), act: "open", cond: "fbk", timeS: 5 },
            { dev: id("Y5"), act: "open", cond: "fbk", timeS: 2 },
            { dev: id("Y4"), act: "close", cond: "fbk", timeS: 5 },
            { dev: id("Y2"), act: "open", cond: "fbk", timeS: 4 },
            { dev: id("Y3"), act: "open", cond: "fbk", timeS: 4 },
            { dev: id("M4"), act: "start", cond: "fbk", timeS: 3 },
            { dev: id("Y1"), act: "open", cond: "fbk", timeS: 8 },
            { dev: 0, act: "wait", cond: "time", timeS: 5 },
            { dev: id("Y1"), act: "close", cond: "fbk", timeS: 8 },
            { dev: id("M4"), act: "stop", cond: "fbk", timeS: 3 },
            { dev: id("Y6"), act: "open", cond: "time", timeS: 1 },
            { dev: id("Y6"), act: "close", cond: "time", timeS: 1 },
            { dev: id("Y2"), act: "close", cond: "fbk", timeS: 4 },
            { dev: id("Y3"), act: "close", cond: "fbk", timeS: 4 },
            { dev: id("Y5"), act: "close", cond: "time", timeS: 1 },
            { dev: id("M2"), act: "start", cond: "fbk", timeS: 3 },
        ],
    };
    return p;
}
