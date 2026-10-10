/** Pomůcky testů exportů (SISTEMA, EPLAN): příklady a kontrola XML. */
import { readFileSync, readdirSync } from "node:fs";
import { blankProject, syncIO, type Project } from "./model.js";

export const SAMPLE_DIR = new URL("../../../samples/", import.meta.url);   // dist/ → kořen repozitáře

export function sampleNames(): string[] {
  return readdirSync(SAMPLE_DIR).filter(f => f.endsWith(".plcstudio.json")).sort();
}
export function loadSampleFile(name: string): Project {
  const raw = JSON.parse(readFileSync(new URL(name, SAMPLE_DIR), "utf8"));
  const p: Project = Object.assign(blankProject(), raw.prj || raw);
  syncIO(p);
  return p;
}

/** Přísná kontrola well-formed XML (párování značek, uvozené atributy, entity); vrací chybu nebo "". */
export function xmlProblem(src: string): string {
  let s = src.replace(/^﻿/, "");
  /* znaky, které XML 1.0 nepovoluje (řídicí kromě \t \n \r) — test odolnosti 2026-10-08 */
  const badCh = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/.exec(s);
  if (badCh) return "znak U+" + badCh[0].charCodeAt(0).toString(16).padStart(4, "0").toUpperCase() + " na " + badCh.index;
  let i = 0;
  const stack: string[] = [];
  const ent = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/y;
  const text = (t: string, at: number): string => {
    for (let k = 0; k < t.length; k++) {
      if (t[k] === "<") return "znak < v textu na " + (at + k);
      if (t[k] === "&") { ent.lastIndex = k; if (!ent.test(t)) return "neplatná entita na " + (at + k); }
    }
    return "";
  };
  let root = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    const chunk = lt < 0 ? s.slice(i) : s.slice(i, lt);
    const e = text(chunk, i); if (e) return e;
    if (!stack.length && chunk.trim() && root) return "text mimo kořen";
    if (lt < 0) break;
    if (s.startsWith("<?", lt)) { const j = s.indexOf("?>", lt); if (j < 0) return "neukončená instrukce"; i = j + 2; continue; }
    if (s.startsWith("<!--", lt)) { const j = s.indexOf("-->", lt); if (j < 0) return "neukončený komentář"; i = j + 3; continue; }
    const gt = s.indexOf(">", lt);
    if (gt < 0) return "neukončená značka";
    const tag = s.slice(lt + 1, gt);
    if (tag.startsWith("/")) {
      const n = tag.slice(1).trim();
      if (stack.pop() !== n) return "nepárová </" + n + "> na " + lt;
    } else {
      const m = tag.match(/^([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)$/);
      if (!m) return "chybná značka <" + tag.slice(0, 60) + "> na " + lt;
      const names = [...m[2].matchAll(/([A-Za-z_][\w.:-]*)\s*=/g)].map(x => x[1]);
      if (new Set(names).size !== names.length) return "duplicitní atribut v <" + m[1] + ">";
      for (const v of m[2].matchAll(/=\s*"([^"]*)"/g)) { const e2 = text(v[1], lt); if (e2) return e2; }
      if (!stack.length && root) return "druhý kořen";
      if (!m[3]) stack.push(m[1]);
      root++;
    }
    i = gt + 1;
  }
  return stack.length ? "neuzavřeno: " + stack.join(">") : root ? "" : "bez kořene";
}
