/**
 * Referenční (golden) výstupy generátoru — hlídač refaktoringu „beze změny výstupu".
 *
 * Pro každý projekt (příklady `samples/*.plcstudio.json` + `sampleSmall` + `sampleComplex`)
 * × 5 jazyků se vygenerují všechny soubory programu pro 8 platforem (`genFor`: zdroje, tagy,
 * L5X, Unitronics, PLCopen XML, README) a dokumentace (`docFiles`). Uloží se jen otisk
 * (SHA-256) a velikost každého souboru v `packages/core/test-data/golden/<projekt>.json`;
 * test `golden.test.ts` je porovná. Přegenerování (jen při VĚDOMÉ změně výstupu, se
 * zdůvodněním v commitu): `node scripts/golden.mjs --write`.
 *
 * Modul není součástí veřejného API (`index.ts` ho neexportuje) — používá ho skript a test.
 * Hash dodává volající (node:crypto), jádro tak zůstává bez závislostí na Node.
 */
/* celé jádro: moduly, které se přihlašují k dokumentaci při načtení (registerDocProvider),
   musí být načtené stejně ve skriptu i v testu — jinak by se sada dokumentů lišila */
import "./index.js";
import { Project, PlatformKey, PLAT, blankProject, syncIO } from "./model.js";
import { setLang, LANGS, type Lang } from "./i18n.js";
import { genFor } from "./codegen.js";
import { docFiles } from "./docs.js";
import { sampleSmall, sampleComplex } from "./samples.js";

/** Otisk jednoho souboru. */
export interface GoldenEntry { sha256: string; size: number; }
/** Otisky projektu: jazyk → cesta souboru (`code/<platforma>/<soubor>`, `docs/<soubor>`) → otisk. */
export type GoldenSet = Record<string, Record<string, GoldenEntry>>;

/** Pevný okamžik pro výstupy s datem (dokumentace, PLCopen XML): 2026-01-15 12:00 UTC. */
export const GOLDEN_TIME = Date.UTC(2026, 0, 15, 12, 0, 0);

/** Platformy, pro které se generuje kód (všechny, vč. profilů CODESYS — WAGO, Delta AX). */
export const GOLDEN_PLATFORMS = Object.keys(PLAT) as PlatformKey[];
/**
 * Platformy projektu v referenci (`prj.platforms`) — pevně původních 8, aby nové platformy
 * nezměnily dokumentaci (výčty platforem, ověření) starých otisků; kód nových platforem
 * přibyl jako nové soubory.
 */
export const GOLDEN_PROJECT_PLATFORMS: PlatformKey[] = ["siemens", "rockwell", "beckhoff", "codesys", "mitsubishi", "schneider", "omron", "unitronics"];
/** Platformy se stylem kódu OOP — v referenci navíc `code-oop/<platforma>/<soubor>`. */
export const GOLDEN_OOP_PLATFORMS = GOLDEN_PLATFORMS.filter(p => PLAT[p].oop);
export const GOLDEN_LANGS = Object.keys(LANGS) as Lang[];

/** Vestavěné ukázky — vznikají v právě nastaveném jazyce, proto se tvoří pro každý jazyk znovu. */
export const GOLDEN_BUILTIN: Record<string, () => Project> = { sampleSmall, sampleComplex };

/** Projekt z uloženého souboru (formát desktopu / exportu webu), se všemi platformami. */
export function goldenProject(raw: unknown): Project {
  const r = raw as { prj?: unknown };
  const prj = Object.assign(blankProject(), (r && r.prj) || raw) as Project;
  prj.platforms = [...GOLDEN_PROJECT_PLATFORMS];
  syncIO(prj);
  return prj;
}

/**
 * Provede `fn` s pevným časem (`new Date()` / `Date.now()` = `GOLDEN_TIME`) a časovým pásmem UTC.
 * Výstup se tím nemění — jen se v testu odstraní závislost na dni a hodině běhu.
 */
export function withFixedClock<T>(fn: () => T): T {
  const G = globalThis as unknown as { Date: DateConstructor; process?: { env: Record<string, string | undefined> } };
  const Real = G.Date;
  const env = G.process?.env;
  const tz = env ? env.TZ : undefined;
  if (env) env.TZ = "UTC";
  class FixedDate extends Real {
    constructor(...a: unknown[]) {
      if (a.length) super(...(a as [number])); else super(GOLDEN_TIME);
    }
    static now(): number { return GOLDEN_TIME; }
  }
  G.Date = FixedDate as unknown as DateConstructor;
  try { return fn(); } finally {
    G.Date = Real;
    if (env) { if (tz === undefined) delete env.TZ; else env.TZ = tz; }
  }
}

/** Všechny sledované soubory projektu v jazyce `lang` (nastaví jazyk; volat uvnitř `withFixedClock`). */
export function goldenFiles(make: () => Project, lang: Lang, docs = true): Record<string, string> {
  setLang(lang);
  const prj = make();
  const out: Record<string, string> = {};
  for (const p of GOLDEN_PLATFORMS) {
    for (const [n, b] of Object.entries(genFor(prj, p))) out["code/" + p + "/" + n] = b;
  }
  /* styl kódu OOP (rodina CODESYS): stejný projekt, jiný zápis */
  const oop: Project = { ...prj, codeStyle: "oop" };
  for (const p of GOLDEN_OOP_PLATFORMS) {
    for (const [n, b] of Object.entries(genFor(oop, p))) out["code-oop/" + p + "/" + n] = b;
  }
  /* dokumentace obsahuje ověření simulací — u velkých příkladů desítky sekund na jazyk */
  if (docs) for (const f of docFiles(prj)) out["docs/" + f.path] = f.body;
  return out;
}

export interface GoldenOptions {
  /** pro které jazyky generovat i dokumentaci (výchozí: všechny) */
  docs?: (lang: Lang) => boolean;
  /** plné výstupy (výpis pro diff) */
  onFiles?: (lang: Lang, files: Record<string, string>) => void;
}

/** Otisky souborů všech jazyků. `hash` = SHA-256 v hex (dodá volající). */
export function goldenSet(make: () => Project, hash: (s: string) => string, opts: GoldenOptions = {}): GoldenSet {
  const enc = new TextEncoder();
  const res: GoldenSet = {};
  const onFiles = opts.onFiles;
  try {
    withFixedClock(() => {
      for (const l of GOLDEN_LANGS) {
        const files = goldenFiles(make, l, opts.docs ? opts.docs(l) : true);
        if (onFiles) onFiles(l, files);
        const m: Record<string, GoldenEntry> = {};
        for (const k of Object.keys(files).sort()) m[k] = { sha256: hash(files[k]), size: enc.encode(files[k]).length };
        res[l] = m;
      }
    });
  } finally { setLang("cs"); }
  return res;
}

/**
 * Rozdíly dvou sad otisků (chybějící, přebývající a změněné soubory) jako čitelné řádky.
 * Když `got` v některém jazyce neobsahuje dokumentaci (vynechaná volbou `docs`), porovná
 * se v tom jazyce jen kód.
 */
export function goldenDiff(want: GoldenSet, got: GoldenSet): string[] {
  const out: string[] = [];
  for (const l of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const a = want[l] || {}, b = got[l] || {};
    const docs = Object.keys(b).some(k => k.startsWith("docs/"));
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!docs && k.startsWith("docs/")) continue;
      if (!b[k]) out.push(l + " " + k + ": chybí ve výstupu");
      else if (!a[k]) out.push(l + " " + k + ": nový soubor (není v referenci)");
      else if (a[k].sha256 !== b[k].sha256) out.push(l + " " + k + ": změněn (" + a[k].size + " → " + b[k].size + " B)");
    }
  }
  return out;
}
