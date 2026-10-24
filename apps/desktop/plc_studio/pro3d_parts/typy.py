"""Rozbor typového označení dílů (čistý Python, bez FreeCADu a bez importu z ``plc_studio``).

Válce — vrací ``{"norma": "ISO 15552" | "ISO 6432" | None, "vyrobce", "rada", "prumer", "zdvih", "zdroj"}`` nebo ``None``.
Zdroj klíče objednávky je uveden u každé řady (katalog výrobce). Rozměry válce bere generátor z ``data/valce.json``
podle normy a průměru — typ jen určí normu, průměr a zdvih.
"""

from __future__ import annotations

import re

# klíč objednávky — zdroj (katalog výrobce), norma
CYL_SERIES = (
    # Festo DSBC-<Ø>-<zdvih>-… = ISO 15552 (Festo katalog DSBC, klíč typu: DSBC-Ø-zdvih-tlumení-…)
    ("Festo", "DSBC", re.compile(r"\bDSBC-(\d{2,3})-(\d{1,4})\b", re.I), "ISO 15552",
     "https://ftp.festo.com/public/PNEUMATIC/SOFTWARE_SERVICE/DataSheet/EN_GB/1376426.pdf (DSBC-32-100-PPVA-N3: "
     "ISO 15552, píst 32 mm, zdvih 100 mm, M10x1.25)"),
    # Festo DSNU-<Ø>-<zdvih>-… = ISO 6432 (Ø8–25; Ø32–63 mimo normu)
    ("Festo", "DSNU", re.compile(r"\bDSNU-(\d{1,2})-(\d{1,4})\b", re.I), "ISO 6432",
     "data/catalog/pneu.json PLCdesk (Festo řada „DSNU (ISO 6432)“); klíč DSNU-Ø-zdvih jako u DSBC"),
    # SMC CP96S(D)B<Ø>-<zdvih>… a C96S(D)B<Ø>-<zdvih>… = ISO 15552 (katalog CP96 / C96, How to Order)
    ("SMC", "CP96", re.compile(r"\bCP96[SDKY]*[BLFGCDTEUV]?(\d{2,3})-(\d{1,4})", re.I), "ISO 15552",
     "https://content2.smcetech.com/pdf/CP96.pdf"),
    ("SMC", "C96", re.compile(r"(?<![A-Z])C96[SDKY]*[BLFGCDTEUV]?(\d{2,3})-(\d{1,4})", re.I), "ISO 15552",
     "https://content2.smcetech.com/pdf/C96.pdf"),
    # SMC C85N<Ø>-<zdvih>… / CD85N… = ISO 6432 (katalog C85, How to Order)
    ("SMC", "C85", re.compile(r"\bC[D]?85[NEK]*[BFLTCMRW]?(\d{1,2})-(\d{1,4})", re.I), "ISO 6432",
     "https://content2.smcetech.com/pdf/C85.pdf"),
    # SMC CJ2B<Ø>-<zdvih>… = nenormový mini válec Ø6–16 (katalog CJ2) — rozměry v tabulce nejsou
    ("SMC", "CJ2", re.compile(r"\bCD?J2[BDLFTRUZ]*(\d{1,2})-(\d{1,4})", re.I), None,
     "https://content2.smcetech.com/pdf/CJ2.pdf"),
)

# „ISO 15552, Ø32, zdvih 100 mm“ v popisu kusovníku PLCdesk
_DESC = re.compile(r"ISO\s*(15552|6432)\D{0,20}?[Øø⌀]\s*(\d{1,3})\D{0,30}?zdvih\w*\s*(\d{1,4})", re.I)


def parse_cylinder(text: str, order_code: str = "") -> dict | None:
    """Válec z typu (Festo DSBC / DSNU, SMC CP96 / C96 / C85 / CJ2) nebo z popisu „ISO 15552, Ø32, zdvih 100“."""
    t = f"{text or ''} {order_code or ''}"
    for vyr, rada, rx, norma, src in CYL_SERIES:
        m = rx.search(t)
        if m:
            return {"norma": norma, "vyrobce": vyr, "rada": rada, "prumer": int(m.group(1)), "zdvih": int(m.group(2)),
                    "zdroj": src}
    m = _DESC.search(t)
    if m:
        return {"norma": "ISO " + m.group(1), "vyrobce": "", "rada": "popis", "prumer": int(m.group(2)),
                "zdvih": int(m.group(3)), "zdroj": "popis kusovníku PLCdesk"}
    return None


_THREAD = re.compile(r"^M(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$", re.I)


def parse_thread(s: str) -> tuple[float, float | None] | None:
    """„M10x1.25“ → (10.0, 1.25); „M6“ → (6.0, None)."""
    m = _THREAD.match((s or "").replace(" ", "").replace(",", "."))
    if not m:
        return None
    return float(m.group(1)), (float(m.group(2)) if m.group(2) else None)


# ISO 228-1 (trubkový závit G): vnější průměr závitu [mm] — https://www.iso.org/standard/3776.html (tabulka 1)
G_THREAD_D = {"G1/8": 9.728, "G1/4": 13.157, "G3/8": 16.662, "G1/2": 20.955}


def norm_code(code: str) -> str:
    """Objednací kód pro porovnání: bez mezer, velkými písmeny."""
    return re.sub(r"\s+", "", str(code or "")).upper()


_PART = re.compile(r"^\s*(ISO\s*\d+|TS35|SKINTOP)\s*[- ]?\s*(\S+)?\s*$", re.I)


def parse_part_request(s: str) -> tuple[str, str] | None:
    """Požadavek CLI ``part``: „ISO4762 M6x20“, „ISO4032 M6“, „TS35 7.5x500“, „SKINTOP M20“, „ISO15552 32x100“."""
    m = _PART.match(s or "")
    if not m:
        return None
    return re.sub(r"\s+", "", m.group(1)).upper(), (m.group(2) or "")
