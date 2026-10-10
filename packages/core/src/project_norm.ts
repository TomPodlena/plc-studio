/**
 * PLCdesk — normalizace projektu načteného ze souboru / úložiště (web i desktop, jedno pravidlo).
 *
 * Soubor projektu může přijít odkudkoli (web, desktop, starší verze, ruční úprava, cizí JSON). Kroky
 * i jádro počítají s úplnou strukturou (`blankProject`), takže `normalizeProject`:
 * - vrátí projekt v tvaru modelu — chybějící části doplní z prázdného projektu,
 * - každou hodnotu TYPOVĚ ověří a vadné POLOŽKY zahodí (zařízení bez platného id / třídy, signál
 *   s `devId` = seznam, krok s `dev` = seznam, blokování s objektem…) — celý soubor neodmítne,
 * - jednořádková pole (název, číslo, zákazník, označení, popis zařízení, jednotka, tag, komentář I/O,
 *   adresa, názvy záznamů a poloh) vyčistí `lineSafe` (konce řádků a řídicí znaky → mezera, čistý text beze změny); popis
 *   projektu zůstává víceřádkový (`multiLineSafe`),
 * - vyhodí `Error("not a project")`, jen když vstup není objekt nebo nemá žádnou část projektu
 *   (cizí JSON nesmí přepsat rozpracovaný návrh).
 *
 * Bezpečnostní data (`safety`), revize, nabídku a kopii knihovny normalizují klienti (web `normSafety` /
 * `normBiz`, desktop `project.normalize_safety` / `normalize_biz`) — tady se nepřenášejí.
 * Pravidla vznikla sjednocením web `normProject` a desktop `project.normalize` (test odolnosti 2026-10-08:
 * desktop dřív spadl TypeError na `program.estop` = seznam a aplikace se nespustila).
 */
import {
  blankProject, CLS, PLAT, DO_ROLES, ensureGuids, multiLineSafe, lineSafe,
  type Project, type Device, type IoEntry, type SeqStep, type Dir, type BomCfg, type BomLineCfg,
} from "./model.js";
import { isGuid } from "./guid.js";
import { isIsoDate } from "./project_meta.js";
import type { ApprovalRecord } from "./approval.js";
import type { CommissioningRecord } from "./commission.js";

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
/** Vlastní klíč tabulky (ne „toString“ / „constructor“ z prototypu). */
const ownKey = (o: object, k: unknown): boolean => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
/** Konečné číslo z čísla nebo číselného textu; cokoli jiného = undefined. */
const numOf = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  return undefined;
};
const str = (v: unknown): v is string => typeof v === "string";

/** Číselná pole zařízení, kroku sekvence a konfigurace osy (model.ts Device / SeqStep, axis.ts AxisCfg). */
const DEV_NUM = ["rmin", "rmax", "limHi", "limLo", "setpoint", "rampS", "tol", "tolTimeS", "selBits", "travelS"] as const;
const STEP_NUM = ["sp", "rec", "pos", "vel", "acc", "dec"] as const;
const AXIS_NUM = ["vMax", "aMax", "dMax", "jerk", "vDef", "limNeg", "limPos", "homePos", "posTol", "followMax", "jogVel", "startPos"] as const;
const DIRS: Dir[] = ["DI", "DO", "AI", "AO"];
/** Akce kroků, které generátor zná (model.ts SeqAct) — jiná akce = krok se zahodí. */
export const SEQ_ACTS = ["start", "stop", "open", "close", "wait", "waitOn", "waitOff", "home", "posRecord", "setPressure", "setFlow",
  "moveAbs", "moveRel", "velocity", "halt", "waitInPos"] as const;
/** Části projektu, podle kterých se pozná soubor projektu (jinak „not a project“). */
const PROJECT_KEYS = ["meta", "devices", "io", "program", "platforms"];

/**
 * Projekt z načteného JSON v bezpečném tvaru (viz hlavička souboru). Nejde-li o projekt, vyhodí chybu.
 * Vrácený projekt nese neenumerovatelné `guidsAdded` (true = doplnily se GUID / starý projekt → uložit).
 */
export function normalizeProject(raw: unknown): Project {
  if (!isObj(raw)) throw new Error("not a project");
  if (!PROJECT_KEYS.some(k => ownKey(raw, k))) throw new Error("not a project");
  const p = blankProject();

  /* --- meta: jednořádková pole přes oneLine, popis víceřádkový */
  if (isObj(raw.meta)) {
    const m = raw.meta;
    p.meta = { name: lineSafe(str(m.name) ? m.name : ""), desc: multiLineSafe(str(m.desc) ? m.desc : "") };
    const takt = numOf(m.takt);
    if (typeof m.takt === "number" && takt !== undefined && takt > 0) p.meta.takt = takt;
    for (const f of ["number", "customer"] as const) if (str(m[f]) && lineSafe(m[f]).trim()) p.meta[f] = lineSafe(m[f]);
    /* složka dat projektu (desktop; web ji jen zachová) — cesta, jen bez řídicích znaků */
    if (str(m.dataDir) && lineSafe(m.dataDir).trim()) p.meta.dataDir = lineSafe(m.dataDir);
    if (isIsoDate(m.startDate)) p.meta.startDate = m.startDate;
  }

  if (Array.isArray(raw.platforms)) p.platforms = [...new Set(raw.platforms.filter((k: unknown) => ownKey(PLAT, k)))] as Project["platforms"];
  if (raw.codeStyle === "oop") p.codeStyle = "oop";

  /* --- zařízení: platné id (celé číslo, jedinečné) a třída; ostatní pole typově */
  if (Array.isArray(raw.devices)) {
    const seen = new Set<number>();
    p.devices = raw.devices.filter((d: unknown): d is Record<string, any> => isObj(d) && ownKey(CLS, d.cls) && Number.isInteger(d.id) && !seen.has(d.id as number) && !!seen.add(d.id as number))
      .map(d => normDevice(d));
  }
  const ids = new Set(p.devices.map(d => d.id));
  const clsOf = new Map(p.devices.map(d => [d.id, d.cls]));

  /* --- I/O: klíč, existující zařízení, směr; texty jen řetězce (jednořádkově) */
  if (Array.isArray(raw.io)) {
    const keys = new Set<string>();
    p.io = raw.io.filter((e: unknown): e is Record<string, any> => isObj(e) && str(e.key) && ids.has(e.devId as number) && DIRS.includes(e.dir as Dir) && !keys.has(e.key) && !!keys.add(e.key))
      .map(e => {
        const ne: IoEntry = { key: e.key, devId: e.devId, sig: str(e.sig) ? lineSafe(e.sig) : "", dir: e.dir, tag: str(e.tag) ? lineSafe(e.tag) : "",
          addr: str(e.addr) ? lineSafe(e.addr) : "", cmt: str(e.cmt) ? lineSafe(e.cmt) : "" };
        if (e.nc !== undefined) ne.nc = e.nc === true;
        if (isGuid(e.guid)) ne.guid = e.guid;
        return ne;
      });
  }

  /* --- program: E-stop a blokování jen existující DI, kroky se známou akcí a existujícím zařízením */
  if (isObj(raw.program)) {
    const pr = raw.program;
    const estop = ids.has(pr.estop) && clsOf.get(pr.estop) === "DI" ? pr.estop as number : "";
    const locks = Array.isArray(pr.interlocks) ? [...new Set(pr.interlocks.filter((id: unknown) => ids.has(id as number) && clsOf.get(id as number) === "DI" && id !== estop))] as number[] : [];
    p.program = {
      modes: pr.modes === undefined ? p.program.modes : !!pr.modes,
      estop,
      interlocks: locks,
      seq: Array.isArray(pr.seq) ? pr.seq.filter((s: unknown): s is Record<string, any> => isObj(s) && (SEQ_ACTS as readonly unknown[]).includes(s.act)
        && (s.act === "wait" || ids.has(s.dev as number))).map(s => normStep(s)) : [],
    };
  }

  /* --- kusovník: platforma, výrobce po kategoriích, úpravy řádků (jen texty a čísla) */
  if (isObj(raw.bom)) {
    const b: BomCfg = {};
    if (ownKey(PLAT, raw.bom.plat)) b.plat = raw.bom.plat;
    if (isObj(raw.bom.brand)) {
      const br = Object.fromEntries(Object.entries(raw.bom.brand).filter(([, v]) => str(v) && v));
      if (Object.keys(br).length) b.brand = br as Record<string, string>;
    }
    if (isObj(raw.bom.lines)) {
      const ls: Record<string, BomLineCfg> = {};
      for (const [id, o] of Object.entries(raw.bom.lines)) {
        if (!isObj(o)) continue;
        const c: BomLineCfg = {};
        for (const f of ["brand", "type", "orderCode", "supplier", "note"] as const) if (str(o[f])) c[f] = o[f];
        if (typeof o.qty === "number" && Number.isFinite(o.qty) && o.qty >= 0) c.qty = o.qty;
        if (Object.keys(c).length) ls[id] = c;
      }
      if (Object.keys(ls).length) b.lines = ls;
    }
    if (Object.keys(b).length) p.bom = b;
  }

  /* --- schválení a výsledky oživení: jen záznamy v platném tvaru (jinak by shodily kroky 11–13) */
  if (isObj(raw.approvals)) {
    const a: Record<string, ApprovalRecord> = {};
    for (const [k, r] of Object.entries(raw.approvals)) {
      if (!isObj(r) || !["approved", "rejected", "proposed"].includes(r.state) || !str(r.by) || !r.by.trim() || !str(r.at) || !str(r.hash)) continue;
      a[k] = { state: r.state, by: r.by, at: r.at, hash: r.hash, ...(str(r.note) && r.note ? { note: r.note } : {}) } as ApprovalRecord;
    }
    if (Object.keys(a).length) p.approvals = a;
  }
  if (isObj(raw.commissioning)) {
    const c: Record<string, CommissioningRecord> = {};
    for (const [k, r] of Object.entries(raw.commissioning)) {
      if (!isObj(r) || !["ok", "nok", "na"].includes(r.result) || !str(r.by) || !r.by.trim() || !str(r.at)) continue;
      c[k] = { result: r.result, by: r.by, at: r.at, ...(str(r.note) && r.note ? { note: r.note } : {}), ...(str(r.measured) && r.measured ? { measured: r.measured } : {}) } as CommissioningRecord;
    }
    if (Object.keys(c).length) p.commissioning = c;
  }

  /* --- časy modelu stroje, koncept, GUID, značka sestavy hardwaru */
  if (isObj(raw.sim)) {
    const s: NonNullable<Project["sim"]> = {};
    for (const f of ["motorDelay", "valveTravel"] as const) if (typeof raw.sim[f] === "number" && Number.isFinite(raw.sim[f]) && raw.sim[f] > 0) s[f] = raw.sim[f];
    if (Object.keys(s).length) p.sim = s;
  }
  if (isObj(raw.concept)) p.concept = raw.concept as Project["concept"];
  p.nextId = Math.max(Number.isInteger(raw.nextId) ? raw.nextId : 1, ...p.devices.map(d => d.id + 1));
  if (isGuid(raw.guid)) p.guid = raw.guid;
  if (isObj(raw.moduleGuids)) {
    const mg = Object.fromEntries(Object.entries(raw.moduleGuids).filter(([, g]) => isGuid(g)));
    if (Object.keys(mg).length) p.moduleGuids = mg as Record<string, string>;
  }
  if (isObj(raw.hw) && ownKey(PLAT, raw.hw.plat) && Number.isInteger(raw.hw.ver)) p.hw = { plat: raw.hw.plat, ver: raw.hw.ver };
  /* migrace: starý projekt bez GUID → doplnit; volající ho podle `guidsAdded` uloží (projekt změněn) */
  const added = ensureGuids(p);
  Object.defineProperty(p, "guidsAdded", { value: added || !isGuid(raw.guid), enumerable: false });
  return p;
}

function normDevice(d: Record<string, any>): Device {
  const nd: Device = {
    ...(d as object),
    id: d.id, cls: d.cls,
    name: lineSafe(str(d.name) ? d.name : "") || d.cls + d.id,
    desc: lineSafe(str(d.desc) ? d.desc : ""),
    unit: lineSafe(str(d.unit) ? d.unit : ""),
    opt: isObj(d.opt) ? Object.fromEntries(Object.entries(d.opt).map(([k, v]) => [k, !!v])) : {},
  } as Device;
  const rec = nd as unknown as Record<string, unknown>;
  /* čísla jen jako konečná čísla (text z cizího JSON by se dostal do HTML i do kódu) */
  for (const f of DEV_NUM) { const n = numOf(d[f]); if (n === undefined) delete rec[f]; else rec[f] = n; }
  /* rozsah je povinný (měřítko analogů v kódu): neplatný → výchozí 0–100 jako při přidání zařízení */
  if (d.rmin !== undefined && nd.rmin === undefined) nd.rmin = 0;
  if (d.rmax !== undefined && nd.rmax === undefined) nd.rmax = 100;
  if (!ownKey(DO_ROLES, d.role)) delete nd.role;
  if (!str(d.libType)) delete nd.libType;
  if (!isGuid(d.guid)) delete nd.guid;
  /* polohovací pohon: tabulka záznamů jen v platném tvaru (číslo, název, poloha, rychlost) */
  if (d.records !== undefined) {
    if (Array.isArray(d.records)) nd.records = d.records.filter((r: unknown): r is Record<string, any> => isObj(r) && Number.isInteger(r.no))
      .map(r => ({ no: r.no, name: lineSafe(str(r.name) ? r.name : ""), ...(numOf(r.pos) !== undefined ? { pos: numOf(r.pos)! } : {}), ...(numOf(r.vel) !== undefined ? { vel: numOf(r.vel)! } : {}) }));
    else delete nd.records;
  }
  /* servoosa: konfigurační list — čísla, text pohonu, pojmenované polohy (řetězec / seznam místo objektu = pryč) */
  if (d.axis !== undefined) {
    if (isObj(d.axis)) {
      const a: Record<string, unknown> = {};
      for (const f of AXIS_NUM) { const n = numOf(d.axis[f]); if (n !== undefined) a[f] = n; }
      if (str(d.axis.drive) && lineSafe(d.axis.drive).trim()) a.drive = lineSafe(d.axis.drive);
      if (Array.isArray(d.axis.positions)) a.positions = d.axis.positions.filter((x: unknown): x is Record<string, any> => isObj(x) && numOf(x.pos) !== undefined)
        .map(x => ({ name: lineSafe(str(x.name) ? x.name : ""), pos: numOf(x.pos)! }));
      nd.axis = a as Device["axis"];
    } else delete nd.axis;
  }
  return nd;
}

function normStep(s: Record<string, any>): SeqStep {
  /* čekání bez zařízení: dev vždy 0 (cizí hodnota by šla do data-* atributů výkresů) */
  const t = numOf(s.timeS);
  const ns = { ...s, dev: s.act === "wait" ? (s.dev === "" ? "" : 0) : s.dev, timeS: t !== undefined ? t : 1 } as SeqStep & Record<string, unknown>;
  /* přechod jen „fbk“ / „time“; jiná hodnota = výchozí, chybějící zůstává chybět (otisky schválení) */
  if (s.cond !== undefined && s.cond !== "fbk" && s.cond !== "time") ns.cond = s.act === "wait" ? "time" : "fbk";
  for (const f of STEP_NUM) { const n = numOf(s[f]); if (n === undefined) delete ns[f]; else ns[f] = n; }
  if (s.rev !== undefined) ns.rev = s.rev === true;
  if (str(s.posRef) && lineSafe(s.posRef).trim()) ns.posRef = lineSafe(s.posRef); else delete ns.posRef;
  return ns;
}
