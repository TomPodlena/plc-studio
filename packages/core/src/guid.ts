/**
 * PLCdesk — trvalé identifikátory objektů projektu (GUID).
 *
 * Proč: EPLAN (AutomationML AR APC) a další nástroje párují objekty při opakovaném importu podle
 * GUID. GUID proto musí být STABILNÍ napříč exporty téhož projektu — přiděluje se jednou při vzniku
 * objektu, ukládá se do JSON projektu a při exportu se NIKDY negeneruje (export jen čte).
 *
 *   Project.guid          náhodný (v4), při vzniku projektu (`blankProject`)
 *   Device.guid           náhodný (v4), při vzniku zařízení (`syncIO` / `ensureGuids` hned po přidání)
 *   Project.moduleGuids   náhodný (v4) pro každou I/O kartu; karta nemá v modelu vlastní objekt (vzniká
 *                         z I/O tabulky v `modules()`), její identita je klíč „<směr><pořadí>“ (DI1, DO2…)
 *                         — stejný klíč jako označení karty ve výkresech a dokumentaci
 *   IoEntry.guid          odvozený (UUIDv8, RFC 9562) z GUID zařízení + signálu: signál JE „zařízení ×
 *                         signál“, takže GUID přežije přejmenování tagu i přečíslování id zařízení a je
 *                         stabilní i u projektů, které I/O tabulku neukládají (příklady samples/)
 *
 * Odvozené GUID objektů exportu bez vlastního záznamu v modelu (stanice, rack, CPU, rozhraní PROFINET,
 * síť…) počítá exportér funkcí `derivedGuid(prj.guid, role)` — deterministicky z GUID projektu.
 *
 * Otisky schvalování (approval.ts) GUID neobsahují a revize (revision.ts) ho vyřazuje z porovnání —
 * doplnění GUID při migraci proto nemění stav schválení ani nehlásí změnu.
 * Bez závislostí: crypto.getRandomValues (prohlížeč i Node ≥ 19), jinak Math.random.
 */
import type { Project, IoModule } from "./model.js";

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (s: unknown): s is string => typeof s === "string" && GUID_RE.test(s);

const hex = (b: ArrayLike<number>) => Array.from(b, x => (x & 255).toString(16).padStart(2, "0")).join("");
const fmt = (h: string) => h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);

/** Náhodný GUID (UUID v4). */
export function newGuid(): string {
  const b = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(hex(b));
}

/** 128 bitů z textu (4× FNV-1a 32 s různým semínkem) — jen pro odvozené identifikátory, ne kryptografie. */
function hash128(key: string): Uint8Array {
  const out = new Uint8Array(16);
  const bytes = new TextEncoder().encode(key);
  for (let k = 0; k < 4; k++) {
    let x = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    for (const c of bytes) { x ^= c; x = Math.imul(x, 0x01000193) >>> 0; }
    /* promíchání (murmur3 fmix), ať se sousední klíče liší ve všech bitech */
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16;
    out[k * 4] = x >>> 24; out[k * 4 + 1] = x >>> 16; out[k * 4 + 2] = x >>> 8; out[k * 4 + 3] = x;
  }
  return out;
}

/** Odvozený GUID (UUIDv8): deterministicky z rodičovského GUID a role/klíče. */
export function derivedGuid(parent: string, role: string): string {
  const b = hash128(String(parent).toLowerCase() + "|" + role);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(hex(b));
}

/** Klíč identity I/O karty (DI1, DO2 …) — viz `modules()`. */
export const moduleKey = (m: Pick<IoModule, "dir" | "idx">): string => m.dir + m.idx;

/** GUID signálu: odvozený z GUID zařízení a signálu. */
export const ioGuidFor = (devGuid: string, sig: string): string => derivedGuid(devGuid, "io:" + sig);

/**
 * Doplní chybějící (a opraví neplatné či duplicitní) GUID projektu, zařízení, I/O karet a signálů.
 * Existující platné GUID nikdy nemění. Vrací true, když něco doplnila — volající pak projekt
 * označí jako změněný (uloží). Volá se při vzniku objektů (`syncIO`) a při načtení projektu.
 * `mods` = karty projektu (z `modules()`), jinak se karty neřeší.
 */
export function fillGuids(prj: Project, mods?: IoModule[]): boolean {
  let changed = false;
  if (!isGuid(prj.guid)) { prj.guid = newGuid(); changed = true; }
  const seen = new Set<string>([prj.guid.toLowerCase()]);
  const take = (g: unknown): g is string => {
    if (!isGuid(g) || seen.has(g.toLowerCase())) return false;
    seen.add(g.toLowerCase());
    return true;
  };
  const devGuid = new Map<number, string>();
  for (const d of prj.devices || []) {
    if (!take(d.guid)) { d.guid = newGuid(); seen.add(d.guid); changed = true; }
    devGuid.set(d.id, d.guid as string);
  }
  for (const e of prj.io || []) {
    if (take(e.guid)) continue;
    const dg = devGuid.get(e.devId);
    let g = dg ? ioGuidFor(dg, e.sig) : "";
    if (!g || seen.has(g)) g = newGuid();
    e.guid = g; seen.add(g); changed = true;
  }
  if (mods) {
    const mg = prj.moduleGuids && typeof prj.moduleGuids === "object" ? prj.moduleGuids : {};
    for (const m of mods) {
      const k = moduleKey(m);
      if (!isGuid(mg[k])) { mg[k] = newGuid(); changed = true; }
    }
    if (Object.keys(mg).length) prj.moduleGuids = mg;
  }
  return changed;
}
