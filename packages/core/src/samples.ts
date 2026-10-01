/** Ukázkové projekty (demo, testy). */
import { Project, Device, DeviceClass, blankProject, syncIO } from "./model.js";

function mk(prj: Project, name: string, cls: DeviceClass, desc: string,
  opt?: Record<string, boolean>, unit?: string, rmin?: number, rmax?: number): Device {
  const d: Device = { id: prj.nextId++, name, cls, desc, opt: opt || {}, unit: unit || "", rmin: rmin ?? 0, rmax: rmax ?? 100 };
  prj.devices.push(d);
  return d;
}

/** Malá hydraulická zkušební stanice (7 zařízení, 5 kroků sekvence). */
export function sampleSmall(): Project {
  const p = blankProject();
  p.meta = {
    name: "Hydraulická zkušební stanice (ukázka)",
    desc: "Ukázkový projekt — čerpadlo, upínací ventil, tlak, teplota, bezpečnostní vstupy.",
  };
  const M1 = mk(p, "M1", "Motor", "Čerpadlo hydrauliky", { fbk: true, fault: true });
  const Y1 = mk(p, "Y1", "Ventil", "Ventil upínání", { fbkOpen: true, fbkClosed: true });
  mk(p, "B1", "AnalogIn", "Tlak hydrauliky", {}, "bar", 0, 250);
  mk(p, "B2", "AnalogIn", "Teplota oleje", {}, "°C", 0, 100);
  const S1 = mk(p, "S1", "DI", "Nouzové zastavení (NC)");
  mk(p, "S2", "DI", "Krytí zavřeno");
  mk(p, "H1", "DO", "Signálka Připraveno");
  syncIO(p);
  p.program = {
    modes: true, estop: S1.id, seq: [
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
export function sampleComplex(): Project {
  const p = blankProject();
  p.meta = {
    name: "Lisovací a značicí linka LL-03 (složitý příklad)",
    desc: "Podavač dílů, manipulátor s vakuem, hydraulický lis se značením a výstupní dopravník; dvouruční spouštění, světelná závora, dva kryty.",
  };
  mk(p, "M1", "Motor", "Vstupní pásový dopravník", { fbk: true, fault: true });
  mk(p, "M2", "Motor", "Výstupní pásový dopravník", { fbk: true, fault: true });
  mk(p, "M3", "Motor", "Vibrační podavač dílů", { fbk: false, fault: false });
  mk(p, "M4", "Motor", "Čerpadlo hydraulického agregátu", { fbk: true, fault: true });
  mk(p, "Y1", "Ventil", "Lisovací válec", { fbkOpen: true, fbkClosed: true });
  mk(p, "Y2", "Ventil", "Upínací válec levý", { fbkOpen: true, fbkClosed: true });
  mk(p, "Y3", "Ventil", "Upínací válec pravý", { fbkOpen: true, fbkClosed: true });
  mk(p, "Y4", "Ventil", "Manipulátor — přesuv do lisu", { fbkOpen: true, fbkClosed: true });
  mk(p, "Y5", "Ventil", "Vakuová přísavka manipulátoru", { fbkOpen: true, fbkClosed: false });
  mk(p, "Y6", "Ventil", "Značicí jednotka (razicí válec)", { fbkOpen: false, fbkClosed: false });
  mk(p, "B1", "AnalogIn", "Tlak hydrauliky", {}, "bar", 0, 250);
  mk(p, "B2", "AnalogIn", "Teplota oleje", {}, "°C", 0, 100);
  mk(p, "B3", "AnalogIn", "Lisovací síla (tenzometr)", {}, "kN", 0, 400);
  mk(p, "B4", "AnalogIn", "Poloha lisu (lineární snímač)", {}, "mm", 0, 500);
  mk(p, "B5", "AnalogIn", "Průtok chlazení", {}, "l/min", 0, 60);
  mk(p, "U1", "AnalogOut", "Proporcionální ventil tlaku", {}, "%", 0, 100);
  mk(p, "U2", "AnalogOut", "Žádaná rychlost dopravníku M2", {}, "%", 0, 100);
  mk(p, "S1", "DI", "Nouzové zastavení (NC)");
  mk(p, "S2", "DI", "Kryt levý zavřen (NC)");
  mk(p, "S3", "DI", "Kryt pravý zavřen (NC)");
  mk(p, "S4", "DI", "Světelná závora volná");
  mk(p, "S5", "DI", "Dvouruční spouštění — tlačítko A");
  mk(p, "S6", "DI", "Dvouruční spouštění — tlačítko B");
  mk(p, "S7", "DI", "Díl v pozici pod manipulátorem");
  mk(p, "S8", "DI", "Zásobník dílů prázdný");
  mk(p, "H1", "DO", "Maják zelená — chod");
  mk(p, "H2", "DO", "Maják červená — porucha");
  mk(p, "H3", "DO", "Houkačka — start cyklu");
  mk(p, "H4", "DO", "Elektromagnetický zámek krytů");
  syncIO(p);
  const id = (n: string) => (p.devices.find(d => d.name === n) || { id: 0 }).id;
  p.program = {
    modes: true, estop: id("S1"), seq: [
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
