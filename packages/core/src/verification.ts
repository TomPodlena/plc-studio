/**
 * Ověření platforem — jediný zdroj pravdy je `data/verification.json` (scripts/build_verification.py
 * z něj generuje `verification_data.ts`). Odtud berou štítek ověření README každé platformy (`genFor`),
 * výběr platforem v aplikaci (web i desktop: čip + bublina, co neověřeno) a stránka Platformy webu
 * (apps/site/scripts/build.js čte přímo JSON).
 *
 * Stavy: `verified` = výstup importován a přeložen ve skutečném IDE, `lang` = jazyk ověřen překladačem
 * (CODESYS pro platformy na jeho bázi, překladač ST UniLogicu), import v IDE výrobce neověřen,
 * `beta` = jen emulátor PLCdesk, `unsupported` = platforma výstup negeneruje.
 * Po každém ověření naostro: záznam do JSON + protokol do docs/verification/ (viz CLAUDE.md).
 */
import { N_, tr } from "./i18n.js";
import type { PlatformKey } from "./model.js";
import { VERIFICATION_DATA } from "./verification_data.js";

export type VerifState = "verified" | "lang" | "beta" | "unsupported";
/** Stav jednoho výstupního souboru: ide = import a překlad v IDE, compiler = překladač, xsd = schéma,
 *  structure = kontrola struktury (emulátor), emulator = jen emulátor PLCdesk. */
export type VerifFormatState = "ide" | "compiler" | "xsd" | "structure" | "emulator";
export type VerifScope = "classic" | "oop" | "motion" | "axis" | "plcopen" | "iec61131-10";

export interface VerifFormat { file: string; state: VerifFormatState; note?: string; }
export interface PlatformVerification {
  state: VerifState;
  /** IDE / překladač a verze, ve které ověřeno (technický text); null = jen emulátor */
  ide: string | null;
  /** datum ověření RRRR-MM-DD */
  date: string;
  scope: VerifScope[];
  /** co a jak ověřeno (klíč překladu) */
  summary: string;
  /** co neověřeno (klíč překladu) */
  notVerified: string;
  /** protokoly v repozitáři (cesty od kořene) */
  evidence: string[];
  formats: VerifFormat[];
}

export const VERIFICATION: Record<PlatformKey, PlatformVerification> = VERIFICATION_DATA;

/** Krátký štítek stavu (čip v aplikaci, web). */
export const VERIF_STATE_LABEL: Record<VerifState, string> = {
  verified: N_("ověřeno v IDE"),
  lang: N_("jazyk ověřen"),
  beta: N_("beta"),
  unsupported: N_("nepodporováno"),
};
/** Význam stavu jednou větou (bublina). */
export const VERIF_STATE_HINT: Record<VerifState, string> = {
  verified: N_("Výstup importován a přeložen ve skutečném vývojovém prostředí."),
  lang: N_("Jazyk ověřen překladačem; import ve vývojovém prostředí výrobce neověřen."),
  beta: N_("Ověřeno jen emulátorem PLCdesk; import ve vývojovém prostředí výrobce neověřen."),
  unsupported: N_("Platforma tento výstup negeneruje."),
};
export const VERIF_FORMAT_LABEL: Record<VerifFormatState, string> = {
  ide: N_("import a překlad ověřen"),
  compiler: N_("ověřeno překladačem, import v IDE výrobce neověřen"),
  xsd: N_("validováno schématem XSD, import neověřen"),
  structure: N_("kontrola struktury, import neověřen"),
  emulator: N_("emulátor PLCdesk, import neověřen"),
};
export const VERIF_SCOPE_LABEL: Record<VerifScope, string> = {
  classic: N_("klasický styl"),
  oop: "OOP",
  motion: N_("pohony přes I/O"),
  axis: N_("servoosa"),
  plcopen: "PLCopen XML",
  "iec61131-10": "IEC 61131-10 XML",
};

/** Záznam ověření platformy (bez překladu). */
export function verificationOf(plat: PlatformKey): PlatformVerification {
  return VERIFICATION[plat];
}

/** Nejnovější datum ověření ze všech platforem (web: „Stav k“). */
export function verificationLatest(): string {
  return Object.values(VERIFICATION).map(v => v.date).sort().pop() || "";
}

/** Ověření platformy s texty v nastaveném jazyce (UI: čip a bublina). */
export interface VerifInfo {
  state: VerifState;
  label: string;
  hint: string;
  ide: string | null;
  date: string;
  scope: string[];
  summary: string;
  notVerified: string;
  formats: { file: string; state: VerifFormatState; label: string; note: string }[];
  /** text bubliny: význam stavu, co ověřeno, kde a kdy, co neověřeno */
  tip: string;
}

export function verificationInfo(plat: PlatformKey): VerifInfo {
  const v = VERIFICATION[plat];
  const summary = tr(v.summary), notVerified = tr(v.notVerified);
  const where = v.ide ? tr("Ověřeno v: {ide}, {date}.", { ide: v.ide, date: v.date }) : tr("Stav k {date}.", { date: v.date });
  return {
    state: v.state, label: tr(VERIF_STATE_LABEL[v.state]), hint: tr(VERIF_STATE_HINT[v.state]),
    ide: v.ide, date: v.date, scope: v.scope.map(s => tr(VERIF_SCOPE_LABEL[s])), summary, notVerified,
    formats: v.formats.map(f => ({ file: f.file, state: f.state, label: tr(VERIF_FORMAT_LABEL[f.state]), note: f.note ? tr(f.note) : "" })),
    tip: [tr(VERIF_STATE_HINT[v.state]), summary + ".", where, tr("Neověřeno: {list}.", { list: notVerified })].join("\n"),
  };
}

/**
 * Štítek ověření do README platformy (`genFor`): stav, co ověřeno, kde a kdy, co neověřeno a stav
 * jednotlivých výstupů. Generuje se jednotně pro všechny platformy — ručně psané věty o ověření
 * v README nepatří.
 */
export function verificationReadme(plat: PlatformKey): string {
  const i = verificationInfo(plat);
  const fm = i.formats.map(f => f.file + " (" + f.label + (f.note ? "; " + f.note : "") + ")").join("; ");
  return [
    tr("STAV OVĚŘENÍ: {label} — {summary}.", { label: i.label.toUpperCase(), summary: i.summary }),
    (i.ide ? tr("Ověřeno v: {ide}, {date}.", { ide: i.ide, date: i.date }) : tr("Stav k {date}.", { date: i.date }))
      + (i.scope.length ? " " + tr("Rozsah: {list}.", { list: i.scope.join(", ") }) : ""),
    tr("Neověřeno: {list}.", { list: i.notVerified }),
    ...(fm ? [tr("Výstupy: {list}.", { list: fm })] : []),
  ].join("\n");
}
