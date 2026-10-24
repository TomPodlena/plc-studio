"""Seznam modelů ke RUČNÍMU stažení, párování stažených souborů, knihovna modelů a registrace (bez Tk, bez sítě).

    download_list(manifest, parts_index, models_dir)  → řádky (jeden řádek = jeden soubor ke stažení)
    write_lists(folder, manifest, parts_index)        → STAHNOUT.md + STAHNOUT.html ve složce stroje
    find_downloads(manifest, rows, models_dir, [Downloads]) → návrhy párování (potvrzuje uživatel)
    accept(proposals, models_dir)                     → kopie do models/manual/<partId-safe>.stp
    register_downloads(folder, manifest, by)          → register_manual + kontrola obálky + knihovna + náhrada v modelu

Odkaz = vzor adresy výrobce z ``vendors.json`` (stránka produktu nebo hledání; neznámý výrobce → hledání TraceParts
s poznámkou). Díly „dle dokumentace“ (generátory kódem, ``dily/parts_index.json``) v seznamu nejsou. Stahuje vždy
člověk v prohlížeči — tento modul síť nepoužívá."""

from __future__ import annotations

import datetime as _dt
import html
import json
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from urllib.parse import quote

from . import models_index as MI
from . import register_manual as RM

HERE = Path(__file__).resolve().parent
VENDORS_FILE = HERE / "vendors.json"
MODELS_SUB = "models"
MANUAL_SUB = "manual"
LIST_MD = "STAHNOUT.md"
LIST_HTML = "STAHNOUT.html"
FORMAT = "STEP AP214 (nebo AP242)"
DL_SLOT = "pro3d-dl"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# stavy řádku (klíče; popisky přeloží UI)
ST_REGISTERED = "registered"     # staženo a zaevidováno v models/index.json
ST_DOWNLOADED = "downloaded"     # soubor v models/manual/, ještě nezaevidován
ST_LIBRARY = "library"           # model je ve firemní knihovně — stačí převzít
ST_MISSING = "missing"           # chybí, ke stažení
ST_PLACEHOLDER = "placeholder"   # bez kódu / výrobce model nedává → zůstane zástupný
ST_DOC = "doc"                   # dle dokumentace (generátor kódem) — v seznamu není
STATUS_CS = {ST_REGISTERED: "staženo", ST_DOWNLOADED: "staženo — nezaevidováno", ST_LIBRARY: "v knihovně",
             ST_MISSING: "chybí", ST_PLACEHOLDER: "zástupný", ST_DOC: "dle dokumentace"}

MIN_CODE = 5                    # kratší kód / typ se v názvech souborů nehledá (falešné shody)
DIMS_RE = re.compile(r"(\d{2,4}(?:[.,]\d+)?)\s*[×xX]\s*(\d{2,4}(?:[.,]\d+)?)\s*[×xX]\s*(\d{2,4}(?:[.,]\d+)?)")


# --- výrobci ----------------------------------------------------------------------------------------------------

_VENDORS: dict | None = None


def vendors() -> dict:
    global _VENDORS
    if _VENDORS is None:
        _VENDORS = json.loads(VENDORS_FILE.read_text(encoding="utf-8"))
    return _VENDORS


def vendor_for(brand: str) -> tuple[str, dict]:
    """(klíč, záznam) výrobce podle značky; neznámý → (klíč z názvu, fallback TraceParts)."""
    b = (brand or "").lower()
    V = vendors()
    for k, v in V["vendors"].items():
        if any(m in b for m in v.get("match") or [k]):
            return k, v
    return RM.vendor_key(brand), V["fallback"]


def no_cad_note(vkey: str) -> str:
    return vendors().get("no_cad", {}).get(vkey, "")


def type_token(t: str) -> str:
    """První slovo typu („VUVG-L14-M52-MT-G18-1P3 – 5/2 …“ → „VUVG-L14-M52-MT-G18-1P3“)."""
    m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9.\-/_]*)", t or "")
    return m.group(1) if m else ""


def build_url(entry: dict, code: str, typ: str) -> str:
    q = code or type_token(typ) or (typ or "")[:40]
    u = entry.get("url") or ""
    if "{code}" in u or "{code_alnum}" in u:
        if not code:                                  # stránka produktu bez kódu nejde → hledání výrobce / TraceParts
            u = entry.get("search") or vendors()["fallback"]["url"]
    return (u.replace("{code}", quote(code, safe="-._"))
             .replace("{code_alnum}", re.sub(r"[^0-9A-Za-z]", "", code))
             .replace("{query}", quote(q, safe="-._")))


def expected_dims(p: dict) -> list[float] | None:
    """Rozměry z popisu dílu („… 500×500×210 …“), jen když jsou v textu — jinak None."""
    m = DIMS_RE.search(" ".join(str(p.get(k) or "") for k in ("type", "label")))
    return sorted(float(x.replace(",", ".")) for x in m.groups()) if m else None


# --- knihovna modelů ---------------------------------------------------------------------------------------------

def library_dir() -> Path:
    env = os.environ.get("PLCSTUDIO_HOME")
    base = Path(env) if env else Path(os.environ.get("APPDATA") or Path.home()) / "PLCStudio"
    return base / "model_library"


def _code_safe(code: str) -> str:
    return re.sub(r"[^\w.\-]+", "_", code or "", flags=re.ASCII).strip("_.") or "model"


def library_path(vkey: str, code: str) -> Path:
    return library_dir() / vkey / f"{_code_safe(code)}.stp"


def library_ok(vkey: str) -> bool:
    return bool((vendors()["vendors"].get(vkey) or {}).get("library_ok"))


def library_lookup(vkey: str, code: str) -> Path | None:
    if not code or not library_ok(vkey):              # jen výrobci, jejichž podmínky opakované použití dovolují
        return None
    p = library_path(vkey, code)
    return p if p.is_file() else None


def library_add(vkey: str, code: str, src: Path, meta: dict | None = None) -> Path | None:
    """Zkopíruje model do knihovny — JEN pro výrobce s ``library_ok`` (jinak None)."""
    if not code or not library_ok(vkey):
        return None
    dst = library_path(vkey, code)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    v = vendors()["vendors"][vkey]
    info = dict(meta or {}, vendor=vkey, code=code, sha256=RM.sha256(dst), added=_dt.date.today().isoformat(),
                terms=v.get("terms", ""), terms_src=v.get("terms_src", ""))
    dst.with_suffix(".json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    return dst


def library_list() -> list[dict]:
    root = library_dir()
    out = []
    for f in sorted(root.glob("*/*.stp")) if root.is_dir() else []:
        out.append({"vendor": f.parent.name, "file": str(f), "code": f.stem})
    return out


# --- seznam ------------------------------------------------------------------------------------------------------

def _doc_ids(manifest: dict, parts_index: dict | None) -> set:
    """Díly „dle dokumentace“: z ``parts_index.json``, bez něj z mapování generátorů (bez FreeCADu)."""
    from ..pro3d_parts import catalog_map as cm
    parts = (parts_index or {}).get("parts")
    if parts is None:
        parts = cm.map_manifest(manifest)["parts"]
    return {pid for pid, r in parts.items() if r.get("stav") == cm.STAV_DOK}


def download_list(manifest: dict, parts_index: dict | None, models_dir: str | Path) -> list[dict]:
    """Řádky ke stažení (jeden řádek = jeden soubor; řádky kusovníku se stejným výrobcem a kódem sdílejí model).
    Kabely a díly „dle dokumentace“ vynechány. Pořadí: rozvaděč, velké polní díly, přístroje rozvaděče, malé díly."""
    models_dir = Path(models_dir)
    doc = _doc_ids(manifest, parts_index)
    idx = MI.load(models_dir) if (models_dir / "index.json").is_file() else {"parts": {}}
    man = models_dir / MANUAL_SUB
    on_disk = {RM._stem_base(f).lower() for f in (man.iterdir() if man.is_dir() else [])
               if f.is_file() and f.suffix.lower() in RM.STEP_EXT}
    groups: dict = {}
    order = []
    for p in manifest.get("parts") or []:
        if RM.is_cable(p) or p.get("id") in doc:
            continue
        k = RM.group_key(p)
        if k not in groups:
            groups[k] = []
            order.append(k)
        groups[k].append(p)
    rows = []
    for k in order:
        parts = groups[k]
        first = parts[0]
        code = first.get("orderCode") or ""
        vkey, ent = vendor_for(first.get("brand", ""))
        known = vkey in vendors()["vendors"]
        safes = {MI.safe_name(p["id"]).lower() for p in parts}
        entries = [idx["parts"].get(p["id"]) or {} for p in parts]
        lib = library_lookup(vkey, code)
        nocad = no_cad_note(vkey)
        if all(MI.has_vendor_model(models_dir, idx, p["id"]) for p in parts):
            status = ST_REGISTERED
        elif safes & on_disk:
            status = ST_DOWNLOADED
        elif lib:
            status = ST_LIBRARY
        elif not code or nocad:
            status = ST_PLACEHOLDER
        else:
            status = ST_MISSING
        note = ent.get("registration", "")
        if not code:
            note = "bez objednacího kódu — nejdřív vybrat typ a kód v PLCdesk (krok Kusovník); " + note
        if nocad:
            note = nocad + "; " + note
        rows.append({
            "partId": first["id"], "partIds": [p["id"] for p in parts], "tag": first.get("tag", ""),
            "category": first.get("category", ""), "label": first.get("label", ""), "type": first.get("type", ""),
            "brand": first.get("brand", ""), "vendor": vkey, "vendorName": ent.get("name") if known else first.get("brand", ""),
            "orderCode": code, "qty": sum(int(p.get("qty") or 1) for p in parts),
            "url": build_url(ent, code, first.get("type", "")), "urlKind": ent.get("kind", ""),
            "urlVerified": bool(ent.get("verified")), "urlNote": ent.get("verify_note", ""), "note": note,
            "format": ent.get("format") or FORMAT, "file": MI.safe_name(first["id"]) + ".stp",
            "dir": f"{MODELS_SUB}/{MANUAL_SUB}", "status": status, "libraryOk": library_ok(vkey),
            "library": str(lib) if lib else "", "expectedDims": expected_dims(first),
            "source": f"manual-{vkey}", "where": vkey, "vendorUrl": build_url(ent, code, first.get("type", "")),
            "priority": RM.PRIORITY.get(first.get("category", ""), RM.PRIORITY_DEFAULT),
            "modelFile": (entries[0].get("file") if status == ST_REGISTERED else "") or "",
        })
    rows.sort(key=lambda r: r["priority"])
    return rows


def counts(rows: list[dict], manifest: dict | None = None, parts_index: dict | None = None) -> dict:
    c = {s: 0 for s in STATUS_CS}
    for r in rows:
        c[r["status"]] += 1
    if manifest is not None:
        c[ST_DOC] = len(_doc_ids(manifest, parts_index) & {p.get("id") for p in manifest.get("parts") or []})
    c["remaining"] = c[ST_MISSING] + c[ST_LIBRARY] + c[ST_DOWNLOADED]
    c["files"] = len(rows)
    return c


def load_parts_index(folder: Path) -> dict | None:
    p = Path(folder) / "dily" / "parts_index.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# --- STAHNOUT.md / .html -----------------------------------------------------------------------------------------

HOWTO = [
    "Modely stahuje **člověk v prohlížeči** — podmínky 3Dfindit / CADENAS (čl. 12.3 (vii)), TraceParts i portálů "
    "výrobců skriptované hledání a stahování zakazují nebo ho nedovolují. PLCdesk nic nestahuje.",
    "1. Otevři odkaz (přihlas se, kde to portál chce — registrace je zdarma).",
    "2. Najdi přesně **objednací kód** z tabulky (pozor na varianty), stáhni 3D model ve formátu **STEP AP214** "
    "(nebo AP242); ZIP rozbal.",
    "3. Ulož soubor `.stp` do složky `models/manual/` pod **přesným názvem ze sloupce Soubor** — nebo ho nech ve "
    "složce Stažené soubory: PLCdesk ho pozná podle kódu / typu v názvu nebo v hlavičce STEP a nabídne párování.",
    "4. V PLCdesk (krok 3D agent (PRO) → Modely ke stažení) klikni **Načíst stažené** — model se ověří ve FreeCADu, "
    "zaeviduje do `models/index.json` a nahradí zástupný díl v modelu stroje.",
    "Modely z portálů na CADENAS / TraceParts patří jen k tomuto projektu; do firemní knihovny jdou jen výrobci, "
    "jejichž podmínky interní opakované použití dovolují (sloupec Knihovna).",
]


def list_md(rows: list[dict], c: dict, project: str = "", created: str = "") -> str:
    L = [f"# Modely ke stažení ručně — {project}".rstrip(" —"), "",
         f"Vygenerováno {created or f'{_dt.datetime.now():%Y-%m-%d %H:%M}'} (PLCdesk PRO). Souborů {c['files']}: chybí "
         f"{c[ST_MISSING]}, v knihovně {c[ST_LIBRARY]}, staženo {c[ST_REGISTERED]}, nezaevidováno {c[ST_DOWNLOADED]}, "
         f"zástupné {c[ST_PLACEHOLDER]}; dle dokumentace (generátory kódem, v seznamu nejsou) {c.get(ST_DOC, 0)} řádků.",
         ""] + HOWTO + ["",
         "| # | Díl (partId) | Popis | Výrobce | Obj. kód | Odkaz | Formát | Soubor | Další řádky | Knihovna | Stav |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        ver = "" if r["urlVerified"] else " (vzor neověřen)"
        desc = RM.short(f"{r['label']}: {r['type']}", 90).replace("|", "/")
        others = ", ".join(f"`{p}`" for p in r["partIds"][1:]) or "—"
        L.append(f"| {i} | `{r['partId']}` ({r['tag']}) | {desc} | {r['vendorName']} | {r['orderCode'] or '—'} | "
                 f"[{r['urlKind'] or 'odkaz'}]({r['url']}){ver} | {r['format']} | `{r['dir']}/{r['file']}` | {others} | "
                 f"{'ano' if r['libraryOk'] else 'ne'} | {STATUS_CS[r['status']]} |")
    notes = sorted({(r["vendorName"], r["note"]) for r in rows if r["note"]})
    if notes:
        L += ["", "## Poznámky k portálům", ""] + [f"- **{a}** — {b}" for a, b in notes]
    return "\n".join(L) + "\n"


def list_html(rows: list[dict], c: dict, project: str = "", created: str = "") -> str:
    e = html.escape
    tr = []
    for i, r in enumerate(rows, 1):
        ver = "" if r["urlVerified"] else ' <span class="dim">(vzor neověřen)</span>'
        tr.append(
            f'<tr class="s-{r["status"]}"><td>{i}</td><td><code>{e(r["partId"])}</code><br>{e(r["tag"])}</td>'
            f'<td>{e(RM.short(r["label"] + ": " + r["type"], 110))}</td><td>{e(r["vendorName"])}</td>'
            f'<td><b>{e(r["orderCode"] or "—")}</b></td><td><a href="{e(r["url"], quote=True)}" target="_blank" '
            f'rel="noopener">otevřít</a>{ver}<div class="dim">{e(r["note"])}</div></td><td>{e(r["format"])}</td>'
            f'<td><code>{e(r["dir"])}/{e(r["file"])}</code></td><td>{e(", ".join(r["partIds"][1:]) or "—")}</td>'
            f'<td>{"ano" if r["libraryOk"] else "ne"}</td><td>{e(STATUS_CS[r["status"]])}</td></tr>')
    how = "".join(f"<p>{e(h).replace('**', '')}</p>" for h in HOWTO)
    return f"""<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modely ke stažení</title>
<style>
body{{font:14px/1.4 Segoe UI,Arial,sans-serif;margin:16px;color:#1b1b1b;background:#fff}}
h1{{font-size:20px;color:#1F482A}} table{{border-collapse:collapse;width:100%}}
th,td{{border:1px solid #ccc;padding:4px 6px;vertical-align:top;text-align:left}} th{{background:#e8f0ea}}
a{{color:#008639}} .dim{{color:#666;font-size:12px}} code{{font-size:12px}}
tr.s-registered td{{background:#eef7ef}} tr.s-placeholder td{{background:#fff4e5}} tr.s-library td{{background:#eef3fb}}
@media print{{a{{color:#000}} a::after{{content:" (" attr(href) ")";font-size:10px;color:#444}} body{{margin:0}}}}
</style></head><body>
<h1>Modely ke stažení ručně — {e(project)}</h1>
<p>Vygenerováno {e(created or f"{_dt.datetime.now():%Y-%m-%d %H:%M}")} (PLCdesk PRO). Souborů {c['files']}: chybí {c[ST_MISSING]},
v knihovně {c[ST_LIBRARY]}, staženo {c[ST_REGISTERED]}, nezaevidováno {c[ST_DOWNLOADED]}, zástupné {c[ST_PLACEHOLDER]};
dle dokumentace {c.get(ST_DOC, 0)} řádků (v seznamu nejsou).</p>
{how}
<table><thead><tr><th>#</th><th>Díl</th><th>Popis</th><th>Výrobce</th><th>Obj. kód</th><th>Odkaz</th><th>Formát</th>
<th>Soubor (přesný název)</th><th>Další řádky</th><th>Knihovna</th><th>Stav</th></tr></thead>
<tbody>
{chr(10).join(tr)}
</tbody></table></body></html>
"""


def write_lists(folder: str | Path, manifest: dict, parts_index: dict | None = None) -> dict:
    """Zapíše STAHNOUT.md a STAHNOUT.html do složky stroje; vrací ``{"rows", "counts", "files"}``."""
    folder = Path(folder)
    if parts_index is None:
        parts_index = load_parts_index(folder)
    rows = download_list(manifest, parts_index, folder / MODELS_SUB)
    c = counts(rows, manifest, parts_index)
    name = (manifest.get("project") or {}).get("name", "")
    created = f"{_dt.datetime.now():%Y-%m-%d %H:%M}"
    (folder / MODELS_SUB / MANUAL_SUB).mkdir(parents=True, exist_ok=True)
    (folder / LIST_MD).write_text(list_md(rows, c, name, created), encoding="utf-8")
    (folder / LIST_HTML).write_text(list_html(rows, c, name, created), encoding="utf-8")
    return {"rows": rows, "counts": c, "files": [LIST_MD, LIST_HTML]}


# --- rozpoznání stažených souborů ---------------------------------------------------------------------------------

def downloads_dir() -> Path | None:
    p = Path(os.environ.get("PLCDESK_DOWNLOADS") or Path.home() / "Downloads")
    return p if p.is_dir() else None


def _norm(s: str) -> str:
    return re.sub(r"[^0-9a-z]", "", (s or "").lower())


def step_header(data: bytes) -> str:
    """Text hlavičky STEP (FILE_NAME, FILE_DESCRIPTION) + názvy PRODUCT z prvních 256 kB."""
    txt = data[:262144].decode("latin-1", "replace")
    if "ISO-10303-21" not in txt:
        return ""
    head = txt.split("ENDSEC;", 1)[0]
    prods = re.findall(r"PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'", txt)
    return head + " " + " ".join(a + " " + b for a, b in prods[:20])


def _keys(r: dict) -> list[tuple[str, str]]:
    out = []
    c = _norm(r["orderCode"])
    if len(c) >= MIN_CODE:
        out.append(("code", c))
    t = _norm(type_token(r["type"]))
    if len(t) >= MIN_CODE and t != c:
        out.append(("type", t))
    return out


def _candidates(src: Path) -> list[tuple[str, str, bytes | None]]:
    """(zobrazované jméno, člen ZIP nebo "", začátek dat) — STEP soubory a STEP uvnitř ZIP."""
    out = []
    try:
        if src.suffix.lower() in RM.STEP_EXT:
            with open(src, "rb") as fh:
                out.append((src.name, "", fh.read(262144)))
        elif src.suffix.lower() == ".zip" and zipfile.is_zipfile(src):
            with zipfile.ZipFile(src) as z:
                for info in z.infolist()[:500]:
                    if Path(info.filename).suffix.lower() in RM.STEP_EXT and not info.is_dir():
                        with z.open(info) as fh:
                            out.append((f"{src.name}/{info.filename}", info.filename, fh.read(262144)))
    except (OSError, zipfile.BadZipFile, RuntimeError):
        pass
    return out


def find_downloads(manifest: dict, rows: list[dict], models_dir: str | Path,
                   extra_dirs: list[Path] | None = None, max_age_days: int = 60) -> list[dict]:
    """Návrhy párování souborů k řádkům, které ještě model nemají. ``models/manual``: jméno ``partId-safe`` = jisté
    (zaeviduje se rovnou); jinak kód / typ v názvu souboru nebo v hlavičce STEP → návrh, uživatel potvrdí.
    ``extra_dirs`` = např. Stažené soubory (jen soubory mladší ``max_age_days``)."""
    models_dir = Path(models_dir)
    man = models_dir / MANUAL_SUB
    open_rows = [r for r in rows if r["status"] in (ST_MISSING, ST_PLACEHOLDER, ST_DOWNLOADED, ST_LIBRARY)]
    by_safe = {Path(r["file"]).stem.lower(): r for r in open_rows}
    props: list[dict] = []
    srcs: list[tuple[Path, bool]] = []
    if man.is_dir():
        srcs += [(f, True) for f in sorted(man.iterdir()) if f.is_file()]
    limit = _dt.datetime.now().timestamp() - max_age_days * 86400
    for d in extra_dirs or []:
        if d and Path(d).is_dir():
            srcs += [(f, False) for f in sorted(Path(d).iterdir())
                     if f.is_file() and f.suffix.lower() in RM.STEP_EXT + (".zip",) and f.stat().st_mtime >= limit]
    for f, in_manual in srcs:
        for shown, member, data in _candidates(f):
            base = RM._stem_base(Path(member or f.name)).lower()
            if base in by_safe:
                r = by_safe[base]
                props.append({"file": str(f), "member": member, "shown": shown, "partId": r["partId"],
                              "target": r["file"], "how": "name", "sure": in_manual and not member})
                continue
            name = _norm(Path(member or f.name).stem)
            head = _norm(step_header(data or b""))
            best = None
            for r in open_rows:
                for kind, key in _keys(r):
                    if key in name:
                        how = f"{kind}_name"
                    elif head and key in head:
                        how = f"{kind}_header"
                    else:
                        continue
                    rank = {"code_name": 0, "code_header": 1, "type_name": 2, "type_header": 3}[how]
                    if best is None or rank < best[0] or (rank == best[0] and len(key) > best[2]):
                        best = (rank, r, len(key), how)
            if best:
                r = best[1]
                props.append({"file": str(f), "member": member, "shown": shown, "partId": r["partId"],
                              "target": r["file"], "how": best[3], "sure": False})
    # jeden návrh na řádek: jisté jméno má přednost, jinak nejlepší shoda (první nalezená)
    out, seen = [], set()
    for p in sorted(props, key=lambda p: (not p["sure"], p["how"])):
        if p["partId"] in seen:
            continue
        seen.add(p["partId"])
        out.append(p)
    return out


def accept(proposals: list[dict], models_dir: str | Path) -> list[str]:
    """Potvrzené návrhy → ``models/manual/<partId-safe>.stp`` (kopie; originál ve Stažených zůstává; ze ZIP jen
    jeden člen pod pevným jménem). Vrací zapsané soubory."""
    man = Path(models_dir) / MANUAL_SUB
    man.mkdir(parents=True, exist_ok=True)
    out = []
    for p in proposals:
        dst = man / p["target"]
        src = Path(p["file"])
        if p.get("member"):
            with zipfile.ZipFile(src) as z, z.open(p["member"]) as fh, open(dst, "wb") as o:
                shutil.copyfileobj(fh, o)
        elif src.resolve() != dst.resolve():
            if src.parent.resolve() == man.resolve():
                src.replace(dst)                       # soubor v models/manual jen přejmenovat
            else:
                shutil.copyfile(src, dst)
        out.append(str(dst))
    return out


def take_from_library(rows: list[dict], models_dir: str | Path) -> list[str]:
    """Řádky ve stavu „v knihovně“ → kopie modelu z knihovny do ``models/manual``."""
    return accept([{"file": r["library"], "member": "", "target": r["file"]} for r in rows
                   if r["status"] == ST_LIBRARY and r.get("library")], models_dir)


# --- registrace -------------------------------------------------------------------------------------------------------

def dims_warning(bbox: list | None, exp: list | None, tol: float = 0.15) -> str:
    """Obálka modelu × rozměry z popisu dílu (±15 % + 5 mm); "" = v pořádku nebo neznámé."""
    if not bbox or not exp:
        return ""
    got = sorted(float(x) for x in bbox)
    bad = [(g, e) for g, e in zip(got, exp) if abs(g - e) > tol * e + 5]
    if not bad:
        return ""
    return ("obálka " + " × ".join(f"{g:g}" for g in got) + " mm neodpovídá popisu " +
            " × ".join(f"{e:g}" for e in exp) + " mm — zkontroluj variantu")


def machine_models(folder: Path) -> list[Path]:
    """FCStd modelu stroje (bez modelů dílů, knihovny, logů a kontrol K5)."""
    skip = {MODELS_SUB, "dily", "logy", ".prace"}
    out = []
    for f in sorted(Path(folder).rglob("*.FCStd")):
        rel = f.relative_to(folder).parts
        if rel and (rel[0] in skip or any(p.startswith("k5_kolo") for p in rel)):
            continue
        out.append(f)
    return out


def _docs_with(files: list[Path], pids: set) -> list[Path]:
    """FCStd, jejichž Document.xml obsahuje některé partId (bez FreeCADu — rychlý předvýběr)."""
    out = []
    for f in files:
        try:
            with zipfile.ZipFile(f) as z:
                xml = z.read("Document.xml").decode("utf-8", "replace")
        except (OSError, KeyError, zipfile.BadZipFile):
            continue
        if "PLCdesk_Id" in xml and any(html.escape(p, quote=True) in xml or p in xml for p in pids):
            out.append(f)
    return out


def replace_placeholders(folder: str | Path, models: dict, *, slot: str = DL_SLOT, timeout: int = 900,
                         run=None) -> dict:
    """Zástupné díly (PLCdesk_ModelStatus = placeholder, PLCdesk_Id = partId) v modelech stroje → App::Link na model
    výrobce (STEP → FCStd vedle STEP). ``models`` = {partId: cesta STEP}. FreeCAD jen přes run_fc.ps1 (vlastní slot).
    Bez modelu stroje se nic nespouští. Před uložením záloha ``<model>.FCStd.bak``."""
    folder = Path(folder)
    docs = _docs_with(machine_models(folder), set(models))
    if not docs or not models:
        return {"replaced": [], "docs": [], "skipped": "model stroje se zástupnými díly nenalezen"}
    for d in docs:
        shutil.copyfile(d, d.with_name(d.name + ".bak"))
    work = folder / MODELS_SUB / ".prace"
    work.mkdir(parents=True, exist_ok=True)
    job = work / "replace_job.json"
    res = work / "replace_result.json"
    job.write_text(json.dumps({"models": {k: str(v) for k, v in models.items()}, "docs": [str(d) for d in docs]},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    if res.exists():
        res.unlink()
    if run is not None:
        return run(job, res)
    rf = RM.RUN_FC
    if not rf.is_file():
        return {"replaced": [], "docs": [str(d) for d in docs], "error": f"run_fc.ps1 nenalezen: {rf}"}
    cmd = [RM._powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(rf), "run", "--slot", slot,
           "--timeout", str(timeout), "--result", str(res), str(HERE / "fc_replace.py"), str(job)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=timeout + 180, creationflags=NOWIN)
        tail = (r.stdout or "")[-800:] + (r.stderr or "")[-400:]
    except subprocess.TimeoutExpired:
        subprocess.run([RM._powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(rf), "cleanup",
                        "--slot", slot], capture_output=True, timeout=120, creationflags=NOWIN)
        tail = "timeout"
    try:
        return json.loads(res.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"replaced": [], "docs": [str(d) for d in docs], "error": "FreeCAD nevrátil výsledek: " + tail}


def register_downloads(folder: str | Path, manifest: dict, by: str, *, parts_index: dict | None = None,
                       measure=None, replace=True, replace_run=None, to_library: bool = True,
                       timeout: float = 600) -> dict:
    """``models/manual/*.stp`` → ``models/index.json`` (register_manual: hlavička, schéma, FreeCAD objem > 0),
    kontrola obálky proti popisu dílu (varování), kopie do knihovny (jen ``library_ok``), náhrada zástupných dílů
    v modelu stroje (jen pokud model existuje) a nové STAHNOUT.md / .html."""
    folder = Path(folder)
    if parts_index is None:
        parts_index = load_parts_index(folder)
    md = folder / MODELS_SUB
    rows = download_list(manifest, parts_index, md)
    rep = RM.register(manifest, md, by or "PLCdesk", plan=rows, measure=measure, timeout=timeout, slot=DL_SLOT)
    by_pid = {pid: r for r in rows for pid in r["partIds"]}
    rep["warnings"], rep["library"] = [], []
    for reg in rep["registered"]:
        r = by_pid.get(reg["partId"]) or {}
        w = dims_warning(reg.get("bbox_mm"), r.get("expectedDims"))
        if w and not reg.get("shared"):
            rep["warnings"].append({"partId": reg["partId"], "why": w})
        if to_library and not reg.get("shared") and r.get("libraryOk"):
            p = library_add(r["vendor"], r["orderCode"], md / reg["file"], {"type": r.get("type", ""),
                                                                           "brand": r.get("brand", "")})
            if p:
                rep["library"].append(str(p))
    rep["replace"] = {}
    if replace and rep["registered"]:
        models = {reg["partId"]: str(md / reg["file"]) for reg in rep["registered"]}
        rep["replace"] = replace_placeholders(folder, models, run=replace_run)
        fc = {pid: m["fcstd"] for pid, m in (rep["replace"].get("models") or {}).items() if m.get("ok") and m.get("fcstd")}
        if fc:                                        # FCStd modelu výrobce (cíl App::Link) do indexu
            idx = MI.load(md)
            for pid, p in fc.items():
                if pid in idx["parts"]:
                    idx["parts"][pid]["fcstd"] = MI.rel(md, Path(p))
            MI.save(md, idx)
    write_lists(folder, manifest, parts_index)
    return rep
