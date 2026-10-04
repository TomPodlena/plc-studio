/**
 * PLCdesk — lexer IEC 61131-3 ST / Siemens SCL / Logix ST (emulátor překladu).
 * Tokeny nesou polohu (řádek:sloupec); komentáře se přeskakují (vnořené dle dialektu).
 */
import type { Token, EmuFinding } from "./types.js";
import { tr } from "../i18n.js";

/** Strukturní klíčová slova (parser je porovnává velkými písmeny). */
const KW = new Set(("IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT "
  + "EXIT CONTINUE RETURN AND OR XOR NOT MOD TRUE FALSE FUNCTION_BLOCK END_FUNCTION_BLOCK FUNCTION END_FUNCTION PROGRAM END_PROGRAM "
  + "VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_GLOBAL VAR_EXTERNAL VAR_STAT VAR_INST END_VAR CONSTANT RETAIN NON_RETAIN PERSISTENT "
  + "TYPE END_TYPE STRUCT END_STRUCT ARRAY AT METHOD END_METHOD INTERFACE END_INTERFACE PROPERTY END_PROPERTY EXTENDS IMPLEMENTS "
  + "ACTION END_ACTION BEGIN REGION END_REGION DATA_BLOCK END_DATA_BLOCK ORGANIZATION_BLOCK END_ORGANIZATION_BLOCK").split(" "));

export interface LexOptions { nestedComments: boolean; scl: boolean; }

export interface LexResult { toks: Token[]; errors: EmuFinding[]; }

const isIdStart = (c: string) => /[A-Za-z_]/.test(c) || c > "\x7f";
const isIdChar = (c: string) => /[A-Za-z0-9_]/.test(c) || c > "\x7f";

/** Milisekundy z těla časového literálu (`5S`, `1s500ms`, `1h_2m`, `1.5s`); NaN = neplatné. */
export function timeMs(body: string): number {
  let s = body.replace(/_/g, "").toLowerCase(), sign = 1;
  if (s.startsWith("-")) { sign = -1; s = s.slice(1); }
  if (!s) return NaN;
  const re = /(\d+(?:\.\d+)?)(ms|us|ns|d|h|m|s)/gy;
  let ms = 0, m: RegExpExecArray | null, at = 0;
  const unit: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1, us: 0.001, ns: 0.000001 };
  while ((m = re.exec(s))) { ms += parseFloat(m[1]) * unit[m[2]]; at = re.lastIndex; }
  return at === s.length ? sign * ms : NaN;
}

/** Číselný literál od pozice `i`: desítkový, reálný (1.0E+6) nebo s bází (16#8001). */
function readNumber(src: string, i: number): { text: string; v: number; real: boolean; base?: number; end: number; bad: boolean } {
  const n = src.length;
  let j = i;
  while (j < n && /[0-9_]/.test(src[j])) j++;
  if (src[j] === "#") {
    const b = parseInt(src.slice(i, j).replace(/_/g, ""), 10);
    let k = j + 1;
    while (k < n && /[0-9A-Za-z_]/.test(src[k])) k++;
    const digits = src.slice(j + 1, k).replace(/_/g, "");
    const ok = [2, 8, 16].includes(b) && !!digits && new RegExp("^[" + "0123456789ABCDEF".slice(0, b) + "]+$", "i").test(digits);
    return { text: src.slice(i, k), v: ok ? parseInt(digits, b) : 0, real: false, base: b, end: k, bad: !ok };
  }
  let real = false;
  if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) { real = true; j++; while (j < n && /[0-9_]/.test(src[j])) j++; }
  if (/[eE]/.test(src[j] || "") && /[-+0-9]/.test(src[j + 1] || "")) {
    let k = j + 1;
    if (/[-+]/.test(src[k])) k++;
    if (/[0-9]/.test(src[k] || "")) { real = true; j = k; while (j < n && /[0-9]/.test(src[j])) j++; }
  }
  const text = src.slice(i, j);
  const bad = j < n && isIdStart(src[j]);
  return { text, v: parseFloat(text.replace(/_/g, "")), real, end: j, bad };
}

export function lex(src: string, file: string, o: LexOptions): LexResult {
  const toks: Token[] = [], errors: EmuFinding[] = [];
  let i = 0, line = 1, col = 1, nl = true;
  const n = src.length;
  const err = (l: number, c: number, msg: string) => errors.push({ level: "error", rule: "syntax", file, line: l, col: c, msg });
  const adv = (k: number) => {
    for (let j = 0; j < k; j++) { if (src[i] === "\n") { line++; col = 1; } else col++; i++; }
  };
  if (src.charCodeAt(0) === 0xfeff) adv(1);
  while (i < n) {
    const c = src[i];
    if (c === "\n") { adv(1); nl = true; continue; }
    if (c === " " || c === "\t" || c === "\r") { adv(1); continue; }
    /* komentáře */
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") adv(1); continue; }
    if (c === "(" && src[i + 1] === "*") {
      const l0 = line, c0 = col;
      let depth = 0;
      for (;;) {
        if (i >= n) { err(l0, c0, tr("Neuzavřený komentář (* … *)")); break; }
        if (src[i] === "(" && src[i + 1] === "*") { if (depth === 0 || o.nestedComments) depth++; adv(2); continue; }
        if (src[i] === "*" && src[i + 1] === ")") { depth--; adv(2); if (depth === 0) break; continue; }
        adv(1);
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const l0 = line, c0 = col;
      adv(2);
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) adv(1);
      if (i >= n) err(l0, c0, tr("Neuzavřený komentář /* … */")); else adv(2);
      continue;
    }
    const l0 = line, c0 = col;
    const push = (t: Token) => { t.nl = nl; nl = false; toks.push(t); };
    /* pragma / atribut */
    if (c === "{") {
      let j = i + 1, q = "";
      while (j < n && (q || src[j] !== "}")) { if (src[j] === "'" || src[j] === '"') q = q === src[j] ? "" : q || src[j]; j++; }
      if (j >= n) { err(l0, c0, tr("Neuzavřená pragma {…}")); adv(n - i); break; }
      const text = src.slice(i + 1, j);
      adv(j + 1 - i);
      push({ k: "pragma", t: text.trim(), line: l0, col: c0 });
      continue;
    }
    /* řetězce */
    if (c === "'" || (c === '"' && !o.scl)) {
      let j = i + 1, s = "";
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "$" && j + 1 < n) { s += src[j + 1]; j += 2; continue; } s += src[j]; j++; }
      if (src[j] !== c) { err(l0, c0, tr("Neuzavřený řetězec")); adv(j - i); continue; }
      adv(j + 1 - i);
      push({ k: "str", t: s, line: l0, col: c0 });
      continue;
    }
    /* SCL: "globální" a #lokální */
    if (c === '"' && o.scl) {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== "\n") j++;
      if (src[j] !== '"') { err(l0, c0, tr("Neuzavřené jméno v uvozovkách")); adv(j - i); continue; }
      const t = src.slice(i + 1, j);
      adv(j + 1 - i);
      push({ k: "qid", t, line: l0, col: c0 });
      continue;
    }
    if (c === "#" && o.scl) {
      let j = i + 1;
      if (src[j] === '"') {                          // #"jméno s mezerou"
        let k = j + 1;
        while (k < n && src[k] !== '"' && src[k] !== "\n") k++;
        const t = src.slice(j + 1, k);
        adv(k + 1 - i);
        push({ k: "hid", t, line: l0, col: c0 });
        continue;
      }
      while (j < n && isIdChar(src[j])) j++;
      if (j === i + 1) { err(l0, c0, tr("Za # chybí jméno lokální proměnné")); adv(1); continue; }
      const t = src.slice(i + 1, j);
      adv(j - i);
      push({ k: "hid", t, line: l0, col: c0 });
      continue;
    }
    /* čísla (vč. 16#FF, 2#1010, 8#17) */
    if (/[0-9]/.test(c)) {
      const r = readNumber(src, i);
      if (r.bad) err(l0, c0, tr("Neplatný číselný literál {lit}", { lit: src.slice(i, r.end + 1) }));
      adv(r.end - i);
      push({ k: r.real ? "real" : "int", t: r.text, v: r.v, base: r.base, line: l0, col: c0 });
      continue;
    }
    /* identifikátory, klíčová slova, typované literály */
    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j), up = word.toUpperCase();
      if (src[j] === "#") {
        if (up === "T" || up === "TIME" || up === "LT" || up === "LTIME") {
          let k = j + 1;
          while (k < n && /[0-9A-Za-z_.\-]/.test(src[k])) k++;
          const body = src.slice(j + 1, k), ms = timeMs(body);
          if (isNaN(ms)) err(l0, c0, tr("Neplatný časový literál {lit}", { lit: src.slice(i, k) }));
          adv(k - i);
          push({ k: "time", t: word + "#" + body, v: isNaN(ms) ? 0 : ms, line: l0, col: c0 });
          continue;
        }
        /* typovaný literál INT#5, DINT#16#FF, BOOL#1, BOOL#TRUE, REAL#1.5 */
        let k = j + 1, neg = false;
        if (src[k] === "-") { neg = true; k++; }
        if (/[0-9]/.test(src[k] || "")) {
          const r = readNumber(src, k);
          if (r.bad) err(l0, c0, tr("Neplatný číselný literál {lit}", { lit: src.slice(i, r.end + 1) }));
          adv(r.end - i);
          push({ k: r.real ? "real" : "int", t: src.slice(i, r.end), v: neg ? -r.v : r.v, ty: up, base: r.base, line: l0, col: c0 });
          continue;
        }
        const m = /^(TRUE|FALSE)\b/i.exec(src.slice(k, k + 6));
        if (m) { adv(k + m[1].length - i); push({ k: "int", t: src.slice(i, k + m[1].length), v: /TRUE/i.test(m[1]) ? 1 : 0, ty: up, line: l0, col: c0 }); continue; }
        err(l0, c0, tr("Neplatný typovaný literál {lit}", { lit: word + "#" }));
        adv(j + 1 - i);
        continue;
      }
      adv(j - i);
      push({ k: KW.has(up) ? "kw" : "id", t: word, line: l0, col: c0 });
      continue;
    }
    /* přímé adresy %IX0.0, %IW64, %I*, %Q* */
    if (c === "%") {
      const m = /^%[A-Za-z]{1,3}[0-9.*]*/.exec(src.slice(i, i + 32));
      if (m) { adv(m[0].length); push({ k: "addr", t: m[0], line: l0, col: c0 }); continue; }
    }
    /* operátory */
    const two = src.substr(i, 2);
    if ([":=", "=>", "<=", ">=", "<>", "**", ".."].includes(two)) { adv(2); push({ k: "op", t: two, line: l0, col: c0 }); continue; }
    if ("=<>+-*/()[],;:.^&".includes(c)) { adv(1); push({ k: "op", t: c, line: l0, col: c0 }); continue; }
    err(l0, c0, tr("Neočekávaný znak {ch}", { ch: JSON.stringify(c) }));
    adv(1);
  }
  toks.push({ k: "eof", t: "", line, col, nl: true });
  return { toks, errors };
}
