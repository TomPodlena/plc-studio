/**
 * PLCdesk — identifikace projektu: číslo projektu (zakázky) a zákazník, víceřádkový popis,
 * názvy ukládaných souborů. Jediné místo, kde se tyto údaje převádějí na text výstupů:
 * popisové pole výkresů (drawing.ts), hlavička dokumentů (docs.ts `docFiles`), README platforem
 * (codegen.ts), titulky klientů a prefix názvů souborů.
 *
 * Datum zahájení projektu `meta.startDate` (ISO YYYY-MM-DD) se zobrazuje podle jazyka (LOCALE v i18n).
 *
 * Pravidla: číslo a zákazník jsou obsah projektu — nepřekládají se a do kódu PLC se nepíšou.
 * Prázdné / chybějící pole = výstup přesně jako dřív (golden). Jen jednořádkový text (nové řádky
 * a tabulátory z ručně upraveného JSON se slijí do mezery).
 */
import type { Project } from "./model.js";
import { stripDia } from "./model.js";
import { tr, formatDate, dateLocale } from "./i18n.js";

/** Jeden řádek: řídicí znaky a zalomení → mezera, ořez. */
const CTRL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127, 0x2028, 0x2029) + "]+", "g");
export function oneLine(s: unknown): string {
  return String(s ?? "").replace(CTRL, " ").replace(/ {2,}/g, " ").trim();
}

/** Platné datum ISO „YYYY-MM-DD“ (skutečný den v kalendáři)? */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

/** Datum ISO „YYYY-MM-DD“ ve zvyklosti jazyka (`tech` = technické výstupy, výkresy); neplatné "". */
export function formatIsoDate(s: unknown, tech = false): string {
  return isIsoDate(s) ? formatDate(s + "T12:00:00", tech) : "";      // poledne: bez posunu dne časovým pásmem
}

/**
 * Datum zadané člověkem → ISO „YYYY-MM-DD“ ("" = nerozpoznáno). Bere ISO i zápis podle jazyka
 * (pořadí den / měsíc / rok z `formatIsoDate`, oddělovač libovolný: 8. 10. 2026, 08/10/2026, 2026/10/8).
 */
export function parseUserDate(text: unknown): string {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (isIsoDate(s as unknown)) return s;
  const nums = s.match(/\d+/g);
  if (!nums || nums.length !== 3) return "";
  /* pořadí částí podle jazyka: zformátovat známé datum a najít v něm den (22), měsíc (11) a rok (2033) */
  const probe = formatIsoDate("2033-11-22");
  const pos = { d: probe.indexOf("22"), m: probe.indexOf("11"), y: probe.indexOf("2033") };
  const order = (Object.keys(pos) as Array<keyof typeof pos>).filter(k => pos[k] >= 0).sort((a, b) => pos[a] - pos[b]);
  const seq = order.length === 3 ? order : (["d", "m", "y"] as const);
  const v: Record<string, number> = {};
  /* rok napřed (2026-10-08 s jiným oddělovačem) má přednost */
  const parts = nums[0].length === 4 ? ["y", "m", "d"] : [...seq];
  parts.forEach((k, i) => { v[k] = Number(nums[i]); });
  if (v.y < 100) v.y += 2000;
  const iso = String(v.y).padStart(4, "0") + "-" + String(v.m).padStart(2, "0") + "-" + String(v.d).padStart(2, "0");
  return isIsoDate(iso) ? iso : "";
}

/** Popisky kalendáře podle jazyka (výběr data v desktopu): názvy měsíců a dnů v týdnu od pondělí. */
export function calendarLabels(): { months: string[]; weekdays: string[]; locale: string } {
  const loc = dateLocale();
  const months = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1, 12).toLocaleDateString(loc, { month: "long" }));
  /* 2026-10-05 je pondělí */
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 5 + i, 12).toLocaleDateString(loc, { weekday: "short" }));
  return { months, weekdays, locale: loc };
}

/** Číslo projektu, zákazník (jednořádkově) a datum zahájení (ISO, jen platné); prázdné = "". */
export function projectRef(prj: Project): { number: string; customer: string; startDate: string } {
  const m = prj.meta || ({} as Project["meta"]);
  return { number: oneLine(m.number), customer: oneLine(m.customer), startDate: isIsoDate(m.startDate) ? m.startDate : "" };
}

/** Řádek Markdownu pod nadpis dokumentu („**Číslo projektu:** … · **Zákazník:** …“); bez údajů "". */
export function projectMetaMd(prj: Project): string {
  const { number, customer, startDate } = projectRef(prj);
  const out: string[] = [];
  if (number) out.push(tr("**Číslo projektu:** {v}", { v: mdInline(number) }));
  if (customer) out.push(tr("**Zákazník:** {v}", { v: mdInline(customer) }));
  if (startDate) out.push(tr("**Zahájení projektu:** {v}", { v: formatIsoDate(startDate) }));
  return out.join(" · ");
}

/** Řádek README (prostý text) pod řádek PROJEKT; bez údajů "". */
export function projectMetaText(prj: Project): string {
  const { number, customer, startDate } = projectRef(prj);
  const out: string[] = [];
  if (number) out.push(tr("ČÍSLO PROJEKTU: {v}", { v: number }));
  if (customer) out.push(tr("ZÁKAZNÍK: {v}", { v: customer }));
  if (startDate) out.push(tr("ZAHÁJENÍ PROJEKTU: {v}", { v: formatIsoDate(startDate) }));
  return out.join(" · ");
}

/** Titulek pro okno / záhlaví: „číslo · název · zákazník“ (jen vyplněné části). */
export function projectTitle(prj: Project): string {
  const { number, customer } = projectRef(prj);
  return [number, oneLine(prj.meta?.name), customer].filter(Boolean).join(" · ");
}

/** Text pro jednořádkové místo v Markdownu (buňka, hlavička): svislítko a hvězdičky neutralizovat. */
function mdInline(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/**
 * Víceřádkový popis do Markdownu: prázdný řádek = nový odstavec (zůstává), jednotlivé zalomení
 * = tvrdé zalomení řádku (dvě mezery). Jednořádkový text vrací beze změny (golden).
 */
export function mdMultiline(s: string): string {
  if (!/[\r\n]/.test(s)) return s;
  const lines = s.replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(/\s+$/, ""));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  const out: string[] = [];
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    out.push(l && next ? l + "  " : l);
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** První neprázdný řádek textu (pro místa na jeden řádek: popisová pole, komentáře), volitelně zkrácený. */
export function firstLine(s: unknown, max?: number): string {
  const l = String(s ?? "").split(/\r\n?|\n/).map(x => x.trim()).find(Boolean) || "";
  return max && l.length > max ? l.slice(0, Math.max(1, max - 1)).trimEnd() + "…" : l;
}

/** Část názvu souboru: bez diakritiky, jen [A-Za-z0-9._-], bez teček / podtržítek na krajích. */
export function fileSafe(s: string, max = 60): string {
  return stripDia(oneLine(s)).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "").slice(0, max).replace(/[._-]+$/g, "");
}

/** Prefix názvů ukládaných souborů „<číslo>_“ (bez čísla ""). Nepřidá se dvakrát (`withFilePrefix`). */
export function projectFilePrefix(prj: Project): string {
  const n = fileSafe(projectRef(prj).number, 40);
  return n ? n + "_" : "";
}

/** Název souboru s prefixem čísla projektu (jen když ho ještě nemá). */
export function withFilePrefix(prj: Project, name: string): string {
  const p = projectFilePrefix(prj);
  return p && !name.startsWith(p) ? p + name : name;
}

/**
 * Výchozí název souboru projektu: „<číslo>_<název>.plcstudio.json“. Název jen bez znaků, které
 * Windows v názvu souboru nedovolí (diakritika zůstává); bez názvu „plc-projekt“.
 */
export function projectFileName(prj: Project, ext = ".plcstudio.json"): string {
  const base = oneLine(prj.meta?.name).replace(/[<>:"/\\|?*]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 80);
  return withFilePrefix(prj, (base || "plc-projekt") + ext);
}
