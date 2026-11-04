"""Moduly P3 (rozváděče na liště / ventilový ostrov), P2 (úprava vzduchu + bezpečnostní odvzdušňovací ventil) a P4 (hadice
a šroubení ostrov ↔ válec) — čistý Python: plán; FreeCAD: ``fc_lib.py`` (zkušební deska ``Lavice_P234`` přes ``bench``).

Data: ``data/pneu_ostrov.json`` (zdroje = datové listy Festo 574371 / 541267 / 529184 / 562580, rozteč lišty RS). Listy
ftp.festo.com rozměrové výkresy NEMAJÍ → obrysy ventilu, lišty a jednotek MS6 jsou ZÁSTUPNÉ (oranžově, ODHAD); ze zdroje
jsou jen rozhraní: závity portů, velikost ventilu 14, rozteč lišty 16, rastr MS6 62, průtoky, funkce. Šroubení / hadice
spojkou V1 (``spojky_pneu``), konektory V2 (``spojky_el``), šrouby V4 (``spojky_mech``), trasy hadic skillem
kabelaz-a-hadice (``scripts/trasa.py`` — zaoblení poloměrem, délky, rezerva).

**Smlouva rozhraní** (``P3_<id>.json``, ``format: plcdesk-pro-modul``; stejná struktura jako P1_<tag>.json):

* P3 bere z manifestu ``valve_solenoid`` řádky a vazby ``actuates`` (``z_manifestu``) — ventil × válec × kód;
  dává ``pripojky`` (port 2 / 4 každého ventilu: seat, osa n, ústí, osa ústí, zasunutí, šroubení, hadice, ``cil`` =
  „4 → zadní (vysunutí) / 2 → přední (zasunutí)“ a ``valec``), ``napajeni`` (port P lišty G1/4 + šroubení), ``odfuky``,
  ``elektro`` (zásuvka M8 na ventil — začátek kabelu k rozvaděči přes V2), ``kotveni`` (matice T), obálku, hmotnost.
* P2 bere parametr sestavy (výchozí MS6-EM1 → MS6-LFR → MS6-SV-E; v kusovníku jádra zatím řádek není → zpětná vazba);
  dává ``privod`` (G1/2 na −x uzávěru — z rozvodu dílny, mimo modul), ``vystup_P`` (ústí QS-G1/4-10 na redukci),
  ``elektro`` (Sub-D + M8 SV, jen rozhraní), ``bezpecnost`` = NÁVRH ke schválení (EN ISO 13849-1), zóny ovládání.
* P4 spojí ústí ↔ ústí: hadice začíná / končí uvnitř šroubení (hloubka zasunutí z listu — ``fc_scan.in_fitting``),
  poloměr = průtokově přípustný (jinak minimum výrobce), délka + rezerva do kusovníku a zpětné vazby.

CLI: ``python -m plc_studio.pro3d_lib.modul_ostrov [--manifest PLCdesk_CAD.json] [--rozhrani SLOŽKA] [--fc SLOŽKA]``
(bez --manifest = zkušební deska P2 + P3 se 2 ventily + 2 válce P1 + hadice P4)."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from functools import lru_cache
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import modul_valec, spojky_el, spojky_mech, spojky_pneu  # noqa: E402

HERE = Path(__file__).resolve().parent
D = json.loads((HERE / "data" / "pneu_ostrov.json").read_text(encoding="utf-8"))
SRC = D["zdroje"]
GEN = "pro3d_lib/modul_ostrov"
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
T_DESKA = 8.0           # ODHAD — montážní deska ostrova / konzola úpravy vzduchu S235
M_PROFIL = "M6"
ORANZ = "zástupný"


def _src(k: str) -> str:
    return SRC.get(k, k)


@lru_cache(maxsize=None)
def trasa_mod():
    p = Path(os.environ.get("PRO3D_KABELAZ") or Path.home() / ".claude" / "skills" / "kabelaz-a-hadice") / "scripts"
    if not (p / "trasa.py").is_file():
        raise RuntimeError("skill kabelaz-a-hadice (scripts/trasa.py) není nainstalován — trasy P4 nelze spočítat")
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
    import trasa  # type: ignore
    return trasa


def _lib(key, body, nazev, zdroj, pozn, typ="dil", zastupny=True, material=""):
    return {"key": key, "gen": "lib_body", "body": body, "nazev": nazev, "zdroj": [zdroj] if isinstance(zdroj, str) else zdroj,
            "detail": "obálka" if zastupny else "tvar", "typ": typ, "material": material, "poznamka": pozn, "zastupny": zastupny}


def _cz(x, y, r, z0, z1):
    return {"cyl": {"p": [x, y, z0], "d": [0, 0, 1], "r": r, "h": z1 - z0}}


def _cx(x0, x1, y, z, r):
    return {"cyl": {"p": [x0, y, z], "d": [1, 0, 0], "r": r, "h": x1 - x0}}


def _cy(x, y0, y1, z, r):
    return {"cyl": {"p": [x, y0, z], "d": [0, 1, 0], "r": r, "h": y1 - y0}}


def _port_hole(th: str) -> float:
    """Díra portu v zástupném těle: Ø d − 1,2 (jako EE_hole pro3d_parts — závit šroubení v ní = povolená díra)."""
    return spojky_pneu.zavit(th)["d"] - 1.2


class _Mod:
    """Sběr dílů / instancí / těles / hadic jednoho modulu ve formátu ``fc_lib``."""

    def __init__(self):
        self.dily, self.inst, self.tel, self.kab, self.text, self.odh = [], [], [], [], [], []

    def dil(self, spec):
        if spec["key"] not in {d["key"] for d in self.dily}:
            self.dily.append(spec)

    def put(self, r_):
        if not r_["ok"]:
            raise ValueError(r_["text"])
        for s in r_["dily"]:
            self.dil(s)
        self.inst.extend(r_["instance"])
        self.text.append(r_["text"])

    def link(self, spec, pos, rot=I3, druh="dil", mount=None, props=None):
        self.dil(spec)
        self.inst.append({"model": spec["key"], "pos": list(pos), "rot": rot, "druh": druh, "mount": mount, "props": props or {}})
        return len(self.inst) - 1

    def sroubeni(self, prt: dict, s_zavitem=True):
        r_ = spojky_pneu.port(prt, s_zavitem=s_zavitem)
        self.dil(r_["dil"])
        self.inst.append(dict(r_["instance"], druh="sroubeni"))
        return r_, len(self.inst) - 1

    def sroub_osa(self, m: str, hlava, smer, t_upinany, t_zavit, mat="hlinik"):
        """Šroub ISO 4762 s dosedem hlavy v ``hlava`` a dříkem ve směru ``smer`` do slepého závitu."""
        dl = spojky_mech.delka_do_zavitu(m, t_upinany, t_zavit, mat, pruchozi=False)
        if not dl["ok"]:
            raise ValueError(dl["text"])
        sp = spojky_mech.spec_sroub(m, dl["l"])
        self.dil(sp)
        self.inst.append({"model": sp["key"], "pos": list(hlava), "rot": spojky_mech.rot_z_na([-c for c in smer]), "druh": "sroub"})
        self.text.append(dl["text"])
        return dl


# --- P3 — rozváděče na liště ------------------------------------------------------------------------------------------

def spec_ventil(obj: str = "574371") -> dict:
    v = D["ventily"][obj]
    ob, pp, sr = v["obalka"], v["porty_poloha"], v["sroub"]
    w, L, H = v["velikost"], ob["delka"], ob["vyska"]
    dk = spojky_mech.NORM["ISO4762"]["rady"][sr["m"]]["dk"]
    cut = []
    for y in (pp["y4"], pp["y2"]):
        cut.append(_cz(0, y, _port_hole("G1/8") / 2, H - pp["hloubka"], H + 1))
    for y in (-sr["y"], sr["y"]):
        cut.append(_cz(0, y, spojky_mech.otvor_vule(sr["m"]) / 2, -1, H + 1))
        cut.append(_cz(0, y, (dk + 1) / 2, sr["dno_zahloubeni"], H + 1))
    body = {"add": [{"box": [-w / 2, w / 2, -L / 2, L / 2, 0, H]}], "cut": cut}
    return _lib(f"Ventil_{v['kod'].replace('/', '-')}", body, f"Rozváděč Festo {v['kod']} ({v['obj']}) — zástupná obálka",
                _src(v["zdroj"]), f"šířka {w:g} (velikost ventilu) a porty G1/8 z listu; délka {L:g}, výška {H:g}, poloha portů 2/4 "
                f"a šroubů {sr['m']} ODHAD (výkres nedostupný)", material="hliník / PA")


def spec_lista(n: int) -> dict:
    li = D["lista"]
    ob = li["obalka"]
    Lr = 2 * ob["konec"] + n * li["roztec"]
    W, H, hl = ob["sirka"], ob["vyska"], li["port_hloubka"]
    cut = [_cx(-1, hl, li["port_P_y"], H / 2, _port_hole("G1/4") / 2)]
    cut += [_cx(Lr - hl, Lr + 1, y, H / 2, _port_hole("G1/4") / 2) for y in li["porty_R_y"]]
    sm = li["sroub"]["m"]
    for x in (ob["konec"] / 2, Lr - ob["konec"] / 2):
        for y in (-li["sroub"]["y"], li["sroub"]["y"]):
            cut.append(_cz(x, y, spojky_mech.otvor_vule(sm) / 2, -1, H + 1))
    m3 = D["ventily"]["574371"]["sroub"]
    for i in range(n):
        x = ob["konec"] + (i + 0.5) * li["roztec"]
        for y in (-m3["y"], m3["y"]):
            cut.append(_cz(x, y, spojky_mech.zavit_otvor(m3["m"]) / 2, H - 10.0, H + 1))
    body = {"add": [{"box": [0, Lr, -W / 2, W / 2, 0, H]}], "cut": cut}
    spec = _lib(f"Lista_VABM_L1_14_{n}", body, f"{li['nazev']} — {n} míst, zástupná obálka", [_src("RS_VABM_14"), _src("RS_VABM_G14")],
                f"rozteč {li['roztec']:g} a porty G1/4 ze zdroje; obrys {Lr:g} × {W:g} × {H:g}, poloha portů a šroubů ODHAD",
                material="hliník")
    return dict(spec, _L=Lr, _H=H)


def spec_tlumic(kod: str, D_, L, zavit, th) -> dict:
    d = th if isinstance(th, float) else spojky_pneu.zavit(th)["d"]
    body = {"add": [{"cyl": {"p": [0, 0, -zavit], "d": [0, 0, 1], "r": d / 2, "h": zavit}},
                    {"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": D_ / 2, "h": L}}]}
    return _lib(kod, body, kod.replace("_", " "), "ODHAD — typ doplní projektant", "obálka ODHAD", typ="sroubeni",
                material="PE / mosaz")


def ostrov(ident: str, ventily: list[dict], x0: float, z_profil: float = 40.0, obj: str = "574371", lista_id: str = "") -> dict:
    """P3: montážní deska na profilu (2 × M6 matice T), lišta s ``len(ventily)`` místy, ventily, QS-G1/8-6 na 2 / 4,
    zásuvky M8, šroubení P a tlumiče odfuků. ``ventily`` = [{tag, valec}] (pořadí na liště). Globální souřadnice:
    profil podél X, horní plocha ``z_profil``; deska začíná v ``x0``."""
    v, li = D["ventily"][obj], D["lista"]
    n = len(ventily)
    m = _Mod()
    lista = spec_lista(n)
    Lr, Hr = lista["_L"], lista["_H"]
    W = li["obalka"]["sirka"]
    xr = x0 + 60.0                                       # ODHAD — šroubení P a jeho zóna nad deskou, šrouby desky mimo zónu
    zd0, zd1 = z_profil, z_profil + T_DESKA
    xd1 = xr + Lr + 30.0
    cut = []
    for x in (x0 + 8.0, xd1 - 8.0):
        cut.append(_cz(x, 0, spojky_mech.otvor_vule(M_PROFIL) / 2, zd0 - 1, zd1 + 1))
        m.put(spojky_mech.sroub_do_drazky(M_PROFIL, x, 0.0, zd0, T_DESKA))
    sm = li["sroub"]["m"]
    for x in (xr + li["obalka"]["konec"] / 2, xr + Lr - li["obalka"]["konec"] / 2):
        for y in (-li["sroub"]["y"], li["sroub"]["y"]):
            cut.append(_cz(x, y, spojky_mech.zavit_otvor(sm) / 2, zd0 - 1, zd1 + 1))
            r_ = spojky_mech.sroub_do_zavitu(sm, [x, y, zd1 + Hr], True, Hr, T_DESKA, "ocel")
            m.put(r_)
    m.tel.append({"name": "Deska", "label": f"Montážní deska ostrova {ident} (S235 t {T_DESKA:g}, ODHAD)",
                  "body": {"add": [{"box": [x0, xd1, -W / 2 - 10, W / 2 + 10, zd0, zd1]}], "cut": cut},
                  "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel S235 (ODHAD)",
                            "Konstrukce_Poznamka": f"tloušťka a obrys ODHAD; závity {sm} pro lištu, 2 × {M_PROFIL} do drážky profilu"}})
    m.link(lista, [xr, 0, zd1], druh="lista", props={"PLCdesk_Id": lista_id or f"asm:P3{ident}:manifold"})   # lista_id = řádek kusovníku valve_manifold
    zt = zd1 + Hr
    # port P (napájení) a odfuky
    pP, jP = m.sroubeni({"id": f"{ident}.P", "seat": [xr, li["port_P_y"], zd1 + Hr / 2], "n": [-1, 0, 0], "fitting": "QS-G1/4-10",
                         "hose": "festo_PUN_10x1.5", "tower": [0, 0, 1]})
    m.tel.append({"name": "Prostor_hadice_P", "label": f"Pomocný prostor nasunutí hadice P {ident}", "body": pP["zona"],
                  "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "hadice"}, "vyjimka": [f"inst:{jP}"]})
    tl = li["tlumic_G14"]
    sp_t = spec_tlumic("Tlumic_G1-4_ODHAD", tl["D"], tl["L"], tl["zavit"], "G1/4")
    for y in li["porty_R_y"]:
        m.link(sp_t, [xr + Lr, y, zd1 + Hr / 2], spojky_mech.rot_z_na([1, 0, 0]), druh="tlumic")
    # ventily
    sp_v = spec_ventil(obj)
    sr = v["sroub"]
    porty, elektro = [], []
    kon_t = v["konektor"]["typ"]
    sp_k = {"key": f"Zasuvka_{kon_t}", "gen": "lib_body", "zastupny": True, "typ": "dil", "detail": "obálka", "material": "TPU / mosaz",
            "body": spojky_el.konektor(kon_t, [0, 0, 0], [1, 0, 0], [0, 1, 0])["body"],
            "nazev": spojky_el.konektor_data(kon_t)["nazev"] + " (zástupná obálka)", "zdroj": [],
            "poznamka": spojky_el.konektor_data(kon_t)["zdroj_popis"]}
    for i, vt in enumerate(ventily):
        xc = xr + li["obalka"]["konec"] + (i + 0.5) * li["roztec"]
        jv = m.link(sp_v, [xc, 0, zt], druh=f"ventil_{i + 1}", props={"PLCdesk_Id": f"{vt['tag']}:valve_solenoid"})
        for y in (-sr["y"], sr["y"]):
            m.sroub_osa(sr["m"], [xc, y, zt + sr["dno_zahloubeni"]], [0, 0, -1], sr["dno_zahloubeni"], 10.0, "hlinik")
        H = v["obalka"]["vyska"]
        for nm, y in (("4", v["porty_poloha"]["y4"]), ("2", v["porty_poloha"]["y2"])):
            r_, js = m.sroubeni({"id": f"{vt['tag']}.{nm}", "seat": [xc, y, zt + H], "n": [0, 0, 1], "fitting": "QS-G1/8-6",
                                 "hose": "festo_PUN_6x1", "tower": [1, 0, 0]})
            m.tel.append({"name": f"Prostor_hadice_{i + 1}_{nm}", "label": f"Pomocný prostor nasunutí hadice {vt['tag']} port {nm}",
                          "body": r_["zona"], "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "hadice"},
                          "vyjimka": [f"inst:{js}"]})
            h = r_["hadice"]
            porty.append({"id": f"{vt['tag']}.{nm}", "ventil": vt["tag"], "port": nm, "seat": r_["seat"], "n": r_["n"],
                          "thread": "G1/8", "fitting": "QS-G1/8-6", "hose": h["kod"], "usti": h["usti"], "osa_usti": r_["osa_usti"],
                          "zasun": h["zasun"], "D": h["D"], "R": h["R"], "R_min": h["R_min"], "valec": vt.get("valec"),
                          "cil": "zadni" if nm == "4" else "predni",
                          "pozn": "4 → zadní přípojka (vysunutí), 2 → přední (zasunutí) — ODHAD podle zapojení 5/2 monostabilní"})
        # zásuvka M8 na čele u cívky, kabel nahoru; zóna prstů omezena na polovinu rozteče (ODHAD)
        start = [xc, v["obalka"]["delka"] / 2, zt + H / 2]
        kon = spojky_el.konektor(kon_t, start, [0, 1, 0], [0, 0, 1])
        jk = m.link(sp_k, start, [[0, -1, 0], [1, 0, 0], [0, 0, 1]], druh="konektor",
                    mount="zavit")
        zr = min(kon["zona_r"], li["roztec"] / 2)
        m.tel.append({"name": f"Prostor_konektoru_{i + 1}", "label": f"Pomocný prostor nasunutí zásuvky {vt['tag']} (r {zr:g}, ODHAD)",
                      "body": {"add": [{"cyl": {"p": start, "d": [0, 1, 0], "r": zr, "h": kon["zona_h"]}}]},
                      "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "konektor",
                                "Konstrukce_Poznamka": "zóna prstů omezena na polovinu rozteče lišty 16 mm (ODHAD) — u ostrova zapojovat "
                                                       "postupně nebo použít vícepólové připojení"},
                      "vyjimka": [f"inst:{jv}", f"inst:{jk}"]})
        m.kab.append({"name": f"Kabel_{i + 1}", "label": f"Kabel cívky {vt['tag']} M8 (začátek, R {kon['kabel']['R']:g})",
                      "r": kon["kabel"]["r"], "path": kon["kabel"]["path"],
                      "props": {"Konstrukce_Typ": "kabel", "Konstrukce_Druh": "signal", "Kabel_R_min": kon["kabel"]["R"]}})
        elektro.append({"signal": f"{vt['tag']} cívka 14", "konektor": kon_t, "zacatek": kon["kabel"]["path"][-1]["line"][1],
                        "smer": [0, 0, 1], "R": kon["kabel"]["R"], "k": "rozvaděč (V2)"})
    m.odh += [f"obrys ventilu {v['kod']} {v['velikost']:g} × {v['obalka']['delka']:g} × {v['obalka']['vyska']:g} — šířka ze zdroje, zbytek ODHAD",
              f"lišta {Lr:g} × {W:g} × {Hr:g}, poloha portů P / 3 / 5 a šroubů {sm} ODHAD (rozteč {li['roztec']:g} ze zdroje)",
              "poloha portů 2 / 4 na horní ploše ventilu ODHAD", "zásuvka M8 na čele ventilu a zóna prstů r 8 (polovina rozteče) ODHAD",
              "tlumiče G1/4 na odfucích lišty — obálka a typ ODHAD", f"montážní deska S235 t {T_DESKA:g} ODHAD"]
    hm = round(n * v["hmotnost_g"] / 1000.0, 3)
    rozhrani = {"format": "plcdesk-pro-modul", "modul": "P3", "verze": 1, "id": ident, "generator": GEN,
                "ventily": [dict(vt, kod=v["kod"], obj=v["obj"], prutok_l_min=v["prutok_l_min"]) for vt in ventily],
                "lista": {"nazev": li["nazev"], "mist": n, "roztec": li["roztec"], "pocatek": [xr, 0, zd1], "delka": Lr},
                "napajeni": {"id": f"{ident}.P", "seat": pP["seat"], "n": pP["n"], "thread": "G1/4", "fitting": "QS-G1/4-10",
                             "hose": "festo_PUN_10x1.5", "usti": pP["usti"], "osa_usti": pP["osa_usti"], "zasun": pP["hadice"]["zasun"],
                             "D": pP["hadice"]["D"], "R": pP["hadice"]["R"], "R_min": pP["hadice"]["R_min"]},
                "odfuky": [{"port": p_, "seat": [xr + Lr, y, zd1 + Hr / 2], "thread": "G1/4", "tlumic": "ODHAD"}
                           for p_, y in zip(("3", "5"), li["porty_R_y"])],
                "pripojky": porty, "elektro": elektro,
                "kotveni": [{"pos": [x, 0.0, zd0], "osa": [0, 0, -1], "M": M_PROFIL, "druh": "matice T drážka 40/8"} for x in (x0 + 8.0, xd1 - 8.0)],
                "obalka": [x0, -W / 2 - 10, zd0, xd1, W / 2 + 50, zt + v["obalka"]["vyska"] + 30],
                "hmotnost_kg": {"ventily": hm, "pozn": "lišta a deska bez údaje (ODHAD chybí)"},
                "odhady": m.odh, "zdroje": sorted({_src("FESTO_574371"), _src("RS_VABM_14"), _src("RS_VABM_G14")})}
    return {"typ": f"P3 {n} × {v['kod']}", "tag": ident, "nazev": f"P3 {ident} — {n} × {v['kod']} na liště", "dily": m.dily,
            "instance": m.inst, "telesa": m.tel, "kabely": m.kab, "skupiny": [],
            "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "P3", "PLCdesk_Id": f"asm:P3{ident}"},
            "rozhrani": rozhrani, "kontrola": {"srouby": m.text}, "varovani": []}


# --- P2 — úprava vzduchu ------------------------------------------------------------------------------------------------

def uprava(ident: str, x0: float, z_profil: float = 40.0, sv: bool = True, ids: dict | None = None) -> dict:
    """P2: konzola (úhelník) na profilu, MS6-EM1 → MS6-LFR → MS6-SV-E v ose X (proud +X), nádobka LFR dolů; výstup
    SV přes redukci G1/2 → G1/4 + QS-G1/4-10; tlumič G1 na odfuk 3 SV. Bezpečnostní ventil = NÁVRH ke schválení.
    ``sv=False`` (stroj bez modulu bezpečnosti — manifest ``safety`` = null, rozhodnutí uživatele 2026-11-04): jen uzávěr
    a filtr-regulátor, výstup z LFR. ``ids`` = PLCdesk_Id jednotek podle řádků kusovníku ({"EM1": "-QM1:air_shutoff", …})."""
    u = D["uprava"]
    pr = D["prostor"]
    m = _Mod()
    g = u["rastr"]
    dep = u["hloubka"]
    jed = [j for j in u["jednotky"] if sv or j["id"] != "SV"]
    nj = len(jed)
    ids = ids or {}
    kz = u["konzola"]
    t = kz["t"]
    yb = 20.0                                             # zadní líc jednotek = přední líc svislé stěny konzoly
    yc = yb - dep / 2
    lfr = jed[1]["obalka"]
    z_ax = z_profil + t + lfr["nadobka_h"] + lfr["pod"] + 45.0   # ODHAD — volno pod nádobkou pro odvod kondenzátu
    x1 = x0 + nj * g
    ztop = z_profil + kz["vyska"]
    if ztop < z_ax + 60:
        ztop = z_ax + 60
    # konzola: patka na profilu + svislá stěna
    sj = u["sroub_jednotky"]
    cut = []
    for x in (x0 + 10.0, x1 - 10.0):
        cut.append(_cz(x, 0, spojky_mech.otvor_vule(M_PROFIL) / 2, z_profil - 1, z_profil + t + 1))
        m.put(spojky_mech.sroub_do_drazky(M_PROFIL, x, 0.0, z_profil, t))
    for i in range(nj):
        xc = x0 + (i + 0.5) * g
        for dx in (-15.0, 15.0):
            cut.append(_cy(xc + dx, yb - 1, yb + t + 1, z_ax, spojky_mech.otvor_vule(sj["m"]) / 2))
            m.sroub_osa(sj["m"], [xc + dx, yb + t, z_ax], [0, -1, 0], t, sj["zavit_hloubka"], "hlinik")
    m.tel.append({"name": "Konzola", "label": f"Konzola úpravy vzduchu {ident} (úhelník S235 t {t:g}, ODHAD)",
                  "body": {"add": [{"box": [x0, x1, -20.0, yb + t, z_profil, z_profil + t]},
                                   {"box": [x0, x1, yb, yb + t, z_profil, ztop]}], "cut": cut},
                  "props": {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel S235 (ODHAD)",
                            "Konstrukce_Poznamka": kz["_pozn"] + f"; 2 × {M_PROFIL} do drážky profilu, {2 * nj} × {sj['m']} do jednotek"}})
    tels = []
    for i, j in enumerate(jed):
        ob = j["obalka"]
        xa, xb = x0 + i * g, x0 + (i + 1) * g
        xc = (xa + xb) / 2
        add = [{"box": [xa, xb, yb - dep, yb, z_ax - ob["pod"], z_ax + ob["nad"]]}]
        cut = [_cy(xc + dx, yb - sj["zavit_hloubka"], yb + 1, z_ax, spojky_mech.zavit_otvor(sj["m"]) / 2) for dx in (-15.0, 15.0)]
        if j["id"] == "LFR":
            add.append(_cz(xc, yc, ob["nadobka_D"] / 2, z_ax - ob["pod"] - ob["nadobka_h"], z_ax - ob["pod"]))
            add.append(_cz(xc, yc, ob["knoflik_D"] / 2, z_ax + ob["nad"], z_ax + ob["nad"] + ob["knoflik_h"]))
        if i == nj - 1:                                  # výstup G1/2 posledního článku (SV, bez SV = LFR)
            hl = u["port_hloubka"]
            cut.append(_cx(xb - hl, xb + 1, yc, z_ax, _port_hole("G1/2") / 2))
        if j["id"] == "SV":
            hl = u["port_hloubka"]
            cut.append(_cz(xc, yc, (u["zavit_G1_d"] - 1.2) / 2, z_ax - ob["pod"] - 1, z_ax - ob["pod"] + hl))
        body = {"add": add, "cut": cut}
        bez = j.get("bezpecnost")
        sp = _lib(f"MS6_{j['id']}_{j['obj']}", body, f"Festo {j['kod']} ({j['obj']}) — zástupná obálka", _src(j["zdroj"]),
                  f"rastr {g:g} a porty {', '.join(f'{k} {v}' for k, v in j['porty'].items())} ze zdroje; hloubka {dep:g} a výšky ODHAD"
                  + (f"; {bez}" if bez else ""), material="hliník tlakově litý")
        props = {"PLCdesk_Id": ids.get(j["id"]) or f"asm:P2{ident}:{j['id']}", "Konstrukce_Funkce": j["funkce"]}
        if bez:
            props["Konstrukce_Bezpecnost"] = bez
        tels.append(m.link(sp, [0, 0, 0], druh=j["id"], props=props))
    # redukce + QS na výstupu SV, tlumič na odfuku 3
    re_ = u["redukce"]
    d14, d12 = spojky_pneu.zavit("G1/4")["d"], spojky_pneu.zavit("G1/2")["d"]
    sp_r = _lib("Redukce_G1-2_G1-4_ODHAD", {"add": [{"cyl": {"p": [0, 0, -re_["zavit_ven"]], "d": [0, 0, 1], "r": d12 / 2, "h": re_["zavit_ven"]}},
                                                    {"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": re_["D"] / 2, "h": re_["delka"]}}],
                                            "cut": [{"cyl": {"p": [0, 0, re_["delka"] - re_["zavit_dovnitr"]], "d": [0, 0, 1], "r": d14 / 2,
                                                             "h": re_["zavit_dovnitr"] + 1}}]},
                re_["nazev"], "ODHAD — typ doplní projektant", "obálka ODHAD; vnitřní závit G1/4 = Ø d (QS se jen dotýká)",
                typ="sroubeni", material="mosaz")
    seat_sv = [x1, yc, z_ax]
    m.link(sp_r, seat_sv, spojky_mech.rot_z_na([1, 0, 0]), druh="redukce")
    seat_qs = [x1 + re_["delka"], yc, z_ax]
    pO, jO = m.sroubeni({"id": f"{ident}.P_out", "seat": seat_qs, "n": [1, 0, 0], "fitting": "QS-G1/4-10", "hose": "festo_PUN_10x1.5",
                         "tower": [0, 0, 1]}, s_zavitem=True)
    m.tel.append({"name": "Prostor_hadice_vystup", "label": f"Pomocný prostor nasunutí hadice výstupu P {ident}", "body": pO["zona"],
                  "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "hadice"}, "vyjimka": [f"inst:{jO}"]})
    tl = u["tlumic_G1"]
    if sv:
        svo = jed[2]["obalka"]
        xsv = x0 + 2.5 * g
        m.link(spec_tlumic("Tlumic_G1_ODHAD", tl["D"], tl["L"], tl["zavit"], u["zavit_G1_d"]), [xsv, yc, z_ax - svo["pod"]],
               spojky_mech.rot_z_na([0, 0, -1]), druh="tlumic_SV")
    # zóny ovládání (ruka) — uzávěr čelem, knoflík regulátoru shora, odvod kondenzátu zespodu
    xe, xl = x0 + 0.5 * g, x0 + 1.5 * g
    em = jed[0]["obalka"]
    zones = [("Prostor_ovladani_uzaveru", f"Pomocný prostor ruky na uzávěru EM1 {ident} (ODHAD)",
              {"add": [{"box": [xe - g / 2 + 1, xe + g / 2 - 1, yb - dep - pr["ovladani_uzaver"]["hloubka"], yb - dep,
                                z_ax - em["pod"], z_ax + em["nad"]]}]}, [tels[0]]),
             ("Prostor_knofliku", f"Pomocný prostor ruky na knoflíku regulátoru {ident} (ODHAD)",
              {"add": [_cz(xl, yc, pr["ovladani_knoflik"]["D"] / 2, z_ax + lfr["nad"] + lfr["knoflik_h"],
                           z_ax + lfr["nad"] + lfr["knoflik_h"] + pr["ovladani_knoflik"]["h"])]}, [tels[1]]),
             ("Prostor_kondenzatu", f"Pomocný prostor odvodu kondenzátu {ident} (ODHAD)",
              {"add": [_cz(xl, yc, pr["ovladani_kondenzat"]["D"] / 2, z_ax - lfr["pod"] - lfr["nadobka_h"] - pr["ovladani_kondenzat"]["h"],
                           z_ax - lfr["pod"] - lfr["nadobka_h"])]}, [tels[1]])]
    for nm, lab, body, exc in zones:
        m.tel.append({"name": nm, "label": lab, "body": body, "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "ovladani"},
                      "vyjimka": [f"inst:{k}" for k in exc]})
    m.odh += ["obrysy MS6-EM1 / LFR / SV — rastr 62 ze zdroje, hloubka 62 a výšky ODHAD (výkres nedostupný)",
              "spojení jednotek modulovými spojkami MS6 nemodelováno (dotyk čel) — ODHAD",
              f"konzola S235 t {t:g}, výška {ztop - z_profil:g}, {2 * nj} × {sj['m']} do jednotek — ODHAD, tuhost neověřena",
              "redukce G1/2 → G1/4" + (" a tlumič G1" if sv else "") + " — typ a obálka ODHAD"]
    if sv:
        m.odh.append("poloha odfuku 3 SV (dole) ODHAD")
    m.odh += [
              jed[0]["uzamykatelny_pozn"], "zóny ovládání (ruka) ODHAD"]
    rozhrani = {"format": "plcdesk-pro-modul", "modul": "P2", "verze": 1, "id": ident, "generator": GEN,
                "jednotky": [{k: j.get(k) for k in ("id", "kod", "obj", "funkce", "porty", "prutok_l_min", "tlak_bar", "hmotnost_g")}
                             for j in jed],
                "privod": {"seat": [x0, yc, z_ax], "n": [-1, 0, 0], "thread": "G1/2",
                           "pozn": "přívod z rozvodu dílny (mimo modul); šroubení / rychlospojku doplní projektant"},
                "vystup_P": {"seat": seat_qs, "n": [1, 0, 0], "thread": "G1/4", "fitting": "QS-G1/4-10", "hose": "festo_PUN_10x1.5",
                             "usti": pO["usti"], "osa_usti": pO["osa_usti"], "zasun": pO["hadice"]["zasun"], "D": pO["hadice"]["D"],
                             "R": pO["hadice"]["R"], "R_min": pO["hadice"]["R_min"], "prutok_l_min": min(j["prutok_l_min"] for j in jed)},
                "elektro": [{"zarizeni": "SV", "rozhrani": jed[2]["elektro"], "pozn": "kabel nemodelován (Sub-D — data V2 chybí)"}] if sv else [],
                "uzaver": {"kod": jed[0]["kod"], "uzamykatelny": jed[0]["uzamykatelny"], "pozn": jed[0]["uzamykatelny_pozn"]},
                "bezpecnost": ({"zarizeni": jed[2]["kod"], "stav": "NÁVRH ke schválení", "text": jed[2]["bezpecnost"],
                                "zdroj": _src(jed[2]["zdroj"])} if sv else
                               {"zarizeni": None, "stav": "bez bezpečnostního ventilu — stroj nemá modul bezpečnosti (manifest safety = null)"}),
                "kotveni": [{"pos": [x, 0.0, z_profil], "osa": [0, 0, -1], "M": M_PROFIL, "druh": "matice T drážka 40/8"} for x in (x0 + 10.0, x1 - 10.0)],
                "obalka": [x0, yb - dep - 60, z_profil, x1 + re_["delka"] + 25, yb + t, ztop + 60],
                "hmotnost_kg": round(sum(j["hmotnost_g"] for j in jed) / 1000.0, 3), "odhady": m.odh,
                "zdroje": sorted({_src(j["zdroj"]) for j in jed})}
    mp = {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "P2", "PLCdesk_Id": f"asm:P2{ident}"}
    if sv:
        mp["Konstrukce_Bezpecnost"] = "NÁVRH ke schválení (EN ISO 13849-1)"
    return {"typ": "P2 MS6", "tag": ident, "nazev": f"P2 {ident} — úprava vzduchu MS6" + (" + bezpečnostní odvzdušnění (návrh)" if sv else ""),
            "dily": m.dily, "instance": m.inst, "telesa": m.tel, "kabely": m.kab, "skupiny": [],
            "props": mp,
            "rozhrani": rozhrani, "kontrola": {"srouby": m.text, "z_osa": z_ax}, "varovani": [jed[0]["uzamykatelny_pozn"]]}


# --- P4 — hadice -----------------------------------------------------------------------------------------------------

def _konec(p: dict) -> list:
    """Čelo hadice uvnitř šroubení: ústí − osa ústí × zasunutí."""
    return [p["usti"][i] - p["osa_usti"][i] * p["zasun"] for i in range(3)]


def hadice(hid: str, a: dict, b: dict, via: list, medium: str, nazev: str = "") -> dict:
    """Hadice z přípojky ``a`` do ``b`` (smlouva: usti, osa_usti, zasun) přes lomené body ``via`` → zaoblení skriptem
    trasa.py (poloměr průtokový, jinak minimum výrobce), délka + rezerva."""
    tr = trasa_mod()
    media = tr.nacti_media()
    rz = D["hadice"]["rezerva"]
    Dh = media[medium]["D"]
    pts = [_konec(a)] + [list(v) for v in via] + [_konec(b)]
    konec = max(a["zasun"], b["zasun"]) + 2 * Dh
    ev = tr.posud_trasu({"id": hid, "medium": medium, "ulozeni": "pevne", "body": pts, "konec_rovny_mm": konec,
                         "rezerva": {"pct": rz["pct"], "mm": rz["mm"], "zdroj": rz["zdroj"]}}, media)
    if ev["chyby"]:
        raise ValueError(f"hadice {hid}: " + "; ".join(ev["chyby"]))
    path = []
    for e in ev["prvky"]:
        if e[0] == "usek":
            path.append({"line": [list(e[1]), list(e[2])]})
        else:
            path.append({"arc": [list(e[1]), list(e[2]), list(e[3])]})
    return {"name": f"Hadice_{hid}", "label": nazev or f"Hadice {ev['nazev']} {hid} ({ev['delka_mm']:.0f} mm, R {ev['R']:g})",
            "r": ev["D"] / 2, "path": path,
            "props": {"Konstrukce_Typ": "hadice", "Hadice_R_min": ev["R_min"], "Hadice_R": ev["R"],
                      "Hadice_Delka_mm": ev["delka_mm"], "Hadice_Delka_rezerva_mm": ev["delka_s_rezervou_mm"],
                      "PLCdesk_Medium": medium},
            "vysledek": {k: ev.get(k) for k in ("id", "nazev", "D", "R", "R_min", "R_doporuceny", "delka_mm", "delka_s_rezervou_mm",
                                                "rezerva", "varovani", "rohy")}}


def _p1_porty(p1: dict) -> dict:
    """Přípojky válce P1 ve smlouvě P4 (osa ústí: QS = n, GRLA = věž)."""
    out = {}
    for q in p1["rozhrani"]["pripojky"]:
        u = q["tower"] if q["fitting"].startswith("GRLA") else q["n"]
        h = spojky_pneu.hadice_kod(q["hose"])
        out[q["port"]] = dict(q, osa_usti=u, D=h["D"])
    return out


def _bez_zacatku_hadic(p1: dict) -> dict:
    """Modul P1 bez začátků hadic (celé hadice staví P4)."""
    return dict(p1, kabely=[k for k in p1["kabely"] if k["props"].get("Konstrukce_Typ") != "hadice"])


def _nahoru(p, z):
    return [p["usti"][0], p["usti"][1], z]


def _nad_cilem(p, z, s):
    """Bod nad přípojkou cíle: QS svisle → přímo nad ústím; vodorovná osa (GRLA) → o ``s`` ven po ose a nad."""
    u = p["osa_usti"]
    if abs(u[2]) > 0.9:
        return [[p["usti"][0], p["usti"][1], z]]
    q = [p["usti"][i] + u[i] * s for i in range(3)]
    return [[q[0], q[1], z], q]


def hadice_ostrov_valce(p3: dict, valce: dict, z0: float) -> list:
    """P4: hadice portů 2 / 4 ostrova k přípojkám válců (``valce`` = {tag: modul P1}). Každá hadice má vlastní výšku
    vodorovného úseku (``z0`` + k × vrstva); ventil nejdál od válců jede nejvýš (nekříží svislé úseky ostatních)."""
    vr = D["hadice"]["vrstva_mm"]
    pr = p3["rozhrani"]["pripojky"]
    tags = [v["tag"] for v in p3["rozhrani"]["ventily"]]
    out, k = [], 0
    for vt in reversed(tags):                                     # nejbližší ventil (vpravo) nejníž
        for q in sorted((x for x in pr if x["ventil"] == vt), key=lambda x: x["cil"] == "predni"):
            cyl = q.get("valec")
            if not cyl or cyl not in valce:
                continue
            tgt = _p1_porty(valce[cyl])[q["cil"]]
            z = z0 + k * vr
            k += 1
            R = q["R"]
            via = [_nahoru(q, z)] + _nad_cilem(tgt, z, tgt["zasun"] + 2 * tgt["D"] + R + 5)
            h = hadice(f"{q['ventil'].lstrip('-')}_{q['port']}_{cyl.lstrip('-')}_{q['cil']}", q, tgt, via, "festo_PUN_6x1",
                       f"Hadice PUN-6x1 {q['ventil']} port {q['port']} → {cyl} {q['cil']}")
            h["vysledek"].update({"od": q["id"], "do": tgt["id"]})
            out.append(h)
    return out


def hadice_p2_p3(p2: dict, p3: dict) -> dict:
    """P4: rozvod P z výstupu úpravy vzduchu do portu P lišty (PUN-10): vodorovně, dolů, vodorovně do portu."""
    a, b = dict(p2["rozhrani"]["vystup_P"]), dict(p3["rozhrani"]["napajeni"])
    xm = (a["usti"][0] + b["usti"][0]) / 2
    via = [[xm, a["usti"][1], a["usti"][2]], [xm, b["usti"][1], b["usti"][2]]]
    if abs(a["usti"][1] - b["usti"][1]) > 1e-6:
        raise ValueError("výstup P2 a port P lišty musí ležet ve stejném y (rovinná trasa) — posuň modul")
    h = hadice("P_rozvod", a, b, via, "festo_PUN_10x1.5", "Hadice PUN-10x1,5 rozvod P: úprava vzduchu → lišta")
    h["vysledek"].update({"od": f"{p2['tag']}.P_out", "do": b["id"]})
    return h


# --- manifest ----------------------------------------------------------------------------------------------------------

def z_manifestu(man: dict) -> dict:
    """Ventily (``valve_solenoid``) a jimi ovládané válce (vazby ``actuates``) z PLCdesk_CAD.json + zpětná vazba:
    chybějící řádky kusovníku (lišta, úprava vzduchu, bezpečnostní odvzdušnění) jako NÁVRH (plcdesk-cad-feedback v1)."""
    parts = {p["id"]: p for p in man.get("parts") or []}
    act = {r["from"]: r["to"] for r in man.get("relations") or [] if r.get("kind") == "actuates"}
    ventily = []
    for pid, p in parts.items():
        if p.get("category") != "valve_solenoid":
            continue
        cyl = act.get(pid)
        ventily.append({"tag": p.get("tag") or pid.split(":")[0], "partId": pid, "kod": p.get("type"), "obj": p.get("orderCode"),
                        "valec": parts[cyl]["tag"] if cyl in parts else None, "valec_partId": cyl})
    ventily.sort(key=lambda v: v["tag"])
    nezname = [v for v in ventily if str(v["obj"]) not in D["ventily"]]
    cats = {p.get("category") for p in parts.values()}
    issues = []
    anchor = [ventily[0]["partId"]] if ventily else []
    if ventily and not cats & {"valve_terminal", "valve_manifold"}:
        issues.append({"id": "p3-lista-1", "kind": "other", "severity": "info", "parts": anchor,
                       "measured": {"what": "rozváděčů na liště", "value": len(ventily), "unit": "ks", "source": "PLCdesk_CAD.json (valve_solenoid)"},
                       "required": {"what": "řádek lišty rozváděčů", "min": 1, "unit": "ks", "basis": "modul P3 — rozteč 16 mm (" + _src("RS_VABM_14") + ")"},
                       "message": f"Kusovník nemá lištu rozváděčů pro {len(ventily)} ventilů VUVG-L14 — návrh: lišta Festo VABM-L1-14… s {len(ventily)} místy (typ doplní projektant).",
                       "suggestion": {"line": {"type": f"lišta rozváděčů VABM-L1-14… {len(ventily)} míst", "orderCode": "", "brand": "Festo", "qty": 1,
                                               "note": "NÁVRH PLCdesk PRO P3 — kód podle počtu míst ověřit u Festo"}}})
    need = {"EM1": "air_shutoff", "LFR": "air_prep", "SV": "safety_valve"}       # řádek kusovníku jádra pro jednotku P2
    if ventily:
        for i, j in enumerate(D["uprava"]["jednotky"]):
            if need[j["id"]] in cats or (j["id"] == "SV" and man.get("safety") is None):
                continue          # řádek v kusovníku je; bezpečnostní ventil jen u stroje s modulem bezpečnosti
            issues.append({"id": f"p2-{j['id'].lower()}-1", "kind": "other", "severity": "warn" if j["id"] == "SV" else "info",
                           "parts": anchor,
                           "measured": {"what": "řádek úpravy vzduchu v kusovníku", "value": 0, "unit": "ks", "source": f"PLCdesk_CAD.json ({need[j['id']]} chybí)"},
                           "required": {"what": j["funkce"], "min": 1, "unit": "ks", "basis": _src(j["zdroj"])},
                           "message": f"Stroj s pneumatikou nemá v kusovníku {j['kod']} — návrh modulu P2" + (
                               " (bezpečnostní odvzdušnění: NÁVRH ke schválení, EN ISO 13849-1)" if j["id"] == "SV" else "")
                           + (f"; {j['uzamykatelny_pozn']}" if j["id"] == "EM1" else ""),
                           "suggestion": {"line": {"type": j["kod"], "orderCode": j["obj"], "brand": "Festo", "qty": 1,
                                                   "note": "NÁVRH PLCdesk PRO P2 — ke schválení"}}})
    return {"ventily": ventily, "nepodporovane": nezname, "issues": issues}


def zpetna_vazba(man: dict, extra: list | None = None, manifest_sha: str = "") -> dict:
    zm = z_manifestu(man)
    return {"format": "plcdesk-cad-feedback", "version": 1, "project": {"guid": (man.get("project") or {}).get("guid", "")},
            "manifest": {"sha256": manifest_sha}, "created": "", "tool": GEN, "issues": zm["issues"] + list(extra or [])}


# --- zkušební deska ---------------------------------------------------------------------------------------------------

def lavice_p234(delka: float = 1500.0) -> dict:
    """Zkušební deska P2 + P3 + P4: profil 40 × 40 × ``delka`` podél X; P2 (MS6) vlevo, ostrov se 2 ventily, dva válce P1
    (A Ø32×100 patky + GRLA, B Ø50×80 příruba + kloub), hadice ostrov → válce a rozvod P."""
    p2 = uprava("-P2", 20.0)
    # ostrov: port P lišty ve stejném y jako výstup P2; mezera pro hadici PUN-10 (2 oblouky R 54 + rovné konce)
    xo = p2["rozhrani"]["vystup_P"]["usti"][0] + 2 * (54 + 20.7 + 20) + 20.1 + 10 - 60.0
    p3 = ostrov("-VI1", [{"tag": "-Y1", "valec": "-Y2"}, {"tag": "-Y2", "valec": "-Y1"}], xo)
    pa = modul_valec.patka_ms1(32)
    A = modul_valec.modul("-Y1", "ISO 15552", 32, 100, "patky", "nic", "deska", grla=True,
                          pos=(640.0 + pa["delka"] + modul_valec.PREKRYV, 0.0, 40.0 + pa["AH"] + modul_valec.T_DESKA),
                          nazev="P1 -Y1 ISO 15552 Ø32×100 patky, GRLA")
    pf = modul_valec.priruba_mf1(50)
    B = modul_valec.modul("-Y2", "ISO 15552", 50, 80, "priruba", "kloub", "uhelnik", pos=(1120.0, 0.0, 40.0 + pf["E"] / 2 + 5.0),
                          nazev="P1 -Y2 ISO 15552 Ø50×80 příruba + kloubová hlava")
    valce = {"-Y1": A, "-Y2": B}
    hs = [hadice_p2_p3(p2, p3)] + hadice_ostrov_valce(p3, valce, 200.0)
    p4 = {"typ": "P4 hadice", "tag": "-P4", "nazev": "P4 — hadice ostrov ↔ válce a rozvod P", "dily": [], "instance": [], "telesa": [],
          "kabely": [{k: v for k, v in h.items() if k != "vysledek"} for h in hs], "skupiny": [],
          "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "P4"},
          "rozhrani": {"format": "plcdesk-pro-modul", "modul": "P4", "verze": 1, "generator": GEN,
                       "hadice": [h["vysledek"] for h in hs],
                       "kusovnik": _kusovnik_hadic(hs), "odhady": [D["hadice"]["rezerva"]["zdroj"], D["hadice"]["vrstva_pozn"]]},
          "varovani": [w for h in hs for w in h["vysledek"].get("varovani") or []]}
    m = [p2, p3, _bez_zacatku_hadic(A), _bez_zacatku_hadic(B), p4]
    return {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": "Lavice_P234",
            "nazev": "Zkušební deska modulů P2 + P3 + P4 (+ 2 × P1)", "snimky_prefix": "lavice_p234",
            "snimky": ["iso", "iso2", "shora", "bok"],
            "profil": {"kod": "104040L", "delka": delka, "label": f"Profil ALUTEC 104040L 40×40×{delka:g} (zkušební deska)"},
            "dily": modul_valec._uniq([s for x in m for s in x["dily"]]), "moduly": m}


def _kusovnik_hadic(hs: list) -> list:
    out = {}
    for h in hs:
        v = h["vysledek"]
        o = out.setdefault(v["nazev"], {"hadice": v["nazev"], "kusu": 0, "delka_mm": 0.0, "delka_s_rezervou_mm": 0.0})
        o["kusu"] += 1
        o["delka_mm"] = round(o["delka_mm"] + v["delka_mm"], 1)
        o["delka_s_rezervou_mm"] = round(o["delka_s_rezervou_mm"] + v["delka_s_rezervou_mm"], 1)
    return list(out.values())


def write_rozhrani(plan: dict, folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    out = []
    for m in plan["moduly"]:
        r = m.get("rozhrani")
        if not r:
            continue
        nm = f"{r['modul']}_{str(m.get('tag') or r.get('tag') or r.get('id')).lstrip('-')}.json"
        p = folder / nm
        p.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        out.append(str(p))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Moduly P2 / P3 / P4 — úprava vzduchu, ventilový ostrov, hadice (plán; volitelně FreeCAD)")
    ap.add_argument("--manifest", help="PLCdesk_CAD.json: ventily + actuates → přehled a zpětná vazba (bez stavby)")
    ap.add_argument("--feedback", help="soubor zpětné vazby PLCdesk_CAD_feedback_p234.json (s --manifest)")
    ap.add_argument("--plan", help="uložit plán JSON")
    ap.add_argument("--rozhrani", help="složka pro P2_/P3_/P4_*.json")
    ap.add_argument("--fc", help="složka: postavit zkušební desku ve FreeCADu (slot pro-p234) a spustit kontroly")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    if a.manifest:
        man = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
        zm = z_manifestu(man)
        for v in zm["ventily"]:
            print(f"{v['tag']}: {v['kod']} → válec {v['valec']}")
        if a.feedback:
            Path(a.feedback).write_text(json.dumps(zpetna_vazba(man), ensure_ascii=False, indent=1), encoding="utf-8")
            print(a.feedback)
        return 0
    plan = lavice_p234()
    for h in plan["moduly"][-1]["rozhrani"]["hadice"]:
        print(f"{h['id']}: {h['delka_mm']:.0f} mm (s rezervou {h['delka_s_rezervou_mm']:.0f}), R {h['R']:g} / min {h['R_min']:g}")
    if a.plan:
        Path(a.plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.rozhrani:
        print("\n".join(write_rozhrani(plan, Path(a.rozhrani))))
    if a.fc:
        from . import bench
        write_rozhrani(plan, Path(a.fc))
        res = bench.build_and_check(plan, Path(a.fc), slot="pro-p234")
        print(json.dumps(res.get("souhrn", res), ensure_ascii=False, indent=1))
        return 0 if res.get("ok") else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
