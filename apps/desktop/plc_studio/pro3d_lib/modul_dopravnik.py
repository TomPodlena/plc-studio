"""Modul D1 — pásový dopravník (čistý Python: vstup z manifestu, výpočet, plán, smlouva; FreeCAD: ``fc_ram.py`` =
``fc_lib.py``).

Obal generátoru skillu ``dopravniky`` (``~/.claude/skills/dopravniky``): výpočet = ``scripts/dopravnik_calc.py``
(``vypocet`` — tah FU / F1, buben, výkon, moment, napínání, zatížení hřídelí; metoda Forbo 304 / 305), data
``data/dopravniky.json`` (ložiska NSK UCF, bombírování, pás). Geometrie je TÁŽ jako ``scripts/fc_dopravnik.py``
(hlavový pohon, kluzná deska, šroubové napínání, souřadnice X = směr dopravy, vratný buben x = 0, hnací x = L, Y šířka,
střed 0, Z nahoru), jen jako plán ``pro3d_lib`` — díly do ``dily/`` a App::Link, takže opakované díly nejsou kopie,
a se spoji spojky V4 (generátor skillu spoje nemá a kontroly ``kopie`` / ``zasunuti`` z 2026-11-03 by neprošel):

* bočnice 40 × 80 na výšku, příčky 40 × 40 pod kluznou deskou dlouhým šroubem ALUTEC přes bočnici (``Ram.dlouhy_sroub``);
* ložiskové desky (ocel, ODHAD t 8) ke vnitřnímu líci bočnic 4 × ISO 4762 M6 do matic T, přírubová ložiska NSK UCF
  (dle dokumentace) 4 × M10 s maticí ISO 4032 přes desku; vratný konec podélné otvory napínání ± X/2 (X z výpočtu);
* bubny bombírované (válec b/2, h forbo305 s. 3), hřídele, pás (větve + opásání), pohon zástupně (rozměry převodového
  motoru bez katalogu = ODHAD, oranžová), kabel motoru (spojka V2, vývod s ohybem R);
* kryty vtažných míst zástupně (spodní vana s čely, lišty přes okraj pásu u bubnů) a zóny ``Zona_vtazne_misto_*``
  (náběh pásu na buben — EN 619 rámec, ISO 13857 měří ``pro3d_tools otvory``);
* kotvení: ``ram`` = stojiny 40 × 40 na montážních nosnících rámu N1 (``modul_ram`` nosníky 40 × 80 naležato),
  úhelníky ALUTEC 303876 nahoře (bočnice) i dole (nosník) — vše maticemi T, nic se do rámu nevrtá; ``nohy`` = vlastní
  nohy se stavěcími patkami a příčnou vzpěrou;
* přípravy pro moduly: konzola vyhazovače (úhelník S235 na vnější drážce bočnice + profil 40 × 40 napříč, na něm P1
  ``modul_valec`` s deskou pod patkami) a snímač S1 (``modul_snimac``) na horní drážce bočnice přes distanční desku
  (paprsek nad pásem).

Výstup: ``Dopravnik.plan()`` (modul pro plán ``fc_lib``), ``rozhrani`` = smlouva ``D1_<id>.json`` (pás: výška, osa,
šířka, rychlost; bubny; výpočet; plochy pro S1 / P1 = volné úseky drážek bočnic; síly do rámu; nebezpečná místa; kabel
motoru; kotvení; odhady; zdroje), ``sestava(...)`` = zkušební sestava rám N1 + D1 + S1 + P1.

CLI: ``python -m plc_studio.pro3d_lib.modul_dopravnik [--manifest PLCdesk_CAD.json] [--dev M1] [--plan P]
[--rozhrani SLOŽKA] [--fc SLOŽKA] [--slot pro-d1]`` (bez manifestu = vzor 01 z ``.claude/p3p/all/man_01.json`` nebo
výchozí ODHAD)."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import modul_ram, modul_snimac, modul_valec, spojky_el, spojky_mech  # noqa: E402
from .modul_ram import add, cols, r3, _lib  # noqa: E402

HERE = Path(__file__).resolve().parent
SKILL = Path.home() / ".claude" / "skills" / "dopravniky"
GEN = "pro3d_lib/modul_dopravnik"
SLOT = "pro-d1"
NORM = spojky_mech.NORM
RAM = modul_ram.DATA
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
RZ180 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]
SRC_SKILL = "skill dopravniky (data/dopravniky.json, scripts/dopravnik_calc.py; geometrie dle scripts/fc_dopravnik.py)"

# --- výchozí hodnoty: vše bez zdroje je ODHAD a zapíše se do ``odhady`` -------------------------------------------------
VYCHOZI = {
    "L": 1500.0, "b0": 300.0, "H": 900.0, "v": 0.2, "m_kg": 10.0,     # ODHAD (PLCdesk rozměry nezná — skill dopravniky)
    "pas": "E 4/2 U0/U2 MT-HACCP white FDA",                           # příklad pásu skillu (list Forbo 900207)
    "D_min_konstr": 80.0,     # ODHAD — konstrukční minimum bubnu (hřídel Ø20 + UCF204 + příčka 40 mezi větvemi; skill vzor 01)
    "presah_bubnu": 10.0, "stena_bubnu": 3.0, "celo_bubnu": 8.0,      # ODHAD (jako fc_dopravnik VYCHOZI)
    "mezera_buben_deska": 16.0,  # ODHAD — mezi čelem bubnu a deskou se vejde matice M10 ISO 4032 (m 8,4) s přesahem šroubu
    "deska_t": 12.0, "prekryti_desky": 80.0, "roztec_pricek": 500.0,   # ODHAD
    "deska_kluzna_t": 2.0, "deska_pod_pasem": 2.0, "mezera_deska_buben": 5.0,   # forbo305 s. 6 (2–3 mm) / ODHAD
    "kryt_t": 2.0, "kryt_mezera": 5.0, "kryt_presah_pasu": 10.0, "kryt_nad_pasem": 3.0,   # ODHAD (zástupné kryty)
    "prevodovka": [140.0, 110.0, 140.0], "motor_D": 110.0, "motor_L": 200.0,          # ODHAD bez katalogu
    "kabel_D": 9.0,           # ODHAD — kabel motoru 4G1,5 (Ø ~ 9), typ z kusovníku (PLCdesk ho nemá)
    "kabel_R_x_D": 6.0,       # ODHAD — pevné uložení; skutečný poloměr z listu kabelu (skill kabelaz-a-hadice)
    "stojina": 170.0,         # ODHAD — délka stojiny dopravníku na rámu N1 (≥ 2 ramena úhelníku 76 + mezera)
    "roztec_noh": 1050.0,     # ODHAD — největší rozteč noh (průhyb bočnice ověří dopravnik_calc pruhyb_bocnice)
    "osa_vyhazovace_nad_pasem": 35.0,   # ODHAD — výška osy pístnice vyhazovače nad pásem (podle výšky zboží)
    "distancni_S1": 19.0,     # ODHAD — distanční deska pod držákem S1 (paprsek WL12 nad pásem i s rozptylem)
    "patka_h": 25.0,          # nohy: patka ALUTEC 408008 (geometrie modul_ram, výška ODHAD)
}
RE_NUM = r"(\d+(?:[.,]\d+)?)"


def _calc_module():
    p = SKILL / "scripts" / "dopravnik_calc.py"
    if not p.is_file():
        raise FileNotFoundError(f"skill dopravniky chybí: {p}")
    spec = importlib.util.spec_from_file_location("dopravnik_calc", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def skill_data() -> dict:
    return json.loads((SKILL / "data" / "dopravniky.json").read_text(encoding="utf-8"))


# --- vstup z manifestu ---------------------------------------------------------------------------------------------------
RE_PAS = re.compile(r"pás|pas\b|dopravn|conveyor|förder|band", re.I)
RE_VYHAZ = re.compile(r"vyhazov|shod|ejector|auswerf|pusher|odhoz", re.I)


def _num(rx, text, k=1.0):
    m = re.search(rx, text or "", re.I)
    return float(m.group(1).replace(",", ".")) * k if m else None


def parse_popis(desc: str) -> dict:
    """Rozměry pásu z popisu zařízení (cs / en / de): „délka 1500“, „šířka 300“, „L = 2 m“, „0,2 m/s“, „10 kg“,
    „výška 900“. Co v popisu není, doplní ``VYCHOZI`` (ODHAD)."""
    d = desc or ""
    out = {}
    v = _num(r"(?:délk[ay]|length|länge|\bL\s*=?)\s*" + RE_NUM + r"\s*m\b(?!m)", d, 1000.0) or \
        _num(r"(?:délk[ay]|length|länge|\bL\s*=?)\s*" + RE_NUM + r"\s*(?:mm)?", d)
    if v:
        out["L"] = v
    v = _num(r"(?:šířk[ay]|width|breite|\bb0?\s*=?)\s*" + RE_NUM, d)
    if v:
        out["b0"] = v
    v = _num(r"(?:výšk[ay]|height|höhe|\bH\s*=?)\s*" + RE_NUM, d)
    if v:
        out["H"] = v
    v = _num(RE_NUM + r"\s*m\s*/\s*s", d)
    if v:
        out["v"] = v
    v = _num(RE_NUM + r"\s*kg", d)
    if v:
        out["m_kg"] = v
    return out


# zadání pásu z PLCdesk (``devices[].conveyor``, krok Zařízení, od 2026-11-04) má přednost před rozměry z popisu
CONVEYOR_KEYS = {"length": "L", "width": "b0", "height": "H", "speed": "v", "load": "m_kg"}


def zadani_pasu(dev: dict) -> dict:
    """Rozměry pásu zadané v PLCdesk (``conveyor``: length / width / height mm, speed m/s, load kg); nezadané pole chybí."""
    cv = dev.get("conveyor") or {}
    return {k: float(cv[c]) for c, k in CONVEYOR_KEYS.items() if isinstance(cv.get(c), (int, float)) and not isinstance(cv.get(c), bool)}


def _parts_of(man: dict, dev: str) -> list[dict]:
    return [p for p in man.get("parts") or [] if p.get("device") == dev]


def vstup_z_manifestu(man: dict, dev: str | None = None) -> dict:
    """Zařízení dopravníku (Motor / Vfd s popisem pásu), jeho díl kusovníku (převodový motor), snímače u pásu (DI
    s optickým / indukčním dílem, popis „před / na pásu“) a vyhazovač (Ventil s válcem, popis „vyhazov…“)."""
    devs = man.get("devices") or []
    cand = [d for d in devs if d.get("cls") in ("Motor", "Vfd") and (dev is None or d.get("name") == dev)]
    cand = [d for d in cand if dev is not None or d.get("conveyor") or RE_PAS.search(d.get("desc") or "")] or cand
    if not cand:
        raise ValueError("manifest nemá zařízení dopravníku (Motor / Vfd s popisem pásu)")
    d = cand[0]
    vst = {"id": d["name"], "nazev": d.get("desc") or "Pásový dopravník", "cls": d.get("cls"), "rampS": d.get("rampS"),
           "setpoint": d.get("setpoint"), "popis": {**parse_popis(d.get("desc") or ""), **zadani_pasu(d)},
           "pohon_PLCdesk_Id": "", "pohon_typ": ""}
    for p in _parts_of(man, d["name"]):
        if p.get("category") in ("gearmotor", "motor"):
            vst["pohon_PLCdesk_Id"], vst["pohon_typ"] = p["id"], p.get("type") or ""
    sn, vy = [], []
    for o in devs:
        parts = _parts_of(man, o["name"])
        cats = {p.get("category") for p in parts}
        if o.get("cls") == "DI" and cats & {"sensor_optical", "sensor_inductive", "sensor_capacitive"}:
            p = next(p for p in parts if p.get("category", "").startswith("sensor_"))
            typ = next((k for k, t in modul_snimac.SNIMACE.items() if t["katalog"] == p.get("orderCode")), None)
            sn.append({"id": o["name"], "popis": o.get("desc") or "", "PLCdesk_Id": p["id"], "typ": typ, "kod": p.get("orderCode")})
        if o.get("cls") == "Ventil" and "cylinder" in cats and RE_VYHAZ.search(o.get("desc") or ""):
            p = next(p for p in parts if p.get("category") == "cylinder")
            t = p.get("type") or ""
            norma = "ISO 6432" if "6432" in t else "ISO 15552"
            vy.append({"id": o["name"], "tag": p.get("tag") or "-" + o["name"], "popis": o.get("desc") or "", "norma": norma,
                       "prumer": int(_num(r"Ø\s*" + RE_NUM, t) or 32), "zdvih": int(_num(r"zdvih\s*" + RE_NUM, t) or 100),
                       "typ": t, "PLCdesk_Id": p["id"]})
    vst["snimace"], vst["vyhazovace"] = sn, vy
    return vst


# --- výpočet --------------------------------------------------------------------------------------------------------------
def vypocet(par: dict) -> dict:
    calc = _calc_module()
    vst = {"L_m": par["L"] / 1000.0, "b0_mm": par["b0"], "v_m_s": par["v"], "m_kg": par["m_kg"], "pas": par["pas"],
           "rozpeti_noh_mm": par.get("rozpeti_noh_mm")}
    if par.get("t_rampa_s"):
        vst["t_rampa_s"] = par["t_rampa_s"]
    return calc.vypocet(vst)


# --- stavitel ------------------------------------------------------------------------------------------------------------
class Dopravnik(modul_ram.Ram):
    """Plán D1 v globálních souřadnicích (``origin`` = poloha osy vratného bubnu x, středu pásu y, podlahy z)."""

    def __init__(self, ident="M1", nazev="", par=None, origin=(0.0, 0.0, 0.0), kotveni="ram", z_ramu=None,
                 vyhazovac=None, snimac=None, pohon_PLCdesk_Id="", pohon_typ=""):
        self.ident, self.nazev = ident, nazev or f"D1 pásový dopravník {ident}"
        self.dily, self.inst, self.tel, self.members = {}, [], [], []
        self.odhady, self.zdroje, self.varovani, self.chyby = set(), {SRC_SKILL, modul_ram.SRC_PROF, modul_ram.SRC_KAT}, [], []
        self.srouby, self.klice, self.montaz, self.boxes_extra = [], [], [], []
        self.kab, self.subs = [], []
        p = dict(VYCHOZI)
        p.update({k: v for k, v in (par or {}).items() if v is not None})
        self.p = p
        self.o = [float(c) for c in origin]
        self.kotveni = kotveni
        self.z_ramu = z_ramu
        self.vyh_in = vyhazovac
        self.sn_in = snimac
        self.pohon_id, self.pohon_typ = pohon_PLCdesk_Id, pohon_typ
        self.moduly_ext = []          # S1 / P1 (samostatné moduly plánu)
        self.zony, self.kotvy = [], []

    def g(self, x, y, z):
        return [x + self.o[0], y + self.o[1], z + self.o[2]]

    def gb(self, b):              # box v místních → globální
        return [b[0] + self.o[0], b[1] + self.o[0], b[2] + self.o[1], b[3] + self.o[1], b[4] + self.o[2], b[5] + self.o[2]]

    def box_extra(self, name, b):
        g = self.gb(b)
        self.boxes_extra.append((name, [g[0], g[2], g[4], g[1], g[3], g[5]]))

    def tel_add(self, name, label, body, props):
        self.tel.append({"name": name, "label": label, "body": body, "props": dict({"Konstrukce_Generator": GEN}, **props)})

    # -- geometrie
    def build(self):
        p, sd = self.p, skill_data()
        self.calc = vypocet(dict(p, rozpeti_noh_mm=p["roztec_noh"]))
        c = self.calc
        L, b0, H = float(p["L"]), float(p["b0"]), float(p["H"])
        pas = sd["pasy"].get(p["pas"]) or {}
        t = float(pas.get("tloustka_mm") or 1.5)
        if not pas.get("tloustka_mm"):
            self.odhady.add("tloušťka pásu 1,5 mm ODHAD (list pásu bez tloušťky)")
        D_calc = c["buben"]["D_zvoleny_mm"]
        Dd = max(math.ceil(D_calc), float(p["D_min_konstr"]))
        if Dd > D_calc + 0.5:
            self.odhady.add(f"průměr bubnu {Dd:g} mm = konstrukční minimum (výpočet dA / d_min pásu dává {D_calc:.0f} mm) — ODHAD")
        R = Dd / 2
        b = b0 + 2 * p["presah_bubnu"]
        d = c["vstup"].get("d_hridel_mm") or 20.0
        ucf = {20.0: "UCF204", 25.0: "UCF205", 30.0: "UCF206"}[float(d)]
        u = sd["loziska_ucf"][ucf]
        Lb, A0, A1, J, N = u["L"], u["A0"], u["A1"], u["J"], u["N"]
        tk = sd["kuzelovitost_h"]
        h = tk["jednovrstvy"][0 if Dd <= tk["meze_d"][0] else (1 if Dd <= tk["meze_d"][1] else 2)]
        X = max(float(c["napinani"].get("X_mm") or 0.0), 10.0)
        tp = p["deska_t"]
        zax = H - t - R
        yb = b / 2 + p["mezera_buben_deska"] + tp           # vnitřní líc bočnice = vnější líc ložiskové desky
        yk = yb - tp
        boc_top = zax + R - p["deska_pod_pasem"] - p["deska_kluzna_t"]
        zc = boc_top - 40.0
        boc_bot = zc - 40.0
        x_b0 = Lb / 2 + X / 2 + 30.0
        x_b1 = L - (Lb / 2 + 10.0)
        if boc_bot + 40 < zax - R + 5:
            self.chyby.append("buben je malý: příčka pod kluznou deskou by zasáhla vratnou větev (D ≥ 50 mm)")
        self.geo = dict(L=L, b0=b0, H=H, t=t, D=Dd, R=R, b=b, d=d, ucf=ucf, h=h, X=X, zax=zax, yb=yb, yk=yk, boc_top=boc_top,
                        zc=zc, boc_bot=boc_bot, x_b0=x_b0, x_b1=x_b1, Lb=Lb)
        for k, txt in (("presah_bubnu", "buben o {:g} mm na stranu delší než pás"), ("stena_bubnu", "stěna bubnu {:g} mm"),
                       ("celo_bubnu", "čelo bubnu {:g} mm"), ("mezera_buben_deska", "mezera čelo bubnu – ložisková deska {:g} mm (matice M10)"),
                       ("deska_t", "ložisková deska ocel {:g} mm"), ("roztec_pricek", "příčky pod kluznou deskou po ≤ {:g} mm"),
                       ("deska_kluzna_t", "kluzná deska plech {:g} mm")):
            self.odhady.add("ODHAD: " + txt.format(p[k]))
        for k in ("L", "b0", "H", "v", "m_kg"):
            if k not in (self.p.get("_ze_zadani") or ()):
                self.odhady.add(f"ODHAD: {k} = {p[k]:g} (zadání PLCdesk rozměr neuvádí — doplní layout)")
        # bočnice
        self.boc = {}
        for s, n in ((1, "L"), (-1, "P")):
            m = self.member("104080", 40.0, 80.0, x_b1 - x_b0, self.g(x_b0, s * (yb + 20), zc), [0, 1, 0], [0, 0, 1], [1, 0, 0],
                            "bocnice", f"bočnice {n}")
            self.boc[s] = m
        # příčky — mimo desky ložisek a mimo konzolu vyhazovače (dlouhé šrouby na vnějším líci)
        xp0, xp1 = x_b0 + p["prekryti_desky"] + 30, x_b1 - p["prekryti_desky"] - 30
        n_pr = max(2, int(math.ceil((xp1 - xp0) / p["roztec_pricek"])) + 1)
        xs_pr = [xp0 + (xp1 - xp0) * i / (n_pr - 1) for i in range(n_pr)]
        self.xe = None
        if self.vyh_in:
            self.xe = float(self.vyh_in.get("x") or (L - 350.0))
            for i, x in enumerate(xs_pr):
                if abs(x - self.xe) < 70:
                    xs_pr[i] = self.xe + (-70 if x <= self.xe else 70)
        self.pricky = []
        for i, x in enumerate(xs_pr):
            m = self.member("104040", 40.0, 40.0, 2 * yb, self.g(x, -yb, zc + 20), [1, 0, 0], [0, 0, -1], [0, 1, 0], "pricka",
                            f"příčka {i + 1}")
            self.pricky.append(m)
            for s in (1, -1):
                self.dlouhy_sroub(self.boc[s], self.g(x, s * (yb + 40), zc + 20), [0, -s, 0], 40.0, f"příčka {i + 1} → bočnice {s:+d}")
        # kluzná deska
        xk0, xk1 = R + p["mezera_deska_buben"], L - R - p["mezera_deska_buben"]
        kd = self.dil(_lib(f"D1_Kluzna_deska_{xk1 - xk0:g}x{2 * yk:g}", {"add": [{"box": [0, xk1 - xk0, -yk, yk, 0, p["deska_kluzna_t"]]}]},
                           "Kluzná deska (plech, sražené hrany)", "forbo305 s. 6 (2–3 mm pod pásem, sražené hrany); plech ODHAD",
                           "tvar", material="ocel / nerez", vlastni=True))
        self.put(kd, self.g(xk0, 0, boc_top), I3, "dil", {"Konstrukce_Role": "kluzna_deska"})
        # ložiskové desky + šrouby do bočnic
        ztop_d = max(zax + Lb / 2 + 10, H + p["kryt_nad_pasem"] + p["kryt_t"] + 3)
        zbot_d = min(zax - Lb / 2 - 10, zc - 35)
        self.desky = {}
        for kon in ("vratny", "hnaci"):
            if kon == "vratny":
                xd0, xd1, xa = -Lb / 2 - X / 2 - 10, x_b0 + p["prekryti_desky"], 0.0
                xsr = [x_b0 + 20, x_b0 + p["prekryti_desky"] - 20]
            else:
                xd0, xd1, xa = x_b1 - p["prekryti_desky"], L + Lb / 2 + 10, L
                xsr = [x_b1 - p["prekryti_desky"] + 20, x_b1 - 20]
            cut = []
            hole = spojky_mech.otvor_vule("M10") / 2
            for sx in (-1, 1):
                for sz in (-1, 1):
                    hx, hz = xa + sx * J / 2 - xd0, zax + sz * J / 2 - zbot_d
                    if kon == "vratny":
                        cut += [modul_ram._cyl([hx - X / 2, -1, hz], [0, 1, 0], hole, tp + 2), modul_ram._cyl([hx + X / 2, -1, hz], [0, 1, 0], hole, tp + 2),
                                {"box": [hx - X / 2, hx + X / 2, -1, tp + 1, hz - hole, hz + hole]}]
                    else:
                        cut.append(modul_ram._cyl([hx, -1, hz], [0, 1, 0], hole, tp + 2))
            ax, az = xa - xd0, zax - zbot_d
            if kon == "vratny":
                cut += [modul_ram._cyl([ax - X / 2, -1, az], [0, 1, 0], d / 2 + 1, tp + 2), modul_ram._cyl([ax + X / 2, -1, az], [0, 1, 0], d / 2 + 1, tp + 2),
                        {"box": [ax - X / 2, ax + X / 2, -1, tp + 1, az - d / 2 - 1, az + d / 2 + 1]}]
            else:
                cut.append(modul_ram._cyl([ax, -1, az], [0, 1, 0], d / 2 + 1, tp + 2))
            for x in xsr:
                for z in (zc - 20, zc + 20):
                    cut.append(modul_ram._cyl([x - xd0, -1, z - zbot_d], [0, 1, 0], spojky_mech.otvor_vule("M6") / 2, tp + 2))
            key = self.dil(_lib(f"D1_Deska_lozisek_{kon}_{ucf}_X{X:g}", {"add": [{"box": [0, xd1 - xd0, 0, tp, 0, ztop_d - zbot_d]}], "cut": cut},
                                f"Ložisková deska {kon} ({ucf}{', podélné otvory napínání ± %g' % (X / 2) if kon == 'vratny' else ''})",
                                "ODHAD — vlastní díl (tvar a tloušťka bez zdroje; díry ložiska J / N z listu NSK)", "tvar",
                                material="ocel S235 (ODHAD)", vlastni=True))
            self.desky[kon] = (xd0, xd1)
            for s in (1, -1):
                y0 = yb - tp if s > 0 else -yb
                self.put(key, self.g(xd0, y0, zbot_d), I3, "dil", {"Konstrukce_Role": "lozisková deska"})
                self.box_extra(f"ložisková deska {kon} {s:+d}", [xd0, xd1, min(y0, y0 + tp), max(y0, y0 + tp), zbot_d, ztop_d])
                for x in xsr:
                    for z in (zc - 20, zc + 20):
                        self.nut_screw("M6", self.g(x, s * yb, z), [1, 0, 0], [0, -s, 0], tp, True, f"deska ložisek {kon} {s:+d} → bočnice")
        # bubny a hřídele
        ri = R - p["stena_bubnu"]
        ce = p["celo_bubnu"]
        body = {"add": [{"cyl": {"p": [0, -b / 4, 0], "d": [0, 1, 0], "r": R, "h": b / 2}},
                        {"cone": {"p": [0, -b / 2, 0], "d": [0, 1, 0], "r1": R - h, "r2": R, "h": b / 4}},
                        {"cone": {"p": [0, b / 4, 0], "d": [0, 1, 0], "r1": R, "r2": R - h, "h": b / 4}}],
                "cut": [{"cyl": {"p": [0, -b / 2 + ce, 0], "d": [0, 1, 0], "r": ri, "h": b - 2 * ce}},
                        {"cyl": {"p": [0, -b / 2 - 1, 0], "d": [0, 1, 0], "r": d / 2, "h": b + 2}}]}
        bk = self.dil(_lib(f"D1_Buben_D{Dd:g}_b{b:g}", body, f"Buben bombírovaný Ø{Dd:g} × {b:g} (h {h:g})",
                           ["forbo305 s. 3 (válec b/2, kuželovitost h)", SRC_SKILL],
                           f"stěna {p['stena_bubnu']:g} a čela {ce:g} přivařená ODHAD; povrch Rz ≤ 25 µm", material="ocel", vlastni=True))
        ya = yb + A0 + 5
        pr = [float(x) for x in p["prevodovka"]]
        gy0 = yb + max(A0, 40.0) + 5
        hr_v = self.dil(_lib(f"D1_Hridel_d{d:g}_{2 * ya:g}", {"add": [{"cyl": {"p": [0, -ya, 0], "d": [0, 1, 0], "r": d / 2, "h": 2 * ya}}]},
                             f"Hřídel vratného bubnu Ø{d:g}", "ODHAD — Ø podle šířky (dopravnik_calc d_hridel)", "tvar", material="ocel", vlastni=True))
        yh = gy0 + pr[1]
        hr_h = self.dil(_lib(f"D1_Hridel_d{d:g}_{ya:g}_{yh:g}", {"add": [{"cyl": {"p": [0, -ya, 0], "d": [0, 1, 0], "r": d / 2, "h": ya + yh}}]},
                             f"Hřídel hnacího bubnu Ø{d:g} s čepem pro nástrčnou převodovku", "ODHAD", "tvar", material="ocel", vlastni=True))
        self.put(bk, self.g(0, 0, zax), I3, "buben", {"Konstrukce_Role": "buben vratný (napínací)"})
        self.put(bk, self.g(L, 0, zax), I3, "buben", {"Konstrukce_Role": "buben hnací"})
        self.put(hr_v, self.g(0, 0, zax), I3, "hridel")
        self.put(hr_h, self.g(L, 0, zax), I3, "hridel")
        # ložiska UCF (dle dokumentace) + šrouby M10 s maticí přes desku
        Lb2 = Lb / 2
        holes = [modul_ram._cyl([sx * J / 2, -1, sz * J / 2], [0, 1, 0], N / 2, A1 + 2) for sx in (-1, 1) for sz in (-1, 1)]
        lk = self.dil(_lib(f"D1_{ucf}_obalka", {"add": [{"box": [-Lb2, Lb2, 0, A1, -Lb2, Lb2]},
                                                        {"cyl": {"p": [0, A1, 0], "d": [0, 1, 0], "r": (J - N) / 2, "h": u["A"] - A1}},
                                                        {"cyl": {"p": [0, u["A"], 0], "d": [0, 1, 0], "r": d / 2 + 6, "h": A0 - u["A"]}}],
                                                "cut": holes + [{"cyl": {"p": [0, -1, 0], "d": [0, 1, 0], "r": d / 2, "h": A0 + 2}}]},
                           f"Ložisková jednotka NSK {ucf} (obálka)", sd["_info"]["zdroje"]["nsk_ucf"],
                           "obálka: příruba L × L × A1, díry N na rozteči J, těleso do A, kroužek do A0; průměr náboje J − N a "
                           "kroužku d + 12 ODHAD tvaru (NSK je neokótuje)", material="litina / ocel"))
        self.zdroje.add(sd["_info"]["zdroje"]["nsk_ucf"])
        for kon, xa in (("vratny", 0.0), ("hnaci", L)):
            for s in (1, -1):
                self.put(lk, self.g(xa, s * yb, zax), I3 if s > 0 else RZ180, "lozisko", {"Konstrukce_Role": f"ložisko {kon}"})
                for sx in (-1, 1):
                    for sz in (-1, 1):
                        r_ = spojky_mech.sroub_s_matici("M10", self.g(xa + sx * J / 2, s * (yb + A1), zax + sz * J / 2), [0, -s, 0],
                                                        A1 + tp, podlozka=True)
                        if not r_["ok"]:
                            self.chyby.append("ložisko: " + r_["text"])
                            continue
                        for sp in r_["dily"]:
                            self.dil(sp)
                        for it in r_["instance"]:
                            self.put(it["model"], it["pos"], it["rot"], it["druh"])
                        self.srouby.append({"spoj": f"{ucf} {kon} {s:+d} → deska", "sroub": f"ISO 4762 M10x{r_['delka']['l']}",
                                            "text": r_["text"]})
        # pás
        ptxt = f"pás {p['pas']}, t = {t:g} mm (list pásu)"
        vk = self.dil(_lib(f"D1_Pas_vetev_{L:g}x{b0:g}", {"add": [{"box": [0, L, -b0 / 2, b0 / 2, 0, t]}]}, f"Pás — větev {L:g} × {b0:g}",
                           pas.get("zdroj") or SRC_SKILL, ptxt, material="PES / PU", vlastni=True))
        self.put(vk, self.g(0, 0, H - t), I3, "pas", {"Konstrukce_Role": "horní větev"})
        self.put(vk, self.g(0, 0, zax - R - t), I3, "pas", {"Konstrukce_Role": "vratná větev"})
        ob = self.dil(_lib(f"D1_Pas_opasani_R{R:g}_b{b0:g}", {"add": [{"cyl": {"p": [0, -b0 / 2, 0], "d": [0, 1, 0], "r": R + t, "h": b0}}],
                                                              "cut": [{"cyl": {"p": [0, -b0 / 2 - 1, 0], "d": [0, 1, 0], "r": R, "h": b0 + 2}},
                                                                      {"box": [0, R + t + 1, -b0, b0, -R - t - 1, R + t + 1]}]},
                           "Pás — opásání bubnu 180°", pas.get("zdroj") or SRC_SKILL, ptxt, material="PES / PU", vlastni=True))
        self.put(ob, self.g(0, 0, zax), I3, "pas", {"Konstrukce_Role": "opásání vratné"})
        self.put(ob, self.g(L, 0, zax), RZ180, "pas", {"Konstrukce_Role": "opásání hnací"})
        # pohon — zástupně
        txt_poh = "ODHAD bez zdroje — rozměry převodového motoru z katalogu výrobce" + (f" ({self.pohon_typ})" if self.pohon_typ else "")
        self.odhady.add(f"pohon: převodovka {pr[0]:g} × {pr[1]:g} × {pr[2]:g}, motor Ø{p['motor_D']:g} × {p['motor_L']:g} — {txt_poh}")
        pv = self.dil(_lib(f"D1_Prevodovka_{pr[0]:g}x{pr[1]:g}x{pr[2]:g}_d{d:g}",
                           {"add": [{"box": [-pr[0] / 2, pr[0] / 2, 0, pr[1], -pr[2] / 2, pr[2] / 2]}],
                            "cut": [{"cyl": {"p": [0, -1, 0], "d": [0, 1, 0], "r": d / 2, "h": pr[1] + 2}}]},
                           "Převodovka nástrčná (zástupná)", txt_poh, "obálka", material="", zastupny=True))
        self.put(pv, self.g(L, gy0, zax), I3, "pohon", dict({"Konstrukce_Role": "převodovka"},
                                                           **({"PLCdesk_Id": self.pohon_id} if self.pohon_id else {})))
        mD, mL = p["motor_D"], p["motor_L"]
        ym = gy0 + pr[1] / 2
        mo = self.dil(_lib(f"D1_Motor_D{mD:g}x{mL:g}", {"add": [{"cyl": {"p": [0, 0, -mL], "d": [0, 0, 1], "r": mD / 2, "h": mL}}]},
                           "Motor (zástupný)", txt_poh, "obálka", zastupny=True))
        z_mot = zax - pr[2] / 2
        self.put(mo, self.g(L, ym, z_mot), I3, "pohon", {"Konstrukce_Role": "motor"})
        op = self.dil(_lib(f"D1_Momentova_opera_{gy0 - yb:g}", {"add": [{"box": [0, 20, 0, gy0 - yb, 0, 10]}]},
                           "Momentová opěra (zástupná)", "tvar a uchycení podle převodovky — ODHAD", "obálka", zastupny=True))
        zo0 = zax - Lb / 2 - 10
        self.put(op, self.g(L + Lb / 2 - 10, yb, zo0), I3, "pohon", {"Konstrukce_Role": "momentová opěra"})
        self.box_extra("pohon (převodovka)", [L - pr[0] / 2, L + pr[0] / 2, gy0, gy0 + pr[1], zax - pr[2] / 2, zax + pr[2] / 2])
        self.box_extra("pohon (motor)", [L - mD / 2, L + mD / 2, ym - mD / 2, ym + mD / 2, z_mot - mL, z_mot])
        self.box_extra("pohon (momentová opěra)", [L + Lb / 2 - 10, L + Lb / 2 + 10, yb, gy0, zo0, zo0 + 10])
        # kabel motoru (V2): vývod ze svorkovnice motoru (poloha ODHAD) ven (+Y) a dolů
        kD = p["kabel_D"]
        kR = p["kabel_R_x_D"] * kD
        kv = spojky_el.kabel_vyvod(self.g(L, ym + mD / 2, z_mot - mL / 2), [0, 1, 0], [0, 0, -1], kD, kR)
        self.kabel = kv
        self.kab.append({"name": "Kabel_motoru", "label": f"Kabel motoru {self.ident} (začátek, Ø{kD:g}, R {kR:g} — ODHAD)",
                         "r": kv["r"], "path": kv["path"], "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": "silovy",
                                                                     "Kabel_R_min": kR, "PLCdesk_Id": self.pohon_id or ""}})
        self.odhady.add(f"kabel motoru Ø{kD:g}, R {kR:g} (= {p['kabel_R_x_D']:g} × D pevně), vývod ze svorkovnice na boku motoru — ODHAD")
        # kryty vtažných míst (zástupné) + zóny
        g_, kt = p["kryt_mezera"], p["kryt_t"]
        zb = zax - R - t - g_
        x0k, x1k = -(R + t + g_), L + R + t + g_
        vana = {"add": [{"box": [x0k - kt, x1k + kt, -yk, yk, zb - kt, zb]},
                        {"box": [x0k - kt, x1k + kt, yk - kt, yk, zb - kt, boc_bot]},
                        {"box": [x0k - kt, x1k + kt, -yk, -yk + kt, zb - kt, boc_bot]},
                        {"box": [x0k - kt, x0k, -yk, yk, zb - kt, zax - d / 2 - 2]},
                        {"box": [x1k, x1k + kt, -yk, yk, zb - kt, zax - d / 2 - 2]}]}
        txt_kr = (f"tvar a rozměry ODHAD (mezera k pásu {g_:g} mm, plech {kt:g} mm): otvory a vzdálenosti změřit podle ISO 13857 "
                  "tab. 4 (pro3d otvory / ramy-a-kryty), rámec EN 619 (text normy nečten)")
        self.tel_add("Kryt_spodni", "Kryt spodní s čely (zástupný)", {"add": [self._g_body(x) for x in vana["add"]]},
                     {"Konstrukce_Typ": "kryt", "PLCdesk_ModelStatus": "placeholder", "Konstrukce_Zastupny": True,
                      "Konstrukce_Odhad": txt_kr})
        self.odhady.add("kryty vtažných míst zástupné: " + txt_kr)
        zs = H + p["kryt_nad_pasem"]
        li_l = R + 60 - x0k
        lk2 = self.dil(_lib(f"D1_Kryt_lista_{li_l:g}x{yk - b0 / 2 + p['kryt_presah_pasu']:g}",
                            {"add": [{"box": [0, li_l, b0 / 2 - p["kryt_presah_pasu"], yk, 0, kt]}]},
                            "Kryt okraje pásu u bubnu (zástupný)", "ODHAD — lišta přes okraj pásu, 3 mm nad pásem", "obálka",
                            typ="kryt", zastupny=True))
        for x0, mir in ((x0k, False), (L - R - 60, False)):
            for s in (1, -1):
                if s > 0:
                    self.put(lk2, self.g(x0, 0, zs), I3, "kryt")
                else:
                    self.put(lk2, self.g(x0 + li_l, 0, zs), RZ180, "kryt")
        self.box_extra("kryty okraje u bubnů", [x0k, R + 60, -yk, yk, zs, zs + kt])
        self.box_extra("kryty okraje u bubnů", [L - R - 60, x1k, -yk, yk, zs, zs + kt])
        zl = 30.0
        for n, z0, z1, x0, x1, co in (("hnaci_horni", zax + R - 10, zax + R, L - zl, L, "náběh horní větve na hnací buben"),
                                      ("vratny_dolni", zax - R, zax - R + 10, 0.0, zl, "náběh vratné větve na vratný buben")):
            bb = [x0, x1, -b0 / 2, b0 / 2, z0, z1]
            self.tel_add("Zona_vtazne_misto_" + n, "Zona_vtazne_misto_" + n, {"add": [{"box": self.gb(bb)}]},
                         {"Konstrukce_Typ": "zona", "Konstrukce_Zona": "vtažné místo pás × buben (" + co + ")"})
            gb = self.gb(bb)
            self.zony.append({"nazev": "Zona_vtazne_misto_" + n, "druh": "vtazne_misto", "co": co,
                              "bbox": [gb[0], gb[2], gb[4], gb[1], gb[3], gb[5]],
                              "kryt": "zástupný (spodní vana / lišta okraje) — skutečný kryt navrhne modul O3 a změří otvory ISO 13857"})
        # záslepky čel bočnic
        zs_ = RAM["zaslepka"]
        zk = self.dil(_lib("Zaslepka_224080", {"add": [{"box": [-20, 20, -40, 40, 0, zs_["t"]]}]}, "Záslepka ALUTEC 224080 PA6 (zástupná)",
                           zs_["zdroj"], "obálka", typ="prislusenstvi", material="PA6", pozn=zs_["pozn"], zastupny=True))
        for x, sg in ((x_b0, -1), (x_b1, 1)):
            for s in (1, -1):
                self.put(zk, self.g(x, s * (yb + 20), zc), cols([0, sg, 0], [0, 0, 1], [sg, 0, 0]), "zaslepka")
        self.odhady.add(zs_["pozn"])
        # kotvení
        self.legs = []
        if self.kotveni == "ram":
            self._kotveni_ram()
        else:
            self._kotveni_nohy()
        if self.vyh_in:
            self._vyhazovac()
        if self.sn_in:
            self._snimac()
        self.finalize_members()
        self.klic_kontrola()
        self._calc_rozhrani()
        return self

    def _g_body(self, prim):
        return {"box": self.gb(prim["box"])}

    def _xs_legs(self):
        g = self.geo
        x1 = g["x_b0"] + 100.0
        x2 = g["L"] - 270.0 if self.kotveni == "ram" else g["x_b1"] - 100.0
        n = max(1, int(math.ceil((x2 - x1) / self.p["roztec_noh"])))
        return [x1 + (x2 - x1) * i / n for i in range(n + 1)]

    def _kotveni_ram(self):
        """Stojiny 40 × 40 (délka ``stojina``) z horního líce montážních nosníků rámu N1 (z = ``z_ramu``) k bočnicím,
        úhelníky 303876 + matice T (nic se nevrtá). Nosník N1 musí mít osu drážky v x = osa stojiny (nosník x = stojina − 20)."""
        g = self.geo
        z0 = g["boc_bot"] - self.p["stojina"] if self.z_ramu is None else float(self.z_ramu)
        Ls = g["boc_bot"] - z0
        if Ls < 2 * RAM["uhelnik"]["rameno"] + 10:
            self.chyby.append(f"stojina {Ls:.0f} mm je na dva úhelníky 303876 krátká (≥ {2 * RAM['uhelnik']['rameno'] + 10:g})")
        self.z0_ram = z0
        self.odhady.add(f"ODHAD: stojiny dopravníku {Ls:g} mm na nosnících rámu N1, rozteč ≤ {self.p['roztec_noh']:g} mm")
        for i, x in enumerate(self._xs_legs()):
            for s in (1, -1):
                ys = s * (g["yb"] + 20)
                m = self.member("104040", 40.0, 40.0, Ls, self.g(x, ys, z0), [1, 0, 0], [0, 1, 0], [0, 0, 1], "stojina",
                                f"stojina {i + 1}{'L' if s > 0 else 'P'}")
                for sy in (1, -1):        # dole: rameno A na nosníku (drážka podél Y v ose stojiny), B na boku stojiny
                    self.uhelnik(self.g(x, ys + sy * 20, z0), [0, 0, 1], [0, sy, 0], None, m, f"stojina {i + 1} {s:+d} → nosník N1")
                for sx in (1, -1):        # nahoře: rameno A na spodku bočnice (drážka podél X), B na boku stojiny
                    self.uhelnik(self.g(x + sx * 20, ys, g["boc_bot"]), [0, 0, -1], [sx, 0, 0], None, m, f"stojina {i + 1} {s:+d} → bočnice")
                self.kotvy.append({"stojina": m["nazev"], "pos": r3(self.g(x, ys, z0)), "nosnik_N1_x": round(x + self.o[0] - 20, 1),
                                   "drazka_x": round(x + self.o[0], 1), "spoj": "2 × úhelník 303876 + 4 × M8 matice T 210482 do horní drážky nosníku (podél Y)"})
            self.legs.append(x)

    def _kotveni_nohy(self):
        g = self.geo
        pd = RAM["patky"]
        gg = pd["geometrie"]
        z0 = gg["h_patky"] + gg["dr_volny"]
        Ls = g["boc_bot"] - z0
        body = {"add": [{"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": pd["408008"]["d"] / 2, "h": gg["h_patky"]}},
                        {"cyl": {"p": [0, 0, gg["h_patky"]], "d": [0, 0, 1], "r": 4.0, "h": gg["dr_volny"] + gg["dr_zavit_v_jadru"]}}]}
        pk = self.dil(_lib("Patka_408008", body, "Stavěcí patka ALUTEC 408008 Ø80 M8 (zástupná)", pd["_zdroj"], "obálka", typ="patka",
                           material="PA6 + sklo / ocel", pozn=gg["pozn"], zastupny=True))
        self.odhady.add(gg["pozn"])
        self.zdroje.add(pd["_zdroj"])
        z_v = 150.0
        for i, x in enumerate(self._xs_legs()):
            legs = {}
            for s in (1, -1):
                ys = s * (g["yb"] + 20)
                m = self.member("104040", 40.0, 40.0, Ls, self.g(x, ys, z0), [1, 0, 0], [0, 1, 0], [0, 0, 1], "noha",
                                f"noha {i + 1}{'L' if s > 0 else 'P'}")
                legs[s] = m
                self.put(pk, self.g(x, ys, 0.0), I3, "patka")
                for sx in (1, -1):
                    self.uhelnik(self.g(x + sx * 20, ys, g["boc_bot"]), [0, 0, -1], [sx, 0, 0], None, m, f"noha {i + 1} {s:+d} → bočnice")
            m = self.member("104040", 40.0, 40.0, 2 * g["yb"], self.g(x, -g["yb"], z_v + 20), [1, 0, 0], [0, 0, -1], [0, 1, 0],
                            "vzpera", f"vzpěra {i + 1}")
            for s in (1, -1):
                self.dlouhy_sroub(legs[s], self.g(x, s * (g["yb"] + 40), z_v + 20), [0, -s, 0], 40.0, f"vzpěra {i + 1} → noha {s:+d}")
            self.legs.append(x)
        self.odhady.add("vlastní nohy: patky 408008 do jádra, příčná vzpěra ve 150 mm dlouhým šroubem — podélné zavětrování nepočítáno (ODHAD)")

    def _vyhazovac(self):
        """Konzola vyhazovače na −Y bočnici: úhelník S235 t 8 (svislé rameno 4 × M6 do obou vnějších drážek bočnice, vodorovné
        2 × M6 zespodu do profilu konzoly) + profil 40 × 40 napříč (−Y) + modul P1 s deskou pod patkami (osa válce +Y)."""
        g, p, v = self.geo, self.p, self.vyh_in
        xe = self.xe
        yo = -(g["yb"] + 40)                       # vnější líc −Y bočnice
        tb = 8.0
        pa = modul_valec.patka_ms1(int(v["prumer"])) if v["norma"] == "ISO 15552" else None
        if pa is None:
            self.varovani.append(f"vyhazovač {v['tag']}: {v['norma']} — konzola zatím jen pro ISO 15552 s patkami")
            return
        axis = g["H"] + p["osa_vyhazovace_nad_pasem"]
        zt_c = axis - pa["AH"] - modul_valec.T_DESKA
        spec, why = modul_valec.catalog_map.cylinder_spec(v["norma"], int(v["prumer"]), int(v["zdvih"]))
        if not spec:
            self.chyby.append(f"vyhazovač {v['tag']}: {why}")
            return
        Lc = spec["params"]["L8"] + int(v["zdvih"])
        x0, x1 = -pa["delka"] - modul_valec.PREKRYV, Lc + pa["delka"] + modul_valec.PREKRYV
        y_in = yo - tb                              # vnitřní konec profilu konzoly (dosed na svislé rameno)
        pos_y = y_in - 5.0 - x1                      # počátek válce (zadní čelo) — deska končí 5 mm před ramenem (matice T ± 10)
        Lp = (y_in - (pos_y + x0 - 5.0))
        cm = self.member("104040", 40.0, 40.0, Lp, self.g(xe, y_in, zt_c - 20), [1, 0, 0], [0, 0, 1], [0, -1, 0], "konzola",
                         f"konzola vyhazovače {v['tag']}")
        # úhelník konzoly (vlastní díl): svislé rameno na líci bočnice, vodorovné pod profilem
        zb_h = zt_c - 40 - tb
        zv0, zv1 = min(g["zc"] - 35, zb_h), max(g["zc"] + 35, zt_c - 40)
        Lh = min(110.0, Lp - 10)
        hv = spojky_mech.otvor_vule("M6") / 2
        cut = []
        for x in (-32, 32):
            for z in (g["zc"] - 20, g["zc"] + 20):
                cut.append(modul_ram._cyl([x, -1, z - zv0], [0, 1, 0], hv, tb + 2))
        yh = [25.0, Lh - 20.0]
        for yy in yh:
            cut.append(modul_ram._cyl([0, tb + yy, zb_h - zv0 - 1], [0, 0, 1], hv, tb + 2))
        key = self.dil(_lib(f"D1_Konzola_vyhazovace_{zv1 - zv0:g}_{Lh:g}", {"add": [{"box": [-40, 40, 0, tb, 0, zv1 - zv0]},
                                                                                   {"box": [-40, 40, tb, tb + Lh, zb_h - zv0, zb_h - zv0 + tb]}],
                                                                           "cut": cut},
                            f"Konzola vyhazovače (úhelník S235 t {tb:g})", "ODHAD — vlastní díl (tvar a tloušťka bez výpočtu)", "tvar",
                            material="ocel S235 (ODHAD)", vlastni=True))
        # místní y dílu → globální −Y (díl od líce bočnice ven): rot = cols([1,0,0],[0,-1,0],[0,0,-1])? zachovat z nahoru:
        Rk = cols([-1, 0, 0], [0, -1, 0], [0, 0, 1])
        self.put(key, self.g(xe, yo, zv0), Rk, "dil", {"Konstrukce_Role": "konzola vyhazovače"})
        self.box_extra("konzola vyhazovače (svislé rameno)", [xe - 40, xe + 40, yo - tb, yo, zv0, zv1])
        self.box_extra("konzola vyhazovače (vodorovné rameno)", [xe - 40, xe + 40, yo - tb - Lh, yo - tb, zb_h, zb_h + tb])
        for x in (-32, 32):           # mimo šířku profilu konzoly (přístup klíčem)
            for z in (g["zc"] - 20, g["zc"] + 20):
                self.nut_screw("M6", self.g(xe + x, yo, z), [1, 0, 0], [0, -1, 0], tb, False, f"konzola {v['tag']} → bočnice")
        for yy in yh:
            self.nut_screw("M6", self.g(xe, yo - tb - yy, zt_c - 40), [0, 1, 0], [0, 0, -1], tb, False, f"konzola {v['tag']} → profil")
        # záslepka volného čela profilu konzoly
        zs_ = RAM["zaslepka"]
        zk = self.dil(_lib("Zaslepka_224040", {"add": [{"box": [-20, 20, -20, 20, 0, zs_["t"]]}]}, "Záslepka ALUTEC 224040 PA6 (zástupná)",
                           zs_["zdroj"], "obálka", typ="prislusenstvi", material="PA6", pozn=zs_["pozn"], zastupny=True))
        self.put(zk, self.g(xe, y_in - Lp, zt_c - 20), cols([1, 0, 0], [0, 0, 1], [0, -1, 0]), "zaslepka")
        # modul P1
        pos = self.g(xe, pos_y, axis)
        m = modul_valec.modul(v["tag"], v["norma"], int(v["prumer"]), int(v["zdvih"]), "patky", "nic", "deska", pos=pos,
                              rot=modul_valec.RZ90, nazev=f"P1 {v['tag']} vyhazovač {v['norma']} Ø{v['prumer']}×{v['zdvih']} na konzole D1",
                              profil=40)
        self.moduly_ext.append(m)
        tip_ret = pos_y + m["kontrola"]["konec"]
        tip_ext = tip_ret + int(v["zdvih"])
        need = g["b0"] / 2 + 10.0 - tip_ret                 # konec pístnice za vzdálený okraj pásu (+10 ODHAD)
        self.vyh = {"tag": v["tag"], "x": round(xe + self.o[0], 1), "osa_z": round(axis, 1), "konec_zasunuto_y": round(tip_ret + self.o[1], 1),
                    "konec_vysunuto_y": round(tip_ext + self.o[1], 1), "zdvih": int(v["zdvih"]),
                    "zdvih_potreba": int(math.ceil(need)), "PLCdesk_Id": v.get("PLCdesk_Id")}
        if int(v["zdvih"]) < need:
            self.varovani.append(f"vyhazovač {v['tag']}: zdvih {v['zdvih']} mm nestačí — pístnice dojede na y {tip_ext:.0f}, vzdálený okraj "
                                 f"pásu je {g['b0'] / 2:g} (potřeba ≥ {need:.0f} mm, nebo vyhazovací lopatka) — zpětná vazba do PLCdesk")
        self.box_extra(m["nazev"], [m["rozhrani"]["obalka"][i] - self.o[k] for i, k in ((0, 0), (3, 0), (1, 1), (4, 1), (2, 2), (5, 2))])

    def _snimac(self):
        """S1 (``modul_snimac``) na horní drážce −Y bočnice přes distanční desku (ODHAD t ``distancni_S1``) — paprsek +Y
        přes pás na odrazku u +Y bočnice; šrouby základny prodlouženy o distanční desku (spojka V4)."""
        g, p, s = self.geo, self.p, self.sn_in
        typ = s.get("typ") or "WL12"
        if modul_snimac.SNIMACE[typ]["tvar"] != "kvadr":
            self.varovani.append(f"snímač {typ}: na dopravníku zatím jen kvádrový optický (WL12) — válcový S1 doplní stavitel")
            return
        xs = float(s.get("x") or ((self.xe or g["L"] / 2) + 80.0))   # za vyhazovačem: zásuvka M12 míří +X (od pístnice) — ODHAD
        ys = -(g["yb"] + 20)
        dz = p["distancni_S1"]
        zp = g["boc_top"] + dz
        cy = g["b0"] / 2 + 15.0
        m = modul_snimac.modul_kvadr(typ, self.g(xs, cy, zp + 4 + 7.8), y_s=self.g(0, ys, 0)[1], z_p=zp,
                                     nazev=f"S1 {s.get('id', '')} {typ} na bočnici D1")
        # šrouby základny: znovu s tloušťkou držák + distanční deska do drážky bočnice
        n_old = 0
        for sx in (-1, 1):
            n_old += len(spojky_mech.sroub_do_drazky(modul_snimac.M_ZAKLAD, 0, 0, 0, modul_snimac.T_DRZAK)["instance"])
        base = m["telesa"][0]["body"]["add"][0]["box"]
        cx = (base[0] + base[1]) / 2
        new, dily = [], []
        for sx in (-1, 1):
            r_ = spojky_mech.sroub_do_drazky(modul_snimac.M_ZAKLAD, cx + sx * modul_snimac.X_SROUBY, self.g(0, ys, 0)[1], g["boc_top"] + self.o[2],
                                             modul_snimac.T_DRZAK + dz)
            if not r_["ok"]:
                self.chyby.append("S1: " + r_["text"])
                return
            dily += r_["dily"]
            new += r_["instance"]
        shift = len(new) - n_old
        m["instance"] = new + m["instance"][n_old:]
        m["dily"] = m["dily"] + dily
        for t_ in m["telesa"]:
            if t_.get("vyjimka"):
                t_["vyjimka"] = [f"inst:{int(r.split(':')[1]) + shift}" if r.startswith("inst:") else r for r in t_["vyjimka"]]
        # distanční deska pod základnou (jen nad bočnicí, podélné otvory jako držák)
        cuts = [c for c in m["telesa"][0]["body"]["cut"] if "slot" in c]
        sp = []
        for c in cuts:
            q = json.loads(json.dumps(c))
            q["slot"]["p1"][2] = q["slot"]["p2"][2] = g["boc_top"] + self.o[2] - 1
            q["slot"]["h"] = dz + 2
            sp.append(q)
        y0, y1 = base[2], self.g(0, ys + 20, 0)[1]
        self.tel_add("Distancni_S1", f"Distanční deska S1 {typ} (S235 t {dz:g}, ODHAD)",
                     {"add": [{"box": [base[0], base[1], y0, y1, g["boc_top"] + self.o[2], zp + self.o[2]]}], "cut": sp},
                     {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel S235 (ODHAD)",
                      "Konstrukce_Poznamka": "výška paprsku nad pásem s rozptylem 1,5° — ODHAD"})
        self.odhady.add(f"S1 {typ}: distanční deska {dz:g} mm pod držákem (paprsek {zp + 4 + 7.8 - g['H']:.1f} mm nad pásem) — ODHAD")
        for t_ in m["telesa"]:
            if t_["name"] == "Odrazka":
                t_["label"] = f"Pomocná odrazka {modul_snimac.SNIMACE[typ]['odrazka']} (u +Y bočnice — držák doplní stavitel, ODHAD)"
        m["props"] = {"Konstrukce_Generator": "pro3d_lib/modul_snimac", "Konstrukce_Modul": "S1", "Konstrukce_Snimac": typ,
                      "PLCdesk_Id": s.get("PLCdesk_Id") or ""}
        self.moduly_ext.append(m)
        self.box_extra(m["nazev"], [base[0] - self.o[0], base[1] - self.o[0], ys - 35, cy + 10, g["boc_top"], zp + 60])
        self.sn = {"typ": typ, "x": round(xs + self.o[0], 1), "paprsek_z": round(zp + 4 + 7.8 + self.o[2], 1), "PLCdesk_Id": s.get("PLCdesk_Id")}
        for v_ in m.get("varovani") or []:
            if "cíl z" not in v_:
                self.varovani.append(f"S1: {v_}")

    # -- výpočty pro smlouvu
    def _calc_rozhrani(self):
        g, c, p = self.geo, self.calc, self.p
        G = modul_ram.G
        m_prof = sum(RAM["profily"][m["kod"]]["Q_kg_m"] * m["L"] / 1000.0 for m in self.members)
        mR = c["geometrie"]["mR_kg"]
        m_tot = m_prof + 2 * mR + c["geometrie"]["mB_kg"] + 15.0 + 4 * 0.6
        self.odhady.add("hmotnost pohonu 15 kg ODHAD (převodový motor bez katalogu); ložiska UCF 0,6 kg (NSK)")
        nl = max(1, len(self.legs)) * 2
        Fz = (m_tot + p["m_kg"]) * G / nl
        acc = c.get("rozjezd") or {}
        Fx = (acc.get("F_zrychleni_N") or 0.0) / nl
        Fy = 0.0
        if getattr(self, "vyh", None):
            Fy = math.pi / 4 * self.moduly_ext[0]["rozhrani"]["valec"]["prumer"] ** 2 * modul_valec.TLAK_MAX / nl
        self.hmotnost = {"profily_kg": round(m_prof, 2), "bubny_kg": round(2 * mR, 2), "pas_kg": round(c["geometrie"]["mB_kg"], 2),
                         "pohon_kg_ODHAD": 15.0, "celkem_kg": round(m_tot, 1), "zbozi_kg": p["m_kg"]}
        self.sily = {"na_stojinu_svisle_N": round(Fz, 1), "na_stojinu_podelne_N": round(Fx, 1), "na_stojinu_pricne_N": round(Fy, 1),
                     "stojin": nl, "pozn": "rovnoměrně na všechny stojiny (ODHAD); podélně = zrychlení zboží + pásu + bubnů při rozjezdu "
                                           "(dopravnik_calc rozjezd, jen s rampou); příčně = síla vyhazovače při 10 bar / počet stojin; "
                                           "tah pásu je vnitřní síla dopravníku (rám N1 ho nenese)"}

    def plochy_pro_moduly(self):
        """Volné úseky drážek bočnic (``Ram.plochy``) — kam smí S1 / P1 šroubovat (matice T s pružinou do hotového rámu)."""
        out = []
        for f in self.plochy():
            if f["role"] != "bocnice":
                continue
            n = f["normala"]
            kde = "horní líc (S1 na držáku, odrazka)" if n[2] > 0.5 else ("spodní líc (stojiny / úhelníky)" if n[2] < -0.5 else
                                                                         ("vnější líc (konzola P1, držáky)" if abs(n[1]) > 0.5 and
                                                                          (f["osa_od"][1] - self.o[1]) * n[1] > 0 else "vnitřní líc (ložiskové desky)"))
            out.append(dict(f, kde=kde))
        return out

    def rozhrani(self):
        g, c = self.geo, self.calc
        ox, oy, oz = self.o
        roz = {
            "format": "plcdesk-pro-modul", "modul": "D1", "verze": 1, "id": self.ident, "generator": GEN, "nazev": self.nazev,
            "souradnice": "globální: x = směr dopravy (vratný buben → hnací), y šířka, z nahoru; počátek D1 = osa vratného bubnu, "
                          "střed pásu, podlaha",
            "pocatek": r3(self.o),
            "pas": {"H_horni_plocha": round(g["H"] + oz, 2), "osa": {"od": r3(self.g(0, 0, g["H"])), "do": r3(self.g(g["L"], 0, g["H"])),
                                                                    "smer": [1, 0, 0]},
                    "L_osova": g["L"], "b0": g["b0"], "t": g["t"], "v_m_s": self.p["v"], "pas": self.p["pas"],
                    "delka_pasu_mm": round(c["geometrie"]["Lg_mm"], 1), "napinani_X_mm": g["X"]},
            "bubny": {"D": g["D"], "delka": g["b"], "kuzelovitost_h": g["h"], "hridel_d": g["d"], "lozisko": g["ucf"],
                      "osa_vratny": r3(self.g(0, 0, g["zax"])), "osa_hnaci": r3(self.g(g["L"], 0, g["zax"])), "pohon_strana": "+Y"},
            "vypocet": {"FU_N": round(c["FU_N"], 1), "F1_N": round(c["F1_N"], 1), "F2_N": round(c["F2_N"], 1),
                        "kontrola_pasu": c["kontrola_pasu"], "buben": {k: c["buben"][k] for k in ("dA_min_tah_mm", "d_min_pasu_mm", "D_zvoleny_mm", "vyhovuje")},
                        "PA_kW": round(c["vykon"]["PA_kW"], 4), "PM_kW": round(c["vykon"]["PM_kW"], 4), "motor_kW": c["vykon"]["motor_kW"],
                        "M_buben_Nm": round(c["moment"]["M_buben_Nm"], 2), "n_buben_1_min": round(c["moment"]["n_buben_1_min"], 1),
                        "prevod_i": round(c["moment"]["prevod_i"], 1), "hridele": c["hridele"], "bocnice": c.get("bocnice"),
                        "zdroj": "dopravnik_calc (Forbo 304 / 305)", "odhad": c["odhad"], "varovani": c["varovani"]},
            "plochy": self.plochy_pro_moduly(),
            "kotveni": {"druh": self.kotveni, "stojiny": self.kotvy,
                        "pozadavek_N1": ({"z_horni_lic_nosniku": round(self.z0_ram + oz, 2),
                                          "nosniky_x": sorted({k["nosnik_N1_x"] for k in self.kotvy}),
                                          "nosnik": "104080 naležato napříč (y), horní drážky x ± 20", "vrtani": "žádné (matice T s pružinou)"}
                                         if self.kotveni == "ram" else None)},
            "sily_do_ramu": self.sily, "hmotnost": self.hmotnost,
            "nebezpecna_mista": self.zony,
            "kabel_motoru": {"PLCdesk_Id": self.pohon_id, "zacatek": r3(self.kabel["zacatek"]), "smer": self.kabel["smer"],
                             "konec": r3(self.kabel["path"][-1]["line"][1]), "smer_konce": spojky_el.smer_konce(self.kabel["path"], self.kabel["smer"]),
                             "D": self.p["kabel_D"],
                             "R_min": self.kabel["R"], "delka_vyvodu_mm": self.kabel["delka"], "druh": "silový — oddělit od signálových tras",
                             "pozn": "poloha svorkovnice motoru ODHAD (zástupný motor)"},
            "vyhazovac": getattr(self, "vyh", None), "snimac": getattr(self, "sn", None),
            "klic": self.klic_vysledky,
            "rezaci_seznam": self._rez(),
            "spojovaci_material": self._bom(),
            "odhady": sorted(self.odhady), "varovani": self.varovani, "chyby": self.chyby, "zdroje": sorted(self.zdroje),
        }
        return roz

    def zpetna_vazba(self) -> dict | None:
        """Zpětná vazba do PLCdesk (``plcdesk-cad-feedback`` v1 — jen sepsat): zdvih vyhazovače nestačí na šířku pásu."""
        v = getattr(self, "vyh", None)
        if not v or v["zdvih"] >= v["zdvih_potreba"]:
            return None
        return {"format": "plcdesk-cad-feedback", "version": 1, "source": GEN, "issues": [{
            "kind": "part_mismatch", "severity": "warning", "parts": [v["PLCdesk_Id"]] if v.get("PLCdesk_Id") else [],
            "message": f"vyhazovač {v['tag']}: zdvih {v['zdvih']} mm nestačí na shoz dílu přes pás šířky {self.geo['b0']:g} mm "
                       f"(potřeba ≥ {v['zdvih_potreba']} mm nebo vyhazovací lopatka)",
            "measured": {"what": "zdvih válce", "value": v["zdvih"], "unit": "mm", "source": "modul D1 (geometrie kódem)"},
            "required": {"what": "zdvih válce", "min": v["zdvih_potreba"], "unit": "mm"}}]}

    def _rez(self):
        rez = {}
        for m in self.members:
            k = (m["kod"], round(m["L"], 1), "; ".join(sorted(set(m["opr"]))) or "bez opracování", m["role"])
            rez.setdefault(k, []).append(m["nazev"])
        return [{"profil": k[0], "delka_mm": k[1], "kusu": len(v), "opracovani": k[2], "role": k[3], "oznaceni": v} for k, v in sorted(rez.items())]

    def plan(self):
        return {"typ": "D1 pásový dopravník", "tag": self.ident, "nazev": self.nazev, "dily": list(self.dily.values()),
                "instance": self.inst, "telesa": self.tel, "kabely": self.kab, "skupiny": [],
                "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "D1", "PLCdesk_Id": f"asm:D1-{self.ident}",
                          "PLCdesk_Device": self.ident}}


# --- veřejné funkce ------------------------------------------------------------------------------------------------------
def _uniq(dily):
    seen, out = set(), []
    for s in dily:
        if s["key"] not in seen:
            seen.add(s["key"])
            out.append(s)
    return out


def dopravnik(vst: dict | None = None, origin=(0.0, 0.0, 0.0), kotveni="ram", z_ramu=None, s_moduly=True) -> Dopravnik:
    vst = vst or {}
    par = dict(vst.get("popis") or {})
    par["_ze_zadani"] = tuple(par)
    if vst.get("rampS"):
        par["t_rampa_s"] = vst["rampS"]
    vy = (vst.get("vyhazovace") or [None])[0] if s_moduly else None
    sn = None
    if s_moduly:
        sn = next((s for s in vst.get("snimace") or [] if s.get("typ")), None)
    d = Dopravnik(ident=vst.get("id") or "M1", nazev=f"D1 {vst.get('id', 'M1')} pásový dopravník", par=par, origin=origin,
                  kotveni=kotveni, z_ramu=z_ramu, vyhazovac=vy, snimac=sn, pohon_PLCdesk_Id=vst.get("pohon_PLCdesk_Id") or "",
                  pohon_typ=vst.get("pohon_typ") or "")
    return d.build()


def sestava(vst: dict | None = None) -> dict:
    """Zkušební sestava: rám N1 (bez desky, montážní nosníky 40 × 80 pod stojinami dopravníku) + D1 + S1 + P1. Rám je kratší
    než dopravník — pohon na hnacím konci přečnívá (motor visí pod úrovní horního líce rámu)."""
    pre = dopravnik(vst, origin=(0.0, 0.0, 0.0))                 # jen geometrie (poloha stojin, výška rámu, šířka)
    g = pre.geo
    xs = pre.legs
    W = 2 * (g["yb"] + 40 + RAM["uhelnik"]["rameno"] + 20) + 80
    W = math.ceil(W / 50.0) * 50.0
    D = (xs[-1] - xs[0]) + 360.0
    ox, oy = 180.0 - xs[0], W / 2
    d = dopravnik(vst, origin=(ox, oy, 0.0))
    zr = d.z0_ram
    nos = sorted({k["nosnik_N1_x"] for k in d.kotvy})
    m_leg = (d.hmotnost["celkem_kg"] + d.p["m_kg"]) / len(nos)
    ram = modul_ram.Ram(D=D, W=W, H=zr, deska=False, podpory="patky", zatizeni_kg=0.0, nosniky=nos,
                        moduly=[{"nazev": "D1 stojiny", "hmotnost_kg": m_leg, "pos": [x + 20, W / 2]} for x in nos],
                        ident="N1-D1", nazev=f"N1 rám {D:g} × {W:g} × {zr:g} pod dopravníkem D1").build()
    rp = ram.plan()
    mods = [rp["moduly"][0], d.plan()] + d.moduly_ext
    plan = {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": "Sestava_D1", "nazev": "Zkušební sestava N1 + D1 + S1 + P1",
            "dily": _uniq([s for m in mods for s in m["dily"]]), "moduly": mods, "snimky_prefix": "d1",
            "snimky": ["iso", "iso2", "celo", "shora", "bok"]}
    plan["rozhrani"] = d.rozhrani()
    plan["rozhrani_N1"] = ram.rozhrani()
    plan["rozhrani_P1"] = [m["rozhrani"] for m in d.moduly_ext if "rozhrani" in m]
    plan["zpetna_vazba"] = d.zpetna_vazba()
    plan["kontrola"] = {"chyby": d.chyby + ram.chyby, "varovani": d.varovani + ram.varovani, "srouby": d.srouby,
                        "vypocet_N1": ram.vypocet}
    return plan


def vzor_01() -> dict:
    root = Path(__file__).resolve().parents[4]
    p = root / ".claude" / "p3p" / "all" / "man_01.json"
    if p.is_file():
        return vstup_z_manifestu(json.loads(p.read_text(encoding="utf-8")))
    return {"id": "M1", "popis": {}, "snimace": [{"id": "S3", "typ": "WL12", "PLCdesk_Id": "-S3:sensor_optical"}],
            "vyhazovace": [{"id": "Y1", "tag": "-Y1", "norma": "ISO 15552", "prumer": 32, "zdvih": 100, "PLCdesk_Id": "-Y1:cylinder"}]}


def write_rozhrani(plan: dict, folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    r = plan["rozhrani"]
    out = []
    p = folder / f"D1_{r['id']}.json"
    p.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    out.append(str(p))
    if plan.get("rozhrani_N1"):
        q = folder / f"N1_{plan['rozhrani_N1']['id']}.json"
        q.write_text(json.dumps(plan["rozhrani_N1"], ensure_ascii=False, indent=1), encoding="utf-8")
        out.append(str(q))
    for r1 in plan.get("rozhrani_P1") or []:
        q = folder / f"P1_{r1['tag'].lstrip('-')}.json"
        q.write_text(json.dumps(r1, ensure_ascii=False, indent=1), encoding="utf-8")
        out.append(str(q))
    if plan.get("zpetna_vazba"):
        q = folder / "PLCdesk_CAD_feedback_D1.json"
        q.write_text(json.dumps(plan["zpetna_vazba"], ensure_ascii=False, indent=1), encoding="utf-8")
        out.append(str(q))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul D1 — pásový dopravník (plán; volitelně FreeCAD + kontroly)")
    ap.add_argument("--manifest", help="PLCdesk_CAD.json (bez = vzor 01)")
    ap.add_argument("--dev", help="zařízení dopravníku (výchozí první Motor / Vfd s popisem pásu)")
    ap.add_argument("--plan")
    ap.add_argument("--rozhrani")
    ap.add_argument("--fc")
    ap.add_argument("--slot", default=SLOT)
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    vst = vstup_z_manifestu(json.loads(Path(a.manifest).read_text(encoding="utf-8")), a.dev) if a.manifest else vzor_01()
    plan = sestava(vst)
    r = plan["rozhrani"]
    print(f"{r['nazev']}: pás H {r['pas']['H_horni_plocha']}, L {r['pas']['L_osova']:g}, b0 {r['pas']['b0']:g}, buben Ø{r['bubny']['D']:g}, "
          f"PM {r['vypocet']['PM_kW']} kW (motor {r['vypocet']['motor_kW']} kW), M {r['vypocet']['M_buben_Nm']} N·m")
    for t in plan["kontrola"]["chyby"]:
        print("  CHYBA:", t)
    for t in plan["kontrola"]["varovani"]:
        print("  !", t)
    if a.plan:
        Path(a.plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.rozhrani:
        print("\n".join(write_rozhrani(plan, Path(a.rozhrani))))
    if a.fc:
        write_rozhrani(plan, Path(a.fc))
        res = modul_ram.build_fc(plan, Path(a.fc), slot=a.slot)
        print(json.dumps(res.get("souhrn", res), ensure_ascii=False, indent=1)[:6000])
        return 0 if res.get("ok") else 1
    return 0 if not plan["kontrola"]["chyby"] else 1


if __name__ == "__main__":
    sys.exit(main())
