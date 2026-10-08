/* PLCdesk — data kroku Bezpečnost (společné pro web a desktop).
   Pohled nad návrhem bezpečnostních funkcí z jádra (safety.ts, safety_prog.ts, safety_docs.ts):
   funkce s rizikem, architekturou a výpočtem PL, položky ke schválení se stavem a záznamem,
   důvody, proč položku zatím nejde schválit, bezpečnostní program a výkres okruhu. Výsledek je
   čisté JSON — desktop ho dostane přes most (bridge.mjs, operace `safety`). Úpravy návrhu se
   zapisují do `prj.safety` (SafetyCfg) funkcemi níže; nic se tu neschvaluje samo. */
import {
  tr, syncIO, proposeSafety, safetyApprovalItems, approvalStatus, approvalStatusLabel, safetyProgramFiles,
  safetyCircuitSheet, circuitSheetSVG, circuitSheetDXF, safetyComponents, safetyComponent, targetLabel, plRank,
  programFunctions, SAFETY_CCF_MEASURES, SAFETY_CCF_MIN, SAFETY_FN_CATALOG, safetyParams,
} from "../../../packages/core/dist/index.js";

/** Druh funkce → id v katalogu funkcí (shodné s safety.ts). */
export const SAFETY_KINDS = {
  estop: "emergency_stop", guard: "guard_interlock", guard_lock: "guard_locking", light_curtain: "espe_light_curtain",
  multibeam: "espe_multibeam_access", scanner: "espe_laser_scanner", mat: "pressure_sensitive_mat", two_hand: "two_hand_control",
  enabling: "enabling_device", mode: "operating_mode_selection", muting: "muting", restart: "prevent_unexpected_startup",
  sto: "drive_safe_stop", pneumatic: "pneumatic_safe_exhaust", hydraulic: "hydraulic_safe_stop", vertical: "vertical_axis_holding",
  temperature: "overtemperature_limit", pressure: "overpressure_limit",
};
export const SAFETY_TARGETS = ["siemens", "rockwell", "plcopen", "pilz", "sick", "schmersal", "relay"];
export const PLS = ["a", "b", "c", "d", "e"];
export const CATS = ["B", "1", "2", "3", "4"];

/** Kategorie katalogu komponent pro vstupní subsystém podle druhu funkce. */
const IN_CAT = {
  estop: "estop", guard: "guard_switch", guard_lock: "guard_lock", light_curtain: "light_curtain", multibeam: "light_curtain",
  muting: "light_curtain", scanner: "scanner", two_hand: "two_hand", enabling: "enabling_device", mode: "mode_selector",
};
/** Kategorie katalogu pro výstupní skupinu podle druhu. */
const OUT_CAT = { contactors: "contactor_mirror", heater: "contactor_mirror", sto: "drive_sto", exhaust: "safety_valve" };

/** Režim bezpečné vzdálenosti podle druhu funkce (shodné s distanceOf v safety.ts) a pole, která potřebuje. */
export function distanceFields(kind) {
  const t = ["tStopMs", "tDeviceMs", "tLogicMs"];
  switch (kind) {
    case "light_curtain": case "muting": return [...t, "d", "Z"];
    case "multibeam": return [...t, "Z"];
    case "scanner": return [...t, "d", "H", "Z"];
    case "two_hand": return t;
    case "mat": return [...t, "Z"];
    case "guard": return [...t, "DGT"];
    default: return [];
  }
}

const compOpt = c => ({ id: c.id, label: [c.brand, c.series].filter(Boolean).join(" ") + (c.label ? " — " + c.label : "") + (c.plMax ? " (PL " + c.plMax + ")" : "") });

/** Popisky polí úprav (sdílené: web i desktop, klíče překladu). */
export function fieldLabels() {
  return {
    tStopMs: tr("Změřený doběh stroje [ms]"), tDeviceMs: tr("Reakce ochranného zařízení [ms]"), tLogicMs: tr("Reakce logiky [ms]"),
    d: tr("Rozlišení d [mm]"), H: tr("Výška pole H [mm]"), Z: tr("Přídavek Z [mm]"), DGT: tr("Dosah skrz kryt D_GT [mm]"),
    ss1DelayMs: tr("Zpoždění STO pro SS1 [ms]"), demandS: tr("Doba mezi vyžádáními [s]"),
    dcIn: tr("DC vstupu [%]"), dcOut: tr("DC výstupu [%]"),
    b10dIn: tr("B10d vstupu [cykly]"), b10dOut: tr("B10d výstupu [cykly]"), mttfdIn: tr("MTTFd vstupu [roky]"), mttfdOut: tr("MTTFd výstupu [roky]"),
    dop: tr("Provozní dny za rok"), hop: tr("Provozní hodiny za den"), missionYears: tr("Doba mise [roky]"),
  };
}

/** Parametry grafu rizik ISO 13849-1 (popisky voleb). */
export function riskOptions() {
  return {
    S: [["S1", tr("S1 — lehké, obvykle vratné zranění")], ["S2", tr("S2 — vážné, obvykle nevratné zranění nebo smrt")]],
    F: [["F1", tr("F1 — zřídka, krátká doba vystavení")], ["F2", tr("F2 — často až trvale, dlouhá doba vystavení")]],
    P: [["P1", tr("P1 — vyhnout se je za určitých podmínek možné")], ["P2", tr("P2 — vyhnout se je sotva možné")]],
  };
}

/** Kategorie zastavení IEC 60204-1 (popisky voleb). */
export function stopOptions() {
  return [[0, tr("0 — okamžité odpojení energie")], [1, tr("1 — řízené zastavení, pak odpojení (SS1)")], [2, tr("2 — řízené zastavení, energie zůstává")]];
}

/** Důvody, proč položku zatím nejde schválit — z jádra (`blockers` / `notReady` položky, pravidla v safety.ts). */
const blockersOf = it => it.blockers?.length ? [...it.blockers] : it.ready === false && it.notReady ? [it.notReady] : [];

/**
 * Úplný pohled kroku Bezpečnost. `target` = cíl náhledu bezpečnostního programu (jinak podle návrhu).
 * Projekt se jen čte (kromě srovnání I/O).
 */
export function safetyView(prj, { target } = {}) {
  syncIO(prj);
  const p = proposeSafety(prj);
  const cfg = prj.safety || {};
  const rec = prj.approvals || {};
  const items = safetyApprovalItems(prj);
  const iv = items.map(it => {
    const status = approvalStatus(prj, it);
    const blockers = blockersOf(it);
    return {
      key: it.key, title: it.title, summary: it.summary, status, statusLabel: approvalStatusLabel(status),
      rec: rec[it.key] || null, ready: it.ready !== false, notReady: it.notReady || "", blockers,
      canApprove: !blockers.length && status !== "approved",
    };
  });
  const byKey = Object.fromEntries(iv.map(i => [i.key, i]));
  const plat = prj.platforms[0] || "siemens";
  const comps = {};
  const opts = cat => (comps[cat] ||= safetyComponents(cat, plat).map(compOpt));
  const fns = p.fns.map(f => {
    const c = (cfg.fn || {})[f.ref] || {};
    const inCat = IN_CAT[f.kind] || null;
    const outCats = [...new Set(p.groups.filter(g => f.acts.includes(g.id)).map(g => OUT_CAT[g.kind]).filter(Boolean))];
    const subIn = f.design?.subs.find(s => s.role === "I");
    const subOut = f.design?.subs.find(s => s.role === "O");
    const plr = f.risk.plr, pl = f.design?.pl ?? null;
    return {
      ...f, cfg: c,
      plOk: !!plr && !!pl && plRank(pl) >= plRank(plr),
      fnItem: byKey["safety:" + f.id] || null, designItem: byKey["safety:" + f.id + ":design"] || null,
      inOpts: inCat ? opts(inCat) : [], outOpts: outCats.flatMap(opts),
      compInId: subIn?.comp?.id || "", compOutId: subOut?.comp?.id || "",
      distFields: f.off ? [] : distanceFields(f.kind),
      limiting: plr && f.design ? f.design.subs.filter(s => !s.pl || plRank(s.pl) < plRank(plr)).map(s => s.role + " " + s.label) : [],
      catalogName: tr(SAFETY_FN_CATALOG[f.catalog].name),
    };
  });
  const live = programFunctions(p);
  const progTarget = target && SAFETY_TARGETS.includes(target) ? target : p.target;
  const prog = safetyProgramFiles(prj, progTarget === p.target ? undefined : progTarget);
  let sheet = null;
  if (live.length) {
    const sh = safetyCircuitSheet(prj, p);
    sheet = { svg: circuitSheetSVG(sh), dxf: circuitSheetDXF(sh) };
  }
  const par = safetyParams(prj);
  const devs = prj.devices.filter(d => d.cls === "DI" || d.cls === "DO").map(d => ({ name: d.name, cls: d.cls, desc: d.desc }));
  const counts = {
    fns: p.fns.filter(f => !f.off).length, off: p.fns.filter(f => f.off).length,
    low: fns.filter(f => !f.off && f.design && f.risk.plr && !f.plOk).length,
    approved: iv.filter(i => i.status === "approved").length, total: iv.length,
    ready: iv.filter(i => i.canApprove).length,
  };
  return {
    fns, hazards: p.hazards, warnings: p.warnings, items: iv, byKey, counts,
    groups: p.groups.map(g => ({ id: g.id, kind: g.kind, label: g.label, devs: g.devs })),
    logic: { id: p.logic.id, label: compOpt(p.logic).label, plMax: p.logic.plMax || null },
    target: p.target, targetLabel: targetLabel(p.target),
    params: { dop: par.dop, hop: par.hop, missionYears: par.missionYears, edition: par.edition },
    cfg: { dop: cfg.dop ?? null, hop: cfg.hop ?? null, missionYears: cfg.missionYears ?? null, iso13855: cfg.iso13855 || "", logic: cfg.logic || "", target: cfg.target || "" },
    program: { state: prog.state, target: prog.target, targetLabel: targetLabel(prog.target), files: prog.files, item: byKey["safety:program"] || null },
    sheet,
    options: {
      logic: [...opts("safety_controller"), ...opts("safety_relay")],
      targets: SAFETY_TARGETS.map(t => ({ id: t, label: targetLabel(t) })),
      ccf: SAFETY_CCF_MEASURES.map(m => ({ id: m.id, label: tr(m.label), points: m.points })), ccfMin: SAFETY_CCF_MIN,
      kinds: Object.entries(SAFETY_KINDS).map(([k, c]) => ({ id: k, label: tr(SAFETY_FN_CATALOG[c].name) })),
      risk: riskOptions(), stop: stopOptions(), fields: fieldLabels(), devs,
    },
  };
}

/* ---------------------------------------------------------------- úpravy prj.safety */

const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const empty = v => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "number" && !Number.isFinite(v));

/** Číslo z textu (desetinná čárka i tečka); prázdné / neplatné = null. */
export function parseNum(s) {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const t = String(s ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** Seznam označení z textu („S1, S2 S3“). */
export function parseList(s) {
  return [...new Set(String(s ?? "").split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
}

function tidy(prj) {
  const s = prj.safety;
  if (!s) return;
  if (s.fn) { for (const [k, v] of Object.entries(s.fn)) if (!isObj(v) || !Object.keys(v).length) delete s.fn[k]; if (!Object.keys(s.fn).length) delete s.fn; }
  if (s.add && !s.add.length) delete s.add;
  if (!Object.keys(s).length) delete prj.safety;
}

/** Globální volba (`dop`, `hop`, `missionYears`, `iso13855`, `logic`, `target`); prázdná hodnota = návrh aplikace. */
export function setSafetyParam(prj, key, value) {
  if (!["dop", "hop", "missionYears", "iso13855", "logic", "target"].includes(key)) throw new Error("safety: unknown parameter " + key);
  const s = (prj.safety ||= {});
  let v = value;
  if (["dop", "hop", "missionYears"].includes(key)) { v = parseNum(value); if (v !== null && !(v > 0)) v = null; if (key === "hop" && v > 24) v = 24; if (key === "dop" && v > 366) v = 366; }
  if (key === "iso13855" && v !== "2010" && v !== "2024") v = null;
  if (key === "target" && !SAFETY_TARGETS.includes(v)) v = null;
  if (key === "logic" && !safetyComponent(v)) v = null;
  if (empty(v)) delete s[key]; else s[key] = v;
  tidy(prj);
  return prj;
}

const NUM_FIELDS = ["dcIn", "dcOut", "b10dIn", "b10dOut", "mttfdIn", "mttfdOut", "demandS", "tStopMs", "tDeviceMs", "tLogicMs", "d", "H", "Z", "DGT", "ss1DelayMs"];
const TEXT_FIELDS = ["reduce", "plrSource", "note", "compIn", "compOut"];

/**
 * Úprava jedné funkce (`prj.safety.fn[ref]`): `patch` = pole SafetyFnCfg; null / "" pole smaže
 * (vrátí návrh aplikace). Čísla se berou i jako text s desetinnou čárkou.
 */
export function setFnCfg(prj, ref, patch) {
  const s = (prj.safety ||= {});
  const fn = (s.fn ||= {});
  const c = { ...(fn[ref] || {}) };
  for (const [k, raw] of Object.entries(patch || {})) {
    let v = raw;
    if (NUM_FIELDS.includes(k)) { v = parseNum(raw); if (v !== null && v < 0) v = null; if ((k === "dcIn" || k === "dcOut") && v !== null) v = Math.min(99.9, v); }
    else if (TEXT_FIELDS.includes(k)) v = typeof raw === "string" ? raw.trim() : raw === null || raw === undefined ? null : String(raw);
    else if (k === "off") v = raw ? true : null;
    else if (k === "S") v = raw === "S1" || raw === "S2" ? raw : null;
    else if (k === "F") v = raw === "F1" || raw === "F2" ? raw : null;
    else if (k === "P") v = raw === "P1" || raw === "P2" ? raw : null;
    else if (k === "plr") v = PLS.includes(raw) ? raw : null;
    else if (k === "cat") v = CATS.includes(raw) ? raw : null;
    else if (k === "stopCat") { const n = raw === "" || raw === null || raw === undefined ? null : Number(raw); v = n === 0 || n === 1 || n === 2 ? n : null; }
    else if (k === "inputs" || k === "acts") v = Array.isArray(raw) ? [...new Set(raw.map(String).filter(Boolean))] : parseList(raw);
    else if (k === "ccf") v = Array.isArray(raw) ? raw.filter(id => SAFETY_CCF_MEASURES.some(m => m.id === id)) : null;
    else throw new Error("safety: unknown field " + k);
    if (k === "compIn" || k === "compOut") { if (v && !safetyComponent(v)) v = null; }
    /* CCF: prázdný výběr je platná volba (žádné opatření), ne návrat k návrhu */
    if (k === "ccf" && Array.isArray(v)) { c.ccf = v; continue; }
    if (empty(v)) delete c[k]; else c[k] = v;
  }
  fn[ref] = c;
  tidy(prj);
  return prj;
}
/** Všechny úpravy funkce zpět na návrh aplikace. */
export function resetFnCfg(prj, ref) {
  if (prj.safety?.fn) delete prj.safety.fn[ref];
  tidy(prj);
  return prj;
}
/** Přidá vlastní funkci; vrací její odkaz (`user:N`). */
export function addSafetyFn(prj, { kind, title = "", inputs = [], acts = [] } = {}) {
  if (!SAFETY_KINDS[kind]) throw new Error("safety: unknown kind " + kind);
  const s = (prj.safety ||= {});
  const add = (s.add ||= []);
  let n = 1;
  while (add.some(a => a.ref === "user:" + n)) n++;
  const ref = "user:" + n;
  const ins = Array.isArray(inputs) ? inputs : parseList(inputs);
  add.push({ ref, kind, ...(String(title).trim() ? { title: String(title).trim() } : {}), ...(ins.length ? { inputs: ins } : {}), ...(acts.length ? { acts } : {}) });
  return ref;
}
/** Odebere vlastní funkci (navržené funkce se jen vyřazují). */
export function removeSafetyFn(prj, ref) {
  if (prj.safety?.add) prj.safety.add = prj.safety.add.filter(a => a.ref !== ref);
  resetFnCfg(prj, ref);
  return prj;
}

/** Bezpečnostní data projektu z úložiště / importu v platném tvaru (jinak by shodila návrh). */
export function normSafety(raw) {
  if (!isObj(raw)) return undefined;
  const s = {};
  for (const k of ["dop", "hop", "missionYears"]) if (typeof raw[k] === "number" && Number.isFinite(raw[k]) && raw[k] > 0) s[k] = raw[k];
  if (raw.iso13855 === "2010" || raw.iso13855 === "2024") s.iso13855 = raw.iso13855;
  if (typeof raw.logic === "string" && safetyComponent(raw.logic)) s.logic = raw.logic;
  if (SAFETY_TARGETS.includes(raw.target)) s.target = raw.target;
  if (isObj(raw.fn)) {
    const fn = {};
    for (const [ref, c] of Object.entries(raw.fn)) {
      if (!isObj(c)) continue;
      const tmp = { safety: {} };
      const patch = {};
      for (const [k, v] of Object.entries(c)) if ([...NUM_FIELDS, ...TEXT_FIELDS, "off", "S", "F", "P", "plr", "cat", "stopCat", "inputs", "acts", "ccf"].includes(k)) patch[k] = v;
      setFnCfg(tmp, ref, patch);
      if (tmp.safety?.fn?.[ref]) fn[ref] = tmp.safety.fn[ref];
    }
    if (Object.keys(fn).length) s.fn = fn;
  }
  if (Array.isArray(raw.add)) {
    const add = raw.add.filter(a => isObj(a) && typeof a.ref === "string" && a.ref && typeof a.kind === "string" && Object.prototype.hasOwnProperty.call(SAFETY_KINDS, a.kind)).map(a => ({
      ref: a.ref, kind: a.kind, ...(typeof a.title === "string" && a.title ? { title: a.title } : {}),
      ...(Array.isArray(a.inputs) ? { inputs: a.inputs.filter(x => typeof x === "string") } : {}),
      ...(Array.isArray(a.acts) ? { acts: a.acts.filter(x => typeof x === "string") } : {}),
    }));
    if (add.length) s.add = add;
  }
  return Object.keys(s).length ? s : undefined;
}

/** Výchozí CCF opatření návrhu (když funkce nemá vlastní výběr). */
export const DEFAULT_CCF = ["separation", "overload", "welltried", "emc", "environment"];
