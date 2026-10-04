export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (s) => typeof s === "string" && GUID_RE.test(s);
const hex = (b) => Array.from(b, x => (x & 255).toString(16).padStart(2, "0")).join("");
const fmt = (h) => h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
/** Náhodný GUID (UUID v4). */
export function newGuid() {
    const b = new Uint8Array(16);
    const c = globalThis.crypto;
    if (c && typeof c.getRandomValues === "function")
        c.getRandomValues(b);
    else
        for (let i = 0; i < 16; i++)
            b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return fmt(hex(b));
}
/** 128 bitů z textu (4× FNV-1a 32 s různým semínkem) — jen pro odvozené identifikátory, ne kryptografie. */
function hash128(key) {
    const out = new Uint8Array(16);
    const bytes = new TextEncoder().encode(key);
    for (let k = 0; k < 4; k++) {
        let x = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
        for (const c of bytes) {
            x ^= c;
            x = Math.imul(x, 0x01000193) >>> 0;
        }
        /* promíchání (murmur3 fmix), ať se sousední klíče liší ve všech bitech */
        x ^= x >>> 16;
        x = Math.imul(x, 0x85ebca6b) >>> 0;
        x ^= x >>> 13;
        x = Math.imul(x, 0xc2b2ae35) >>> 0;
        x ^= x >>> 16;
        out[k * 4] = x >>> 24;
        out[k * 4 + 1] = x >>> 16;
        out[k * 4 + 2] = x >>> 8;
        out[k * 4 + 3] = x;
    }
    return out;
}
/** Odvozený GUID (UUIDv8): deterministicky z rodičovského GUID a role/klíče. */
export function derivedGuid(parent, role) {
    const b = hash128(String(parent).toLowerCase() + "|" + role);
    b[6] = (b[6] & 0x0f) | 0x80;
    b[8] = (b[8] & 0x3f) | 0x80;
    return fmt(hex(b));
}
/** Klíč identity I/O karty (DI1, DO2 …) — viz `modules()`. */
export const moduleKey = (m) => m.dir + m.idx;
/** GUID signálu: odvozený z GUID zařízení a signálu. */
export const ioGuidFor = (devGuid, sig) => derivedGuid(devGuid, "io:" + sig);
/**
 * Doplní chybějící (a opraví neplatné či duplicitní) GUID projektu, zařízení, I/O karet a signálů.
 * Existující platné GUID nikdy nemění. Vrací true, když něco doplnila — volající pak projekt
 * označí jako změněný (uloží). Volá se při vzniku objektů (`syncIO`) a při načtení projektu.
 * `mods` = karty projektu (z `modules()`), jinak se karty neřeší.
 */
export function fillGuids(prj, mods) {
    let changed = false;
    if (!isGuid(prj.guid)) {
        prj.guid = newGuid();
        changed = true;
    }
    const seen = new Set([prj.guid.toLowerCase()]);
    const take = (g) => {
        if (!isGuid(g) || seen.has(g.toLowerCase()))
            return false;
        seen.add(g.toLowerCase());
        return true;
    };
    const devGuid = new Map();
    for (const d of prj.devices || []) {
        if (!take(d.guid)) {
            d.guid = newGuid();
            seen.add(d.guid);
            changed = true;
        }
        devGuid.set(d.id, d.guid);
    }
    for (const e of prj.io || []) {
        if (take(e.guid))
            continue;
        const dg = devGuid.get(e.devId);
        let g = dg ? ioGuidFor(dg, e.sig) : "";
        if (!g || seen.has(g))
            g = newGuid();
        e.guid = g;
        seen.add(g);
        changed = true;
    }
    if (mods) {
        const mg = prj.moduleGuids && typeof prj.moduleGuids === "object" ? prj.moduleGuids : {};
        for (const m of mods) {
            const k = moduleKey(m);
            if (!isGuid(mg[k])) {
                mg[k] = newGuid();
                changed = true;
            }
        }
        if (Object.keys(mg).length)
            prj.moduleGuids = mg;
    }
    return changed;
}
