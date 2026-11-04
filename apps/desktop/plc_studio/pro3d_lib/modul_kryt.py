"""Modul O3 — ochranný kryt s dveřmi a blokovacím spínačem / zámkem na rámu N1 (čistý Python: plán + smlouva; FreeCAD:
``fc_ram.py`` = ``fc_lib.py``).

Konstrukce (data ``data/kryt.json``, rozměry jen se zdrojem, jinak ODHAD a díl zástupně oranžově):
* **nástavba** z profilů ALUTEC 40 × 40 na pracovní desce N1 (deska = dno krytu): spodní věnec (podélné příčky x pod
  sloupky + příčné y mezi nimi), 4 sloupky, horní věnec (podélníky x na sloupcích, příčníky y mezi nimi). Sloupek ↔
  podélník / spodní příčka x = dlouhý šroub ALUTEC do jádra (jako N1), příčky y = úhelníky 303876 na vnitřních lících
  (dlouhý šroub by se v rohu křížil se svislým). Spodní příčky jsou k desce přišroubované ZESPODU (ISO 4762 M6 deskou do
  matice T spodní drážky) — otvory v desce = požadavky na rám (``pozadavky`` N1 → průchody desky, N1 je přijme / odmítne);
* **výplně** polykarbonát 4 mm (729100) v drážkách po obvodu pole (zasunutí 8 mm, těsnění EPDM 700004 zástupně U profil),
  střecha PC 4 přišroubovaná shora do drážek horního věnce (pevný kryt jen nástrojem — ISO 14120); volba výplně podle
  ISO 13857 tab. 4: pletivo 30 × 30 je přípustné jen tam, kde je stěna ≥ Sr(30) od zóny — smlouva to uvádí jako možnost,
  model staví plné výplně (pletivo se modelem nekontroluje);
* **dveře** na přední straně: rám 40 × 40 lícovaný se sloupky (mezera 5 mm, e ≤ 6 → Sr ≥ 10), výplň PC, 2 panty 614040
  (pevná polovina na sloupku, pohyblivá na dveřích — ``Konstrukce_Pohyb`` otočení kolem osy pantu o −95°, ven), madlo,
  doraz na horním podélníku, záslepky čel;
* **blokovací spínač** (typ z kusovníku, např. Siemens 3SE5232 / zámek Schmersal AZM201) na sloupku zavírací strany,
  ovladač na dveřích s jazýčkem do štěrbiny spínače ve směru pohybu dveří; ISO 14119 obcházení = vlastnost a poznámka;
* **pomocné zóny** (závazné): dráha dveří (výseč 10–95°, ``Konstrukce_Zona = dvere``) a přístup ovladače ke spínači
  (``spinac``) — nesmí do nich zasahovat pevný díl.

Bezpečnost = NÁVRH ke schválení (PL / kategorie z PLCdesk ``safety.functions``), žádná bezpečnostní logika.

Výstup: ``modul`` pro ``fc_lib`` (díly, instance, tělesa, skupina „Dveře“), ``rozhrani`` = smlouva ``O3_<id>.json``.

CLI: ``python -m plc_studio.pro3d_lib.modul_kryt [--manifest PLCdesk_CAD.json] [--rozhrani SLOŽKA] [--fc SLOŽKA]``
(bez manifestu = zkušební sestava: N1 800 × 600 s deskou, kryt, P1 Ø32 × 100 uvnitř)."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import modul_ram, spojky_mech  # noqa: E402
from .modul_ram import _cyl, _lib, add, cols, r3  # noqa: E402
from ..pro3d_tools import rules  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data" / "kryt.json").read_text(encoding="utf-8"))
RAM = modul_ram.DATA
NORM = spojky_mech.NORM
GEN = "pro3d_lib/modul_kryt"
SLOT = "pro-o3"
A = 40.0
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
DZ = spojky_mech.drazka("40/8")
NECK = DZ["otvor"] / 2.0          # polovina hrdla drážky (4,1)
RET = DZ["ret"]                   # rty 4 mm
SRC_KAT = modul_ram.SRC_KAT


def _box(x0, x1, y0, y1, z0, z1):
    return {"box": [round(min(x0, x1), 3), round(max(x0, x1), 3), round(min(y0, y1), 3), round(max(y0, y1), 3),
                    round(min(z0, z1), 3), round(max(z0, z1), 3)]}


def _ax(n):
    return {"x": 0, "y": 1, "z": 2}[n]


def _gbox(n, c0, c1, u, u0, u1, v, v0, v1):
    """Kvádr v globálu: osa ``n`` ⟨c0, c1⟩, osa ``u`` ⟨u0, u1⟩, osa ``v`` ⟨v0, v1⟩."""
    lo, hi = [0.0] * 3, [0.0] * 3
    for ax_, a, b in ((n, c0, c1), (u, u0, u1), (v, v0, v1)):
        i = _ax(ax_)
        lo[i], hi[i] = min(a, b), max(a, b)
    return _box(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2])


def _rel(body, o):
    """Přesune prvky těla (jen box / cyl) o −o (díl v místních souřadnicích, instance na poloze o)."""
    out = {}
    for k in ("add", "cut"):
        lst = []
        for p in body.get(k, []):
            if "box" in p:
                b = p["box"]
                lst.append(_box(b[0] - o[0], b[1] - o[0], b[2] - o[1], b[3] - o[1], b[4] - o[2], b[5] - o[2]))
            else:
                c = dict(p["cyl"])
                c["p"] = r3([c["p"][i] - o[i] for i in range(3)])
                lst.append({"cyl": c})
        if lst:
            out[k] = lst
    return out


def iso_sr(e, tvar="sterbina"):
    return rules.iso13857_sr(e, tvar)


def box_dist(b1, b2):
    """Vzdálenost dvou obálek [x0, y0, z0, x1, y1, z1] (0 = překryv)."""
    d = 0.0
    for i in range(3):
        g = max(b1[i] - b2[i + 3], b2[i] - b1[i + 3], 0.0)
        d += g * g
    return math.sqrt(d)


# --- zařízení z manifestu -----------------------------------------------------------------------------------------------
def blokovani(manifest: dict | None) -> list[dict]:
    """Blokovací zařízení krytu z manifestu PLCdesk: interlock DI s řádkem ``safety_switch`` + DO s rolí ``lock`` (zámek).
    Bez manifestu = jeden spínač 3SE5232 bez zámku (zkušební sestava)."""
    if not manifest:
        return [{"device": "S2", "id": "-S2:safety_switch", "typ": "3SE5232-0QV40", "signal": "S2_in", "desc": "Kryt zavřen (NC)",
                 "zamek": None, "fn": None}]
    devs = {d.get("name"): d for d in manifest.get("devices") or []}
    parts = {p.get("device"): p for p in manifest.get("parts") or [] if p.get("category") == "safety_switch"}
    funcs = (manifest.get("safety") or {}).get("functions") or []
    locks = [d for d in devs.values() if d.get("role") == "lock"]
    out = []
    for il in (manifest.get("safety") or {}).get("interlocks") or []:
        nm = il.get("device")
        p = parts.get(nm)
        if not p:                          # světelná závora a jiné AOPD = modul O4, ne kryt
            continue
        d = devs.get(nm) or {}
        sig = next((s.get("tag") for s in d.get("signals") or [] if s.get("dir") == "DI"), f"{nm}_in")
        fn = next((f for f in funcs if f.get("ref") == f"guard:{nm}" or nm in (f.get("inputs") or [])), None)
        out.append({"device": nm, "id": p["id"], "typ": (p.get("orderCode") or "").strip() or "3SE5232-0QV40",
                    "brand": p.get("brand"), "signal": sig, "desc": d.get("desc") or "", "zamek": None, "fn": fn})
    for i, lk in enumerate(locks):                 # zámek přiřadit dveřím v pořadí (víc dveří = víc modulů O3)
        sig = next((s.get("tag") for s in lk.get("signals") or [] if s.get("dir") == "DO"), f"{lk.get('name')}_out")
        lp = parts.get(lk.get("name")) or {}
        if out:
            out[min(i, len(out) - 1)]["zamek"] = {"device": lk.get("name"), "signal": sig, "id": lp.get("id"),
                                                  "typ": (lp.get("orderCode") or "").strip(), "desc": lk.get("desc") or ""}
    return out


def sroub_zespodu(b, x, y, z_lic, t_deska, along, label, M="M6"):
    """ISO 4762 zespodu deskou N1 do matice T spodní drážky profilu na desce: hlava v zahloubení ze spodu desky (hloubka
    = výška hlavy k, Ø dk + 1 — ODHAD), upnutá tloušťka t − k. Vrací (instance šroubu, požadavek na desku N1)."""
    hd = NORM["ISO4762"]["rady"][M]
    cb = float(hd["k"])
    r = b.nut_screw(M, [x, y, z_lic], along, [0, 0, -1], t_deska - cb, False, label)
    return r, {"bod": [x, y, z_lic], "d": spojky_mech.otvor_vule(M), "zahloubeni": {"d": hd["dk"] + 1.0, "h": cb}}


# --- stavba ---------------------------------------------------------------------------------------------------------------
class Kryt:
    def __init__(self, n1: dict, zony=(), manifest=None, vyska=None, ident="O3", nazev="", strana_dveri="predni"):
        r = n1["rozmery"]
        if not n1.get("deska"):
            raise ValueError("O3 potřebuje pracovní desku N1 jako dno krytu (rám bez desky: dno krytu = požadavek na rám)")
        self.n1 = n1
        self.D, self.W, self.Zb = float(r["D"]), float(r["W"]), float(r["H_horni_lic"])
        self.t_deska = float(n1["deska"]["t"])
        rm = DATA["ramec"]
        self.X0, self.X1 = rm["inset_x"], self.D - rm["inset_x"]
        self.Y0, self.Y1 = rm["inset_y"], self.W - rm["inset_y"]
        self.Hk = float(vyska or rm["vyska"])
        self.Zt = self.Zb + self.Hk
        self.zony = [dict(z) for z in zony]
        self.ident, self.nazev = ident, nazev or f"O3 kryt {self.X1 - self.X0:g} × {self.Y1 - self.Y0:g} × {self.Hk:g} s dveřmi"
        if strana_dveri != "predni":
            raise ValueError("dveře zatím jen na přední straně (y min)")
        self.blk = blokovani(manifest)
        self.b = modul_ram.Ram(self.D, self.W, self.Zb)        # pomocník: profily, dlouhé šrouby, matice T, úhelníky (N1)
        self.bd = modul_ram.Ram(self.D, self.W, self.Zb)       # totéž pro dveře (skupina s Konstrukce_Pohyb)
        self.tel, self.odhady, self.zdroje, self.varovani, self.chyby = [], set(), {SRC_KAT}, [], []
        self.pozadavky, self.vypln_pole = [], []
        self.fb = []                                            # zpětná vazba do PLCdesk

    # -- pomocníci
    def lib(self, b, spec):
        return b.dil(spec)

    def screw_below(self, x, y, along, label):
        """Spodní příčka → deska: ISO 4762 M6 zespodu deskou do matice T spodní drážky příčky; otvor v desce = požadavek N1."""
        r, q = sroub_zespodu(self.b, x, y, self.Zb, self.t_deska, along, label)
        self.pozadavky.append(dict(q, co=f"O3: otvor Ø{q['d']:g} se zahloubením Ø{q['zahloubeni']['d']:g} × {q['zahloubeni']['h']:g} "
                                         f"pro šroub M6 zespodu ({label})", kind="otvor_sroub"))
        if r is None:
            self.chyby.append(f"{label}: šroub zespodu nenalezen")
        return r

    def zaslepka(self, b, P, n, druh="zaslepka"):
        zs = RAM["zaslepka"]
        k = b.dil(_lib("Zaslepka_224040", {"add": [{"box": [-A / 2, A / 2, -A / 2, A / 2, 0, zs["t"]]}]},
                       "Záslepka ALUTEC 224040 PA6 (zástupná)", zs["zdroj"], "obálka", typ="prislusenstvi", material="PA6",
                       pozn=zs["pozn"], zastupny=True))
        ref = [1, 0, 0] if abs(n[0]) < 0.5 else [0, 1, 0]
        ey = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]]
        ex = [ey[1] * n[2] - ey[2] * n[1], ey[2] * n[0] - ey[0] * n[2], ey[0] * n[1] - ey[1] * n[0]]
        self.odhady.add(zs["pozn"])
        return b.put(k, P, cols(ex, ey, n), druh)

    def pole(self, b, n, c, u, u0, u1, v, v0, v1, nazev, druh="vypln", vypln="pc4", skupina=None):
        """Výplň v drážkách po obvodu pole: rovina ``n`` = c, okraje pole (líce profilů) u0..u1 × v0..v1; panel zasunutý
        ``vnoreni`` do drážek všech 4 stran (kříž — rohy pole jsou v profilech), těsnění EPDM (U) v hrdle každé drážky."""
        vp, ts = DATA["vyplne"][vypln], DATA["tesneni"]
        t, p, cl = vp["t"], ts["vnoreni"], 0.3
        h = t / 2.0
        o = {"x": [0, 0, 0], "y": [0, 0, 0], "z": [0, 0, 0]}
        org = [0.0, 0.0, 0.0]
        org[_ax(n)], org[_ax(u)], org[_ax(v)] = c, u0, v0
        body = {"add": [_gbox(n, c - h, c + h, u, u0 - p, u1 + p, v, v0 + cl, v1 - cl),
                        _gbox(n, c - h, c + h, u, u0 + cl, u1 - cl, v, v0 - p, v1 + p)]}
        key = f"Vypln_{vypln}_{u1 - u0:g}x{v1 - v0:g}"
        self.lib(b, _lib(key, _rel(body, org), f"Výplň {vp['nazev']} {u1 - u0 + 2 * p:g} × {v1 - v0 + 2 * p:g} × {t:g} ({vp['kod']})",
                         [DATA["vyplne"]["_zdroj"]], f"tvar; zasunutí {p:g} mm do drážek po obvodu", typ="vypln",
                         material="polykarbonát (PC)" if vypln == "pc4" else "ocel Zn", pozn=vp["pozn"], vlastni=True))
        b.put(key, org, I3, druh, {"Konstrukce_Typ": "vypln", "PLCdesk_Mount": "drazka", "Konstrukce_Vypln": vp["kod"],
                                   "Konstrukce_Poznamka": f"{nazev}: výplň v drážkách (těsnění EPDM {ts['kod']})"})
        # těsnění: hrany u0 / u1 (podél v) a v0 / v1 (podél u)
        for (ea, e0, sgn, along, a0, a1) in ((u, u0, -1, v, v0, v1), (u, u1, 1, v, v0, v1), (v, v0, -1, u, u0, u1), (v, v1, 1, u, u0, u1)):
            L = a1 - a0
            legs = []
            for s0, s1 in ((-NECK + 0.05, -h - 0.05), (h + 0.05, NECK - 0.05)):
                legs.append(_gbox(n, c + s0, c + s1, ea, e0, e0 + sgn * (p + 1.0), along, a0, a1))
            bridge = _gbox(n, c - NECK + 0.05, c + NECK - 0.05, ea, e0 + sgn * (p + 0.1), e0 + sgn * (p + 1.0), along, a0, a1)
            borg = [0.0, 0.0, 0.0]
            borg[_ax(n)], borg[_ax(ea)], borg[_ax(along)] = c, e0, a0
            bb = _rel({"add": legs + [bridge]}, borg)
            sk = f"Tesneni_{ts['kod']}_{ea}{along}{'p' if sgn > 0 else 'm'}_{n}_L{L:g}"
            self.lib(b, _lib(sk, bb, f"Těsnění EPDM {ts['kod']} panel 4 mm, délka {L:g} (zástupné)", ts["zdroj"], "obálka",
                             typ="prislusenstvi", material="EPDM", pozn=ts["pozn"], zastupny=True))
            b.put(sk, borg, I3, "tesneni")
        self.odhady.add(ts["pozn"])
        self.zdroje.add(DATA["vyplne"]["_zdroj"])
        self.vypln_pole.append({"pole": nazev, "rovina": f"{n} = {c:g}", "rozmer_mm": [round(u1 - u0, 1), round(v1 - v0, 1)],
                                "vypln": vp["kod"], "druh": vp["nazev"]})

    # -- stavba
    def build(self):
        b, X0, X1, Y0, Y1, Zb, Zt = self.b, self.X0, self.X1, self.Y0, self.Y1, self.Zb, self.Zt
        ex_x, ey_x = [0, 1, 0], [0, 0, 1]          # profil podél x
        ex_y, ey_y = [0, 0, 1], [1, 0, 0]          # profil podél y
        sills_x, rails_x, sills_y, rails_y, posts = [], [], [], [], []
        for yc, nm in ((Y0 + A / 2, "přední"), (Y1 - A / 2, "zadní")):
            sills_x.append(b.member("104040", A, A, X1 - X0, [X0, yc, Zb + A / 2], ex_x, ey_x, [1, 0, 0], "o3_spodni_x", f"O3 spodní příčka x {nm}"))
            rails_x.append(b.member("104040", A, A, X1 - X0, [X0, yc, Zt - A / 2], ex_x, ey_x, [1, 0, 0], "o3_horni_x", f"O3 horní podélník {nm}"))
        for xc, nm in ((X0 + A / 2, "levá"), (X1 - A / 2, "pravá")):
            sills_y.append(b.member("104040", A, A, Y1 - Y0 - 2 * A, [xc, Y0 + A, Zb + A / 2], ex_y, ey_y, [0, 1, 0], "o3_spodni_y", f"O3 spodní příčka y {nm}"))
            rails_y.append(b.member("104040", A, A, Y1 - Y0 - 2 * A, [xc, Y0 + A, Zt - A / 2], ex_y, ey_y, [0, 1, 0], "o3_horni_y", f"O3 horní příčník y {nm}"))
        for xc in (X0 + A / 2, X1 - A / 2):
            for yc in (Y0 + A / 2, Y1 - A / 2):
                m = b.member("104040", A, A, self.Hk - 2 * A, [xc, yc, Zb + A], [1, 0, 0], [0, 1, 0], [0, 0, 1], "o3_sloupek", f"O3 sloupek ({xc:g}, {yc:g})")
                m["xc"], m["yc"] = xc, yc
                posts.append(m)
        for pm in posts:
            sx = sills_x[0] if pm["yc"] < self.W / 2 else sills_x[1]
            rx = rails_x[0] if pm["yc"] < self.W / 2 else rails_x[1]
            b.dlouhy_sroub(sx, [pm["xc"], pm["yc"], Zb], [0, 0, 1], A, f"O3 sloupek ({pm['xc']:g}, {pm['yc']:g}) ← spodní příčka x")
            b.dlouhy_sroub(rx, [pm["xc"], pm["yc"], Zt], [0, 0, -1], A, f"O3 horní podélník → sloupek ({pm['xc']:g}, {pm['yc']:g})")
        # příčky y ↔ příčky x: úhelníky na vnitřních lících (svislý dlouhý šroub sloupku by se s vodorovným křížil)
        for z, lbl in ((Zb + A / 2, "spodní"), (Zt - A / 2, "horní")):
            for x_in, nB in ((X0 + A, [1, 0, 0]), (X1 - A, [-1, 0, 0])):
                for y_in, nA in ((Y0 + A, [0, 1, 0]), (Y1 - A, [0, -1, 0])):
                    b.uhelnik([x_in, y_in, z], nA, nB, None, None, f"O3 {lbl} roh ({x_in:g}, {y_in:g})")
        # spodní příčky → deska zespodu (otvory = požadavky na N1)
        for sx in sills_x:
            yc = sx["o"][1]
            for x in (X0 + (X1 - X0) * 0.2, X1 - (X1 - X0) * 0.2):
                self.screw_below(round(x, 1), yc, [1, 0, 0], f"O3 spodní příčka x y {yc:g} → deska x {x:.0f}")
        for sy in sills_y:
            xc = sy["o"][0]
            for y in (Y0 + (Y1 - Y0) * 0.3, Y1 - (Y1 - Y0) * 0.3):
                self.screw_below(xc, round(y, 1), [0, 1, 0], f"O3 spodní příčka y x {xc:g} → deska y {y:.0f}")
        # záslepky čel příček x (příčky y a sloupky čela zakrývají)
        for m in sills_x + rails_x:
            self.zaslepka(b, [X0, m["o"][1], m["o"][2]], [-1, 0, 0])
            self.zaslepka(b, [X1, m["o"][1], m["o"][2]], [1, 0, 0])
        # výplně: boky (x = osa sloupků), záda (y = osa zadních sloupků)
        for xc, nm in ((X0 + A / 2, "levý bok"), (X1 - A / 2, "pravý bok")):
            self.pole(b, "x", xc, "y", Y0 + A, Y1 - A, "z", Zb + A, Zt - A, nm)
        self.pole(b, "y", Y1 - A / 2, "x", X0 + A, X1 - A, "z", Zb + A, Zt - A, "záda")
        self.strecha(rails_x, rails_y)
        self.dvere(posts, rails_x)
        b.finalize_members()
        self.bd.finalize_members()
        for it in self.bd.inst:
            it["skupina"] = "Dvere"
        for bb in (self.b, self.bd):
            self.odhady |= bb.odhady
            self.zdroje |= bb.zdroje
            self.chyby += bb.chyby
        self.zony_pomocne()
        self.vyhodnoceni()
        return self

    def strecha(self, rails_x, rails_y):
        X0, X1, Y0, Y1, Zt = self.X0, self.X1, self.Y0, self.Y1, self.Zt
        vp = DATA["vyplne"]["pc4"]
        t = vp["t"]
        pts = []
        for rx in rails_x:
            for x in (X0 + (X1 - X0) * 0.3, X1 - (X1 - X0) * 0.3):
                pts.append(([round(x, 1), rx["o"][1]], [1, 0, 0]))
        for ry in rails_y:
            pts.append(([ry["o"][0], (Y0 + Y1) / 2], [0, 1, 0]))
        cut = [_cyl([x - X0, y - Y0, -1], [0, 0, 1], spojky_mech.otvor_vule("M6") / 2, t + 2) for (x, y), _ in pts]
        key = f"Strecha_pc4_{X1 - X0:g}x{Y1 - Y0:g}"
        self.b.dil(_lib(key, {"add": [_box(0, X1 - X0, 0, Y1 - Y0, 0, t)], "cut": cut},
                        f"Střecha krytu {vp['nazev']} {X1 - X0:g} × {Y1 - Y0:g} × {t:g} ({vp['kod']})", [DATA["vyplne"]["_zdroj"]],
                        "tvar; šrouby M6 do matic T horní drážky věnce", typ="kryt", material="polykarbonát (PC)", pozn=vp["pozn"],
                        vlastni=True))
        self.b.put(key, [X0, Y0, Zt], I3, "strecha", {"Konstrukce_Typ": "kryt", "Konstrukce_Poznamka":
                                                      "pevný kryt — upevnění jen nástrojem (ISO 14120), šrouby nezávislé na krytu ODHAD"})
        for (x, y), al in pts:
            self.b.nut_screw("M6", [x, y, Zt], al, [0, 0, 1], t, False, f"O3 střecha → horní věnec ({x:g}, {y:g})")
        self.vypln_pole.append({"pole": "střecha", "rovina": f"z = {Zt:g} (na věnci)", "rozmer_mm": [X1 - X0, Y1 - Y0], "vypln": vp["kod"],
                                "druh": vp["nazev"]})

    def dvere(self, posts, rails_x):
        bd, b = self.bd, self.b
        dv, pa, ma = DATA["dvere"], DATA["pant"], DATA["madlo"]
        g, zs = dv["mezera"], RAM["zaslepka"]["t"]
        X0, X1, Y0, Zb, Zt = self.X0, self.X1, self.Y0, self.Zb, self.Zt
        yc = Y0 + A / 2
        xl, xr = X0 + A + g, X1 - A - g                       # vnější hrany dveřního rámu
        zd0, zd1 = Zb + A + g + zs, Zt - A - g - zs            # stojiny bez záslepek
        self.d_geom = {"x": [xl, xr], "z": [zd0 - zs, zd1 + zs], "y": [Y0, Y0 + A]}
        stl = bd.member("104040", A, A, zd1 - zd0, [xl + A / 2, yc, zd0], [1, 0, 0], [0, 1, 0], [0, 0, 1], "o3_dvere_stojina", "O3 dveře stojina levá (pant)")
        str_ = bd.member("104040", A, A, zd1 - zd0, [xr - A / 2, yc, zd0], [1, 0, 0], [0, 1, 0], [0, 0, 1], "o3_dvere_stojina", "O3 dveře stojina pravá (zavírací)")
        for z, nm in ((zd0 + A / 2, "dolní"), (zd1 - A / 2, "horní")):
            bd.member("104040", A, A, xr - xl - 2 * A, [xl + A, yc, z], [0, 1, 0], [0, 0, 1], [1, 0, 0], "o3_dvere_prapor", f"O3 dveře příčka {nm}")
            bd.dlouhy_sroub(stl, [xl, yc, z], [1, 0, 0], A, f"O3 dveře příčka {nm} ← stojina levá")
            bd.dlouhy_sroub(str_, [xr, yc, z], [-1, 0, 0], A, f"O3 dveře příčka {nm} ← stojina pravá")
        for m in (stl, str_):
            self.zaslepka(bd, [m["o"][0], yc, zd0], [0, 0, -1])
            self.zaslepka(bd, [m["o"][0], yc, zd1], [0, 0, 1])
        self.pole(bd, "y", yc, "x", xl + A, xr - A, "z", zd0 + A, zd1 - A, "dveře", druh="vypln")
        # panty — osa 0,5 mm před lícem, mezi sloupkem a stojinou
        r, hh, tl = pa["r"], pa["vyska"], pa["t"]
        xa, ya = X0 + A + g / 2, Y0 - r - 0.5
        self.osa = [xa, ya]
        fl = X0 + A / 2 - 15 - xa                              # pevné rameno od x = osa sloupku − 15
        mr = xl + A / 2 + 15 - xa
        y_l0, y_l1 = Y0 - tl - ya, Y0 - ya                     # rameno na líci (y Y0 − t … Y0)
        hole_f = X0 + A / 2 - xa
        hole_m = xl + A / 2 - xa
        k_f = b.dil(_lib("Pant_614040_pevny", {"add": [_box(fl, -r - 0.3, y_l0, y_l1, 0, hh), _box(-r - 0.3, 0, y_l0, y_l1 - 0.5, 0, hh / 2),
                                                       {"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": r, "h": hh / 2}}],
                                               "cut": [_cyl([hole_f, y_l0 - 1, hh / 2], [0, 1, 0], spojky_mech.otvor_vule(pa["M"]) / 2, tl + 2)]},
                              f"Pant ALUTEC {pa['kod']} pevná polovina (zástupný)", pa["zdroj"], "obálka", material="Al", pozn=pa["pozn"], zastupny=True))
        k_m = bd.dil(_lib("Pant_614040_dvere", {"add": [_box(r + 0.3, mr, y_l0, y_l1, 0, hh), _box(0, r + 0.3, y_l0, y_l1 - 0.5, hh / 2, hh),
                                                        {"cyl": {"p": [0, 0, hh / 2], "d": [0, 0, 1], "r": r, "h": hh / 2}}],
                                                "cut": [_cyl([hole_m, y_l0 - 1, hh / 2], [0, 1, 0], spojky_mech.otvor_vule(pa["M"]) / 2, tl + 2)]},
                               f"Pant ALUTEC {pa['kod']} polovina dveří (zástupný)", pa["zdroj"], "obálka", material="Al", pozn=pa["pozn"], zastupny=True))
        self.panty = []
        for z0 in (zd0 + 80.0, zd1 - 80.0 - hh):
            b.put(k_f, [xa, ya, z0], I3, "pant_pevny")
            bd.put(k_m, [xa, ya, z0], I3, "pant_dvere")
            b.nut_screw(pa["M"], [X0 + A / 2, Y0, z0 + hh / 2], [0, 0, 1], [0, -1, 0], tl, False, f"O3 pant z {z0:g} → sloupek")
            bd.nut_screw(pa["M"], [xl + A / 2, Y0, z0 + hh / 2], [0, 0, 1], [0, -1, 0], tl, False, f"O3 pant z {z0:g} → stojina")
            self.panty.append({"z": [round(z0, 1), round(z0 + hh, 1)], "osa": r3([xa, ya, z0])})
        self.odhady.add(pa["pozn"])
        self.zdroje.add(pa["zdroj"])
        # madlo na zavírací stojině (U, šrouby shora přes otvor v rukojeti)
        h_m, rz = ma["vyska"], ma["roztec"] / 2
        xm, zm = xr - A / 2, (zd0 + zd1) / 2 - 80.0
        hd = NORM["ISO4762"]["rady"][ma["M"]]
        mb = {"add": [_box(-8, 8, -h_m, 0, -rz - 8, -rz + 8), _box(-8, 8, -h_m, 0, rz - 8, rz + 8), _box(-6, 6, -h_m - 8, -h_m + 2, -rz - 16, rz + 16)],
              "cut": []}
        for zz in (-rz, rz):
            mb["cut"].append(_cyl([0, -h_m - 9, zz], [0, 1, 0], spojky_mech.otvor_vule(ma["M"]) / 2, h_m + 10))
            mb["cut"].append(_cyl([0, -h_m - 9, zz], [0, 1, 0], hd["dk"] / 2 + 0.75, 9.0))       # zahloubení hlavy v rukojeti
        k_ma = bd.dil(_lib("Madlo_620116", mb, f"Držadlo ALUTEC {ma['kod']} PA6 (zástupné)", ma["zdroj"], "obálka", material="PA6",
                           pozn=ma["pozn"], zastupny=True))
        bd.put(k_ma, [xm, Y0, zm], I3, "madlo")
        for zz in (-rz, rz):
            bd.nut_screw(ma["M"], [xm, Y0, zm + zz], [0, 0, 1], [0, -1, 0], h_m, False, f"O3 madlo → stojina z {zm + zz:g}")
        self.odhady.add(ma["pozn"])
        self.madlo = r3([xm, Y0 - h_m - 8, zm])
        # doraz na zadním líci předního horního podélníku (dveře dosednou zadním lícem)
        dz_ = DATA["doraz"]
        xdz = X1 - A - 140.0
        k_dz = b.dil(_lib("Doraz_620000", {"add": [_box(-20, 20, 0, 5, -35, 15)], "cut": [_cyl([0, -1, 0], [0, 1, 0], spojky_mech.otvor_vule("M6") / 2, 7)]},
                          f"Doraz ALUTEC {dz_['kod']} PE-UHMW (zástupný)", dz_["zdroj"], "obálka", material="PE-UHMW", pozn=dz_["pozn"], zastupny=True))
        # díra M6 v ose drážky zadního líce podélníku (z = Zt − 20) → destička z ⟨Zt − 55, Zt − 20⟩ … přesah pod podélník 15 mm
        b.put(k_dz, [xdz, Y0 + A, Zt - 20.0], I3, "doraz")
        b.nut_screw("M6", [xdz, Y0 + A, Zt - 20.0], [1, 0, 0], [0, 1, 0], 5.0, False, "O3 doraz → horní podélník přední")
        self.odhady.add(dz_["pozn"])
        # blokovací spínač na zavíracím sloupku + ovladač na stojině
        self.spinace = []
        if self.blk:
            self.spinac(self.blk[0], posts, xr)
        for extra in self.blk[1:]:
            self.varovani.append(f"blokování {extra['device']}: modul O3 má jedny dveře — další spínač patří dalšímu krytu / dveřím")

    def spinac(self, bl, posts, xr):
        b, bd = self.b, self.bd
        X1, Y0 = self.X1, self.Y0
        typ = bl["typ"]
        sw = DATA["spinace"].get(typ)
        zamek = bl.get("zamek")
        if zamek and not (sw and sw["zamek"]):
            self.fb.append({"kind": "safety_part", "partId": zamek.get("id") or bl["id"],
                            "zprava": f"zámek dveří {zamek['device']} ({zamek['signal']}, DO) je v kusovníku jako {zamek.get('typ') or typ} — "
                                      "spínač bez jištění; navrhnout zámek krytu (např. Schmersal AZM201, Siemens 3SE5 s jištěním) — NÁVRH ke schválení"})
            self.varovani.append(f"zámek {zamek['device']}: přístroj {typ} nemá jištění — model staví AZM201 (ODHAD volby, zpětná vazba)")
            typ, sw = "AZM201Z-SK-T-1P2PW-A", DATA["spinace"]["AZM201Z-SK-T-1P2PW-A"]
        if not sw:
            self.varovani.append(f"spínač {typ}: rozměry v data/kryt.json nejsou — zástupně jako 3SE5232 (ODHAD)")
            sw = DATA["spinace"]["3SE5232-0QV40"]
        w, Ls, d, M = sw["sirka"], sw["delka"], sw["hloubka"], sw["M"]
        xs = X1 - A / 2                                          # osa drážky předního líce zavíracího sloupku
        zs = round((self.d_geom["z"][0] + self.d_geom["z"][1]) / 2 + 60.0, 1)
        zt_ = Ls - 20.0                                          # osa jazýčku od spodku spínače
        slot = {"x": [-2.25, 2.25], "z": [zt_ - 8, zt_ + 8], "y": [-d, -d + 20]}
        hz = [15.0, min(55.0, Ls - 35.0)] if Ls < 150 else [20.0, Ls - 50.0]
        body = {"add": [_box(-w / 2, w / 2, -d, 0, 0, Ls)],
                "cut": [_box(slot["x"][0], slot["x"][1], slot["y"][0] - 1, slot["y"][1], slot["z"][0], slot["z"][1])]}
        hd = NORM["ISO4762"]["rady"][M]
        cb = next((c / 2.0 for c in range(0, 2 * int(d)) if spojky_mech.delka_do_drazky(M, d - c / 2.0, "40/8")["ok"]), 0.0)
        for z in hz:                                             # díra skrz tělo (+ zahloubení hlavy, když délka jinak nevychází)
            body["cut"].append(_cyl([0, -d - 1, z], [0, 1, 0], spojky_mech.otvor_vule(M) / 2, d + 2))
            if cb:
                body["cut"].append(_cyl([0, -d - 1, z], [0, 1, 0], hd["dk"] / 2 + 0.5, cb + 1))
        k_s = b.dil(_lib(f"Spinac_{typ.replace('-', '_')}", body, f"{sw['vyrobce']} {typ} — {sw['nazev']} (zástupný)", [sw["zdroj"]],
                         "obálka (šířka × délka doloženy, ostatní ODHAD)", material="plast", pozn=sw["odhad"], zastupny=True))
        ids = bl["id"]
        props = {"PLCdesk_Id": ids, "Konstrukce_Signal": bl["signal"], "Konstrukce_ISO14119": f"typ {sw['iso14119']['typ']}, kódování "
                 f"{sw['iso14119']['kodovani']}", "Konstrukce_Obchazeni": "; ".join(DATA["obchazeni"]["opatreni"][:2])}
        if zamek:
            props["Konstrukce_Zamek"] = f"{zamek['device']} {zamek['signal']} (DO)"
        si = b.put(k_s, [xs, Y0, zs], I3, "spinac", props)
        for z in hz:
            b.nut_screw(M, [xs, Y0, zs + z], [0, 0, 1], [0, -1, 0], d - cb, False, f"O3 spínač {bl['device']} → sloupek z {zs + z:g}")
        self.odhady.add(f"spínač {typ}: " + sw["odhad"])
        self.zdroje.add(sw["zdroj"])
        # ovladač na zavírací stojině: destička na líci → rameno vpřed → příčka přes mezeru → jazýček +y do štěrbiny
        xo = xr - A / 2
        zo = zs + zt_
        dx = xs - xo
        yb = -d - 12.0                                           # příčka 12 mm před čelem spínače (relativně k líci Y0)
        ob = {"add": [_box(-15, 17, -4, 0, -25, 25), _box(14, 17, yb, -4, -5, 5), _box(14, dx + 1.25, yb, yb + 3, -5, 5),
                      _box(dx - 1.25, dx + 1.25, yb + 3, slot["y"][1] - 2, -5, 5)],
              "cut": [_cyl([0, -5, zz], [0, 1, 0], spojky_mech.otvor_vule("M5") / 2, 6) for zz in (-15, 15)]}
        k_o = bd.dil(_lib(f"Ovladac_{typ.replace('-', '_')}", ob, f"Ovladač spínače {typ} na držáku (zástupný)", [sw["zdroj"]], "obálka",
                          material="ocel", pozn="ovladač a držák ODHAD — " + sw["odhad"], zastupny=True))
        oi = bd.put(k_o, [xo, Y0, zo], I3, "ovladac", {"PLCdesk_Id": ids, "PLCdesk_Instance": "ovladac",
                                                       "Konstrukce_Obchazeni": DATA["obchazeni"]["opatreni"][0]})
        for zz in (-15, 15):
            bd.nut_screw("M5", [xo, Y0, zo + zz], [0, 0, 1], [0, -1, 0], 4.0, False, f"O3 ovladač → stojina z {zo + zz:g}")
        self.zdroje.add(DATA["obchazeni"]["zdroj"])
        self.spinace.append({"device": bl["device"], "typ": typ, "signal": bl["signal"], "zamek": zamek, "plcdesk_id": ids,
                             "poloha": r3([xs, Y0 - d / 2, zs + Ls / 2]), "jazycek": r3([xs, Y0 + slot["y"][0], zo]),
                             "smer_najezdu": [0, 1, 0], "iso14119": sw["iso14119"], "zdroj": sw["zdroj"], "odhad": sw["odhad"],
                             "inst_spinac": si, "inst_ovladac": oi,
                             "zona_spinace": [xs - w / 2 - 1, Y0 + yb - 6, zo - 14, xs + w / 2 + 1, Y0 - d, zo + 14]})

    def zony_pomocne(self):
        """Pomocné zóny: dráha dveří (výseč 10°–95° kolem osy pantu) a přístup ovladače ke spínači — výjimky = díly dveří."""
        xa, ya = self.osa
        g = self.d_geom
        R = 0.0
        for x in g["x"]:
            for y in (g["y"][0] - 60.0, g["y"][1]):
                R = max(R, math.hypot(x - xa, y - ya))
        R += 10.0
        pts = [(xa + 15 * math.cos(math.radians(a)), ya + 15 * math.sin(math.radians(a))) for a in range(-10, -96, -5)]
        pts += [(xa + R * math.cos(math.radians(a)), ya + R * math.sin(math.radians(a))) for a in range(-95, -9, 5)]
        dvere = [f"inst:{j}" for j in range(len(self.b.inst), len(self.b.inst) + len(self.bd.inst))]
        self.tel.append({"name": "Prostor_dveri", "label": f"Pomocný prostor dráhy dveří {self.ident} (10°–{DATA['dvere']['uhel']:g}°)",
                         "body": {"add": [{"prism_z": {"pts": [[round(x, 2), round(y, 2)] for x, y in pts], "z0": round(g["z"][0], 2),
                                                       "z1": round(g["z"][1], 2)}}]},
                         "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "dvere"}, "vyjimka": dvere})
        self.zona_dveri = {"osa": r3([xa, ya, 0]), "R": round(R, 1), "uhly": [-10, -DATA["dvere"]["uhel"]], "z": r3(g["z"])}
        for s in self.spinace:
            z = s["zona_spinace"]
            self.tel.append({"name": f"Prostor_spinace_{s['device']}", "label": f"Pomocný prostor nájezdu ovladače {s['device']}",
                             "body": {"add": [_box(z[0], z[3], z[1], z[4], z[2], z[5])]},
                             "props": {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "spinac"},
                             "vyjimka": [f"inst:{s['inst_spinac']}", f"inst:{len(self.b.inst) + s['inst_ovladac']}"] + dvere})

    def vyhodnoceni(self):
        """ISO 13857 tab. 4: mezery dveří a volba výplně stěn podle vzdálenosti od zón (výpočet; model měří ``otvory``)."""
        g = DATA["dvere"]["mezera"]
        sr_g = iso_sr(g)
        self.mezery = {"dvere_mm": g, "Sr_pozad_mm": sr_g, "zdroj": rules.ISO13857_SRC}
        walls = {"levý bok": [self.X0, self.Y0, self.Zb, self.X0 + A, self.Y1, self.Zt],
                 "pravý bok": [self.X1 - A, self.Y0, self.Zb, self.X1, self.Y1, self.Zt],
                 "záda": [self.X0, self.Y1 - A, self.Zb, self.X1, self.Y1, self.Zt],
                 "dveře": [self.X0, self.Y0, self.Zb, self.X1, self.Y0 + A, self.Zt],
                 "střecha": [self.X0, self.Y0, self.Zt, self.X1, self.Y1, self.Zt + 4]}
        pl = DATA["vyplne"]["pletivo30"]
        sr_p = iso_sr(pl["e"], pl["tvar"])
        self.volba = []
        for nm, wb in walls.items():
            ds = [box_dist(wb, z["bbox"]) for z in self.zony]
            d = min(ds) if ds else None
            ok = d is not None and d >= sr_p
            self.volba.append({"stena": nm, "vzdalenost_k_zone_mm": round(d, 1) if d is not None else None,
                               "pletivo_30_Sr_mm": sr_p, "pletivo_pripustne": ok,
                               "zvoleno": "pc4", "duvod": ("plná výplň PC 4 (výhled, odlétající části); pletivo by podle tab. 4 vyhovělo"
                                                          if ok else f"pletivo 30 × 30 by potřebovalo ≥ {sr_p:g} mm od zóny — jen plná výplň")})
            if d is not None and d < sr_g:
                self.chyby.append(f"{nm}: zóna {d:.0f} mm od stěny < Sr {sr_g:g} mm pro mezeru dveří {g:g} mm")
        for z in self.zony:
            bz = z["bbox"]
            inside = (self.X0 + A <= bz[0] and bz[3] <= self.X1 - A and self.Y0 + A <= bz[1] and bz[4] <= self.Y1 - A
                      and self.Zb <= bz[2] and bz[5] <= self.Zt - A)
            if not inside:
                self.chyby.append(f"zóna {z.get('nazev')}: obálka {bz} přesahuje vnitřek krytu — zvětšit kryt / výšku")

    # -- výstupy
    def rozhrani(self):
        fns = []
        for bl in self.blk:
            f = bl.get("fn") or {}
            fns.append({"funkce": f.get("id"), "nazev": f.get("title") or f"Blokování krytu {bl['device']}", "PLr_navrh": f.get("plr"),
                        "PL_navrh": f.get("pl"), "kategorie_navrh": f.get("category"), "kategorie_zastaveni": f.get("stopCategory"),
                        "vstupy": f.get("inputs") or [bl["device"]], "akcni_cleny": f.get("actuators"), "bezpecny_stav": f.get("safeState"),
                        "zdroj": "PLCdesk safety.functions (proposeSafety) — NÁVRH, platí jen po schválení odpovědnou osobou"
                        if f else "PLCdesk manifest bez bezpečnostní funkce — doplnit v PLCdesk (NÁVRH)"})
        return {
            "format": "plcdesk-pro-modul", "modul": "O3", "verze": 1, "id": self.ident, "generator": GEN, "nazev": self.nazev,
            "ram": {"id": self.n1.get("id"), "deska_z": self.Zb, "deska_je_dno": True},
            "obalka": [self.X0, self.Y0, self.Zb, self.X1, self.Y1, self.Zt + DATA["vyplne"]["pc4"]["t"]],
            "strany": {"predni": "dveře", "leva": "výplň PC 4", "prava": "výplň PC 4", "zadni": "výplň PC 4", "strecha": "PC 4 šrouby shora",
                       "dno": "pracovní deska N1"},
            "vyplne": self.vypln_pole, "volba_vyplne": self.volba, "mezery": self.mezery,
            "dvere": {"otvor_mm": [self.X1 - self.X0 - 2 * A, self.Hk - 2 * A], "kridlo": {"x": r3(self.d_geom["x"]), "z": r3(self.d_geom["z"]),
                      "y": self.d_geom["y"]}, "osa_pantu": {"bod": r3(self.osa + [0]), "smer": [0, 0, 1]}, "uhel_otevreni": -DATA["dvere"]["uhel"],
                      "otevirani": "ven (−y)", "panty": self.panty, "madlo": self.madlo, "zona_drahy": self.zona_dveri},
            "blokovani": [{k: v for k, v in s.items() if not k.startswith("inst_")} for s in self.spinace],
            "zony_nebezpeci": self.zony,
            "pozadavky_na_ram": self.pozadavky + [{"co": "pracovní deska N1 = dno krytu (bez otvorů mimo průchodky)", "kind": "deska"}],
            "bezpecnost": {"stav": "NÁVRH ke schválení — model neobsahuje bezpečnostní logiku; E-stop jen jako signál (modul O1)",
                           "funkce": fns, "obchazeni": DATA["obchazeni"], "norma_kryt": "ČSN EN ISO 14120 (pevný kryt jen nástrojem)",
                           "norma_otvory": rules.ISO13857_SRC, "norma_blokovani": "ČSN EN ISO 14119:2013"},
            "hmotnost_kg": self.hmotnost(),
            "zpetna_vazba": self.fb,
            "montazni_poradi": ["1 spodní příčky x se sloupky (dlouhý šroub zespodu — PŘED položením na desku)",
                                "2 spodní příčky y úhelníky, celý spodní věnec na desku, šrouby M6 zespodu deskou",
                                "3 výplně boků a zad s těsněním do drážek, horní věnec (podélníky na sloupky, příčníky úhelníky)",
                                "4 střecha šrouby M6 shora", "5 dveře (rám + výplň) na panty, doraz, madlo",
                                "6 spínač a ovladač (seřídit nájezd jazýčku, ovladač nerozebíratelně)"],
            "odhady": sorted(self.odhady), "varovani": self.varovani, "chyby": self.chyby, "zdroje": sorted(self.zdroje),
        }

    def hmotnost(self):
        m = 0.0
        for bb in (self.b, self.bd):
            m += sum(RAM["profily"]["104040"]["Q_kg_m"] * mm["L"] / 1000.0 for mm in bb.members)
        for v in self.vypln_pole:
            m += v["rozmer_mm"][0] * v["rozmer_mm"][1] * 1e-6 * DATA["vyplne"]["pc4"]["kg_m2"]
        return round(m + 0.03 * (len(self.b.inst) + len(self.bd.inst)), 1)

    def modul(self):
        dily = {}
        for bb in (self.b, self.bd):
            for k, s in bb.dily.items():
                dily.setdefault(k, s)
        osa = self.osa
        return {"typ": "O3 kryt", "tag": self.ident, "nazev": self.nazev, "dily": list(dily.values()),
                "instance": self.b.inst + self.bd.inst, "telesa": self.tel, "kabely": [],
                "skupiny": [{"name": "Dvere", "label": f"Dveře krytu {self.ident}",
                             "props": {"Konstrukce_Typ": "dil", "PLCdesk_Id": f"asm:{self.ident}-dvere",
                                       "Konstrukce_Pohyb": json.dumps({"nazev": f"dveře otevřené {DATA['dvere']['uhel']:g}°",
                                                                        "otoc": {"osa": [0, 0, 1], "bod": [osa[0], osa[1], 0.0],
                                                                                 "uhel": -DATA["dvere"]["uhel"]}}, ensure_ascii=False)}}],
                "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "O3", "PLCdesk_Id": f"asm:{self.ident}"}}


def kryt(n1: dict, zony=(), manifest=None, **kw) -> dict:
    k = Kryt(n1, zony, manifest, **kw).build()
    return {"modul": k.modul(), "rozhrani": k.rozhrani(), "kryt": k}


# --- zkušební sestava: N1 s deskou + O3 + P1 na nosném profilu uvnitř ---------------------------------------------------
def _nosnik_p1(b, x0, x1, y, z, label):
    """Nosný profil 40 × 40 pro P1 na desce (šrouby M6 zespodu do spodní drážky), záslepky čel."""
    m = b.member("104040", A, A, x1 - x0, [x0, y, z + A / 2], [0, 1, 0], [0, 0, 1], [1, 0, 0], "nosnik_p1", label)
    req = []
    for x in (x0 + 15.0, x1 - 15.0):
        _r, q = sroub_zespodu(b, x, y, z, RAM["deska"]["t"], [1, 0, 0], f"{label} → deska x {x:g}")
        req.append(dict(q, co=f"P1 nosník: otvor M6 zespodu se zahloubením x {x:g}"))
    return m, req


def zkusebni_sestava(manifest=None) -> dict:
    from . import modul_valec
    base = dict(D=800, W=600, H=900, deska=True, podpory="patky", zatizeni_kg=30, ident="N1-O3", nazev="N1 stůl 800 × 600 × 900 pod krytem O3")
    n1_0 = modul_ram.plan_ramu(**base)["rozhrani"]
    # P1 Ø32 × 100 na nosném profilu y = 300
    zb = n1_0["rozmery"]["H_horni_lic"]
    pa = modul_valec.patka_ms1(32)
    xb0, xb1, yb = 200.0, 600.0, 300.0
    pos = (xb0 + 10.0 + pa["delka"] + modul_valec.PREKRYV, yb, zb + A + pa["AH"] + modul_valec.T_DESKA)
    p1 = modul_valec.modul("-Y1", "ISO 15552", 32, 100, "patky", "nic", "deska", pos=pos, nazev="P1 -Y1 ISO 15552 Ø32×100 uvnitř krytu")
    zony = [{"nazev": f"P1 {p1['tag']} {z['nazev']}", "bbox": z["bbox"]} for z in p1["rozhrani"]["zony"]]
    o3 = kryt(n1_0, zony, manifest, ident="O3-bench")
    fx = modul_ram.Ram(800, 600, 900)
    _m, req_p1 = _nosnik_p1(fx, xb0, xb1, yb, zb, "Nosník P1 40×40")
    zs = RAM["zaslepka"]
    zk = fx.dil(_lib("Zaslepka_224040", {"add": [{"box": [-A / 2, A / 2, -A / 2, A / 2, 0, zs["t"]]}]}, "Záslepka ALUTEC 224040 PA6 (zástupná)",
                     zs["zdroj"], "obálka", typ="prislusenstvi", material="PA6", pozn=zs["pozn"], zastupny=True))
    for x, sgn in ((xb0, -1), (xb1, 1)):
        fx.put(zk, [x, yb, zb + A / 2], cols([0, sgn, 0], [0, 0, 1], [sgn, 0, 0]), "zaslepka")
    fx.finalize_members()
    reqs = [dict(q) for q in o3["rozhrani"]["pozadavky_na_ram"] if q.get("bod")] + req_p1
    n1 = modul_ram.plan_ramu(**dict(base, pozadavky=reqs, moduly=[{"nazev": "O3 kryt", "hmotnost_kg": o3["rozhrani"]["hmotnost_kg"],
                                                                    "pos": [400, 300]}]))
    fixture = {"typ": "nosník P1", "tag": "NP1", "nazev": "Nosník P1 40×40 na desce", "dily": list(fx.dily.values()), "instance": fx.inst,
               "telesa": [], "kabely": [], "skupiny": [], "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "N2"}}
    mods = [n1["moduly"][0], o3["modul"], fixture, p1]
    dily = {}
    for m in mods:
        for s in m["dily"]:
            dily.setdefault(s["key"], s)
    plan = {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": "Kryt_O3", "nazev": "Zkušební sestava O3: N1 + kryt + P1",
            "dily": list(dily.values()), "moduly": mods, "snimky_prefix": "kryt", "snimky": ["iso", "iso2", "celo", "shora", "bok"],
            "snimky_skryt": {"iso2": ["M2_strecha"], "shora": ["M2_strecha"]}}
    return {"plan": plan, "n1": n1, "o3": o3, "p1": p1, "pozadavky": reqs}


def write_rozhrani(r: dict, folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    out = []
    p = folder / f"O3_{r['o3']['rozhrani']['id']}.json"
    p.write_text(json.dumps(r["o3"]["rozhrani"], ensure_ascii=False, indent=1), encoding="utf-8")
    out.append(str(p))
    q = folder / f"N1_{r['n1']['rozhrani']['id']}.json"
    q.write_text(json.dumps(r["n1"]["rozhrani"], ensure_ascii=False, indent=1), encoding="utf-8")
    out.append(str(q))
    return out


def build_fc(r: dict, folder: Path, slot: str = SLOT, timeout: int = 1500) -> dict:
    """Plán → model (fc_ram.py) → barvy + snímky (i dveře otevřené) → kontroly ``vse`` BEZ ``--otvory-varovani`` (kryt
    je hlavním měřítkem ISO 13857)."""
    from . import bench
    plan = r["plan"]
    folder = Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    pp = folder / "plan.json"
    pp.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    rp = folder / "fc_lib_vysledek.json"
    if rp.exists():
        rp.unlink()
    res = bench._ps([bench.RUN_FC, "run", "--slot", slot, "--timeout", str(timeout), "--result", rp, HERE / "fc_ram.py", pp, folder],
                    timeout + 120)
    summ = bench._last_json(res.stdout)
    b = json.loads(rp.read_text(encoding="utf-8")) if rp.is_file() else {"ok": False, "stdout": res.stdout[-1500:], "stderr": res.stderr[-1500:]}
    b["fc"] = {k: summ.get(k) for k in ("ok", "exit_code", "timed_out", "duration_s", "error", "leftover")}
    if not b.get("model"):
        return {"ok": False, "stavba": b}
    model = Path(b["model"])
    sn = folder / "snimky"
    sn.mkdir(exist_ok=True)
    shots = {k: sn / f"kryt_{k}.png" for k in plan["snimky"]}
    shots2 = {"iso": sn / "kryt_dvere_otevrene_iso.png", "shora": sn / "kryt_dvere_otevrene_shora.png"}
    c = bench.colors_and_shots(model, b.get("soubory_dilu") or [], shots, slot=slot, shots2=shots2, skryt=plan.get("snimky_skryt"))
    rep = bench.checks(model, folder / "kontroly", slot=slot, timeout=3600, otvory_varovani=False)
    s = bench.souhrn(rep)
    nch = sum(v["chyby"] for v in s.values())
    failed = [k for k, v in s.items() if v["selhalo"]]
    return {"ok": bool(b.get("ok")) and nch == 0 and not failed, "stavba": {k: b.get(k) for k in ("ok", "chyby", "model", "objektu", "fc")},
            "barvy": c, "souhrn": {"model": str(model), "chyb": nch, "selhalo": failed, "kontroly": s,
                                   "snimky": [str(p) for p in list(shots.values()) + list(shots2.values())]}}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul O3 — ochranný kryt s dveřmi a blokovacím spínačem (zkušební sestava)")
    ap.add_argument("--manifest", help="PLCdesk_CAD.json (blokování / zámek / bezpečnostní funkce)")
    ap.add_argument("--rozhrani")
    ap.add_argument("--plan")
    ap.add_argument("--fc")
    ap.add_argument("--slot", default=SLOT)
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    man = json.loads(Path(a.manifest).read_text(encoding="utf-8")) if a.manifest else None
    r = zkusebni_sestava(man)
    ro = r["o3"]["rozhrani"]
    pr = r["n1"]["rozhrani"]["pruchody"]
    print(f"{ro['nazev']}: hmotnost {ro['hmotnost_kg']} kg, spínače {[s['typ'] for s in ro['blokovani']]}, "
          f"požadavky na rám přijato {len(pr['prijato'])} / odmítnuto {len(pr['odmitnuto'])}")
    for t in ro["chyby"] + ro["varovani"] + [f"N1 odmítl: {o['co']} — {o['duvod']}" for o in pr["odmitnuto"]]:
        print("  !", t)
    if a.plan:
        Path(a.plan).write_text(json.dumps(r["plan"], ensure_ascii=False, indent=1), encoding="utf-8")
    if a.rozhrani:
        print("\n".join(write_rozhrani(r, Path(a.rozhrani))))
    if a.fc:
        write_rozhrani(r, Path(a.fc))
        res = build_fc(r, Path(a.fc), slot=a.slot)
        print(json.dumps(res.get("souhrn", res), ensure_ascii=False, indent=1)[:8000])
        return 0 if res.get("ok") else 1
    return 0 if not ro["chyby"] and not pr["odmitnuto"] else 1


if __name__ == "__main__":
    sys.exit(main())
