"""Modul N1 — rám / stůl z profilů ALUTEC řady 40/8 (čistý Python: plán, výpočet nosnosti, smlouva rozhraní;
FreeCAD: ``fc_ram.py`` = ``fc_lib.py`` + zástupný průřez profilu).

Vstup (``plan_ramu``): rozměry D × Š (x × y), výška horního líce (pracovní deska nebo horní líc rámu), pracovní deska
ano / ne, podpory ``patky`` / ``kola``, užitné zatížení desky, moduly s hmotností a polohou (``moduly``), montážní
nosníky 40 × 80 naležato pro moduly (``nosniky`` = polohy x) a moduly P1 na nich (``p1``), požadavky modulů na rám
(``pozadavky`` = průchody kabelů / hadic — formát ``pro3d_modules`` „předání“).

Konstrukce (vše se zdrojem v ``data/ram.json``, jinak ODHAD):
* 4 sloupky 40 × 40 v rozích, horní věnec: podélníky (x) po celé délce leží NA sloupcích (dlouhý šroub svisle do jádra
  sloupku), příčníky (y) mezi podélníky vedle sloupků (dlouhý šroub vodorovně přes podélník do jádra příčníku);
  profil věnce 104040 / 104080 na výšku podle průhybu (L/1000 pod technologií);
* spodní věnec (zavětrování): příčky y mezi sloupky ve výšce z, příčky x o 40 výš (vrtání přes sloupek se nekříží);
* úhelníky 303876 (zástupné) ve spodním věnci v obou rovinách a pod podélníky v rovině x-z — ztužení rohů;
* dlouhý šroub ALUTEC = stupňovitá díra 13,5 × 8,5 + ISO 4762 M8 do jádra Ø 7,4 (20 mm záběru), zátka 220013;
* volná čela podélníků → záslepky 224040 / 224080; čela sloupků zakryje podélník a patka / kolo;
* patky (408008 / 404008) nebo kola (507508 / 517508) závitem M8 do jádra sloupku — zástupné tvary;
* pracovní deska Al (ODHAD 15 mm) zahloubenými ISO 4762 M6 do matic T v horní drážce věnce.

Výstup: plán pro ``fc_ram.py`` (díly lib_body / pro3d_parts, App::Link), ``rozhrani`` = smlouva ``N1_<id>.json``
(drážky a montážní plochy s volnými úseky, deska a závity, nosnost prvků a podpor, průchody, montážní pořadí, řezací
seznam, odhady, zdroje), ``kontrola`` (výpočty, přístup klíčem).

CLI: ``python -m plc_studio.pro3d_lib.modul_ram [--vzor maly|velky] [--D --W --H --kola --bez-desky …] [--plan P]
[--rozhrani SLOŽKA] [--fc SLOŽKA]``."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "plc_studio.pro3d_lib"

from . import spojky_mech  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data" / "ram.json").read_text(encoding="utf-8"))
NORM = spojky_mech.NORM
GEN = "pro3d_lib/modul_ram"
SLOT = "pro-n1"
A = 40.0                     # sloupek 40 × 40
I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
E = DATA["material"]["E_MPa"]
G = DATA["material"]["g"]
SRC_PROF = DATA["profily"]["_zdroj"]
SRC_KAT = "katalog ALUTEC https://www.aluteckk.cz/files/katalog-tlac-ver-cz-30102023.pdf"


# --- vektory ----------------------------------------------------------------------------------------------------------
def add(a, b, k=1.0):
    return [a[i] + k * b[i] for i in range(3)]


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def cols(ex, ey, ez):
    """Matice (řádky) z obrazů místních os — fc_lib.rot(R) / spojky_mech: global = R · local."""
    return [[ex[i], ey[i], ez[i]] for i in range(3)]


def tmul(R, v):            # Rᵀ · v
    return [sum(R[j][i] * v[j] for j in range(3)) for i in range(3)]


def r3(v):
    return [round(float(x), 3) for x in v]


def _cyl(p, d, r, h):
    return {"cyl": {"p": r3(p), "d": r3(d), "r": round(r, 3), "h": round(h, 3)}}


def _lib(key, body, nazev, zdroj, detail, typ="dil", material="", pozn="", zastupny=False, vlastni=False):
    return {"key": key, "gen": "lib_body", "body": body, "nazev": nazev, "zdroj": [zdroj] if isinstance(zdroj, str) else zdroj,
            "detail": detail, "typ": typ, "material": material, "poznamka": pozn, "zastupny": zastupny, "vlastni": vlastni}


# --- výpočty (vzorce kalkulačky výrobce, skill alutech-profily scripts/pruhyb.py / references/vypocty.md) -----------
def nosnik(L, I_cm4, W_cm3, Q_kg_m, sily=(), q_Nmm=0.0, K=1.5):
    """Prostý nosník (šroubovaný spoj ≠ vetknutí — vypocty.md §3): bodové síly [(F N, poloha a mm)], spojité q navíc
    k vlastní tíze. Průhyb ze superpozice (50 bodů), M max, σ = M / W ≤ σK / K. Vrací f_max, poloha, sigma, vyhovuje."""
    I = I_cm4 * 1e4
    qv = Q_kg_m * 1e-3 * G + q_Nmm
    best = (0.0, 0.0, 0.0)
    for k in range(1, 50):
        x = L * k / 50.0
        f = qv * x * (L ** 3 - 2 * L * x * x + x ** 3) / (24 * E * I)
        M = qv * x * (L - x) / 2
        for F, a in sily:
            a = min(max(a, 0.0), L)
            b = L - a
            f += (F * b * x * (L * L - b * b - x * x) if x <= a else F * a * (L - x) * (2 * L * x - x * x - a * a)) / (6 * E * I * L)
            M += F * b * x / L if x <= a else F * a * (L - x) / L
        if f > best[0]:
            best = (f, x, best[2])
        best = (best[0], best[1], max(best[2], M))
    sigma = best[2] / (W_cm3 * 1e3)
    sdov = DATA["material"]["sigmaK_MPa"] / K
    return {"f": round(best[0], 3), "x_f": round(best[1], 1), "M_Nmm": round(best[2], 1), "sigma": round(sigma, 2),
            "sigma_dov": round(sdov, 1), "vyhovuje_napeti": sigma <= sdov}


def vzper(F, L, I_cm4, A_cm2, beta=2.0):
    I, Ar = I_cm4 * 1e4, A_cm2 * 1e2
    Fcr = math.pi ** 2 * E * I / (beta * L) ** 2
    return {"Fcr_N": round(Fcr, 0), "beta": beta, "Lk": round(beta * L, 1), "F_N": round(F, 1),
            "bezpecnost": round(Fcr / F, 1) if F else None, "sigma_tlak": round(F / Ar, 2)}


# --- stavitel plánu ---------------------------------------------------------------------------------------------------
class Ram:
    def __init__(self, D, W, H, deska=True, podpory="patky", rada=None, zatizeni_kg=50.0, moduly=(), nosniky=(),
                 p1=(), pozadavky=(), limit=None, z_spodni=None, uhelniky=True, ident="N1", nazev=""):
        self.D, self.W, self.H = float(D), float(W), float(H)
        self.deska, self.podpory, self.uhelniky = bool(deska), podpory, uhelniky
        self.zatizeni = float(zatizeni_kg)
        self.moduly_in, self.nosniky_x, self.p1_in, self.poz = list(moduly), [float(x) for x in nosniky], list(p1), list(pozadavky)
        self.limit = float(limit or DATA["limity"]["technologie"])
        self.z_low = float(z_spodni if z_spodni is not None else DATA["spodni_ram"]["z"])
        self.ident, self.nazev = ident, nazev or f"N1 rám {D:g} × {W:g} × {H:g}"
        self.dily, self.inst, self.tel, self.members = {}, [], [], []
        self.odhady, self.zdroje, self.varovani, self.chyby = set(), {SRC_PROF, SRC_KAT}, [], []
        self.srouby, self.klice, self.montaz, self.p1_mods = [], [], [], []
        self.t_deska = DATA["deska"]["t"] if self.deska else 0.0
        self.z_top = self.H - self.t_deska
        self.rada = rada
        self.vypocet = {}
        self.boxes_extra = []      # (název, box) — deska, úhelníky, moduly: pro volné úseky drážek a přístup klíčem

    # -- díly
    def dil(self, spec):
        self.dily.setdefault(spec["key"], spec)
        return spec["key"]

    def put(self, key, pos, R, druh, props=None, skupina=None):
        it = {"model": key, "pos": r3(pos), "rot": [r3(r) for r in R], "druh": druh, "props": props or {}}
        if skupina:
            it["skupina"] = skupina
        self.inst.append(it)
        return len(self.inst) - 1

    # -- profily
    def member(self, kod, a, b, L, origin, ex, ey, ez, role, nazev):
        R = cols(ex, ey, ez)
        corners = []
        for sx in (-a / 2, a / 2):
            for sy in (-b / 2, b / 2):
                for sz in (0.0, L):
                    corners.append(add(add(add(origin, ex, sx), ey, sy), ez, sz))
        box = [min(c[k] for c in corners) for k in range(3)] + [max(c[k] for c in corners) for k in range(3)]
        m = {"kod": kod, "a": a, "b": b, "L": L, "o": origin, "R": R, "ex": ex, "ey": ey, "ez": ez, "role": role,
             "nazev": nazev, "box": [round(x, 3) for x in box], "cuts": [], "opr": [], "matice": []}
        self.members.append(m)
        return m

    def finalize_members(self):
        for i, m in enumerate(self.members):
            cl = []
            for c in m["cuts"]:
                p = tmul(m["R"], sub(c["p"], m["o"]))
                d = tmul(m["R"], c["d"])
                cl.append(_cyl(p, d, c["r"], c["h"]))
            cl.sort(key=lambda x: json.dumps(x, sort_keys=True))
            sig = hashlib.sha1(json.dumps([m["kod"], m["a"], m["b"], round(m["L"], 2), cl], sort_keys=True).encode()).hexdigest()[:6]
            key = f"ALU_{m['kod']}_{m['a']:g}x{m['b']:g}_L{m['L']:g}_{sig}"
            opr = "; ".join(sorted(set(m["opr"]))) or "bez opracování"
            self.dil(_lib(key, {"add": [{"profil": {"a": m["a"], "b": m["b"], "L": round(m["L"], 3)}}], "cut": cl},
                          f"Profil ALUTEC {m['kod']} {m['a']:g}×{m['b']:g}×{m['L']:g}", [SRC_PROF, DATA["pruřez"]["zdroj"]],
                          "obrys, drážky a jádra dle katalogu s. 4/4; vnitřek zástupný (I a hmotnost z katalogu)", typ="profil",
                          material="AlMgSi0,5 (hliník)", pozn=f"{m['nazev']}; opracování: {opr}. {DATA['pruřez']['pozn']}",
                          vlastni=True))
            m["key"] = key
            m["inst"] = self.put(key, m["o"], m["R"], "profil", {"Konstrukce_Profil": m["kod"], "Konstrukce_Delka": round(m["L"], 1),
                                                                 "Konstrukce_Opracovani": opr, "Konstrukce_Role": m["role"]})

    # -- spoje
    def dlouhy_sroub(self, m1, P0, d, t1, label):
        """Dlouhý šroub ALUTEC přes profil ``m1`` (tloušťka ve směru šroubu ``t1``) z bodu ``P0`` na jeho vnějším líci ve
        směru ``d`` do jádra 2. profilu: zahloubení 13,5 do poloviny ``t1`` (ODHAD), díra 8,5, ISO 4762 M8 × (t1/2 + 20)."""
        ds = DATA["dlouhy_sroub"]
        c = t1 / 2.0
        L = c + 20.0
        l = next(x for x in spojky_mech.delky() if x >= L - 1e-6)
        m1["cuts"].append({"p": add(P0, d, -1.0), "d": d, "r": ds["zahloubeni"] / 2, "h": c + 1.0})
        m1["cuts"].append({"p": add(P0, d, c - 0.01), "d": d, "r": ds["dira"] / 2, "h": t1 - c + 0.6})
        m1["opr"].append(f"stupňovitá díra {ds['zahloubeni']:g} × {ds['dira']:g} (dlouhý šroub)")
        seat = add(P0, d, c)
        sp = spojky_mech.spec_sroub("M8", l)
        self.dil(sp)
        R = spojky_mech.rot_z_na([-x for x in d])
        si = self.put(sp["key"], seat, R, "sroub", {"Konstrukce_Spoj": "dlouhý šroub ALUTEC " + ds["kod"]["40"] + " (ISO 4762 modelem)"})
        z = DATA["zatka"]
        zk = self.dil(_lib("Zatka_220013", {"add": [{"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": z["d"] / 2 - 0.05, "h": z["h"]}}]},
                           "Zátka 220013 d 13,5 PA6 (zástupná)", z["zdroj"], "obálka", typ="prislusenstvi", material="PA6",
                           pozn=z["pozn"], zastupny=True))
        zi = self.put(zk, add(P0, d, z["h"]), R, "zatka")
        self.odhady.add(ds["pozn_hloubky"])
        self.odhady.add(z["pozn"])
        k = NORM["ISO4762"]["rady"]["M8"]["k"]
        self.srouby.append({"spoj": label, "sroub": f"ISO 4762 M8x{l}", "zaber_mm": round(l - (t1 - c), 1), "pozadavek_mm": 12.0,
                            "klic": "SW6"})
        self.klice.append({"spoj": label, "z": add(seat, d, -(k + 0.3)), "smer": [-x for x in d], "vlastni": m1, "zatka": zi,
                           "sroub": si})
        return si

    def nut_screw(self, M, bod, along, normal, t_up, podlozka, label, druh="sroub"):
        """Šroub ISO 4762 + matice T s pružinou do drážky 40/8 (spojka V4 — délka ``delka_do_drazky``) v obecné poloze."""
        dl = spojky_mech.delka_do_drazky(M, t_up, "40/8", podlozka=podlozka)
        if not dl["ok"]:
            self.chyby.append(f"{label}: {dl['text']}")
            return None
        R = cols(along, cross(normal, along), normal)
        dz = spojky_mech.drazka("40/8")
        sp_s, sp_n = spojky_mech.spec_sroub(M, dl["l"]), spojky_mech.spec_matice_t(M, "40/8")
        self.dil(sp_s)
        self.dil(sp_n)
        hw = NORM["ISO7089"]["rady"][M]["h"] if podlozka else 0.0
        out = {}
        out["sroub"] = self.put(sp_s["key"], add(bod, normal, t_up + hw), R, druh)
        out["matice"] = self.put(sp_n["key"], add(bod, normal, -dz["ret"]), R, "matice")
        if podlozka:
            sp_w = spojky_mech.spec_podlozka(M)
            self.dil(sp_w)
            out["podlozka"] = self.put(sp_w["key"], add(bod, normal, t_up), R, "podlozka")
        self.srouby.append({"spoj": label, "sroub": f"ISO 4762 {M}x{dl['l']}", "text": dl["text"]})
        k = NORM["ISO4762"]["rady"][M]["k"]
        self.klice.append({"spoj": label, "z": add(bod, normal, t_up + hw + k + 0.3), "smer": normal, "vlastni": None,
                           "sroub": out["sroub"]})
        return out

    def uhelnik(self, C, nA, nB, mA, mB, label):
        """Úhelník 303876 (zástupný): rameno A na líci profilu ``mA`` (normála nA), rameno B na líci ``mB`` (normála nB);
        roh C = průsečík líců v ose drážek. 2 + 2 šrouby M8 do matic T 210482 s podložkou 215008."""
        u = DATA["uhelnik"]
        t, Lr, w = u["t"], u["rameno"], u["sirka"]
        hole = spojky_mech.otvor_vule("M8")
        cut = [_cyl([s, 0, -1], [0, 0, 1], hole / 2, t + 2) for s in u["srouby"]] + \
              [_cyl([-1, 0, s], [1, 0, 0], hole / 2, t + 2) for s in u["srouby"]]
        key = self.dil(_lib("Uhelnik_303876", {"add": [{"box": [0, Lr, -w / 2, w / 2, 0, t]}, {"box": [0, t, -w / 2, w / 2, 0, Lr]}],
                                               "cut": cut}, "Úhelník ALUTEC 303876 Zn 38×76 (zástupný)", u["zdroj"], "obálka",
                            material="Zn", pozn=u["pozn"], zastupny=True))
        R = cols(nB, cross(nA, nB), nA)
        self.put(key, C, R, "uhelnik", {"Konstrukce_Spoj": label})
        self.odhady.add(u["pozn"])
        self.zdroje.add(u["zdroj"])
        side = cross(nA, nB)
        for leg in ((C, add(add(C, nB, Lr), nA, t)), (C, add(add(C, nA, Lr), nB, t))):     # obálka každého ramene zvlášť
            pts = [add(p, side, s) for p in leg for s in (-w / 2, w / 2)]
            self.boxes_extra.append(("úhelník " + label, [min(p[k] for p in pts) for k in range(3)] + [max(p[k] for p in pts) for k in range(3)]))
        for s in u["srouby"]:
            self.nut_screw("M8", add(C, nB, s), nB, nA, t, True, f"{label} rameno A s={s:g}")
            self.nut_screw("M8", add(C, nA, s), nA, nB, t, True, f"{label} rameno B s={s:g}")

    # -- stavba
    def vyber_profilu(self, Ls, F_body, q):
        cands = [self.rada] if self.rada else ["104040", "104080"]
        res = []
        for kod in cands:
            p = DATA["profily"][kod]
            I, Wm = (p["Iy_cm4"], p["Wy_cm3"]) if kod == "104080" else (p["Ix_cm4"], p["Wx_cm3"])
            r = nosnik(Ls, I, Wm, p["Q_kg_m"], F_body, q)
            r.update(kod=kod, limit=round(Ls / self.limit, 3), osa="y (na výšku)" if kod == "104080" else "x")
            r["vyhovuje"] = r["f"] <= r["limit"] and r["vyhovuje_napeti"]
            for p1 in self.p1_in:                       # vodorovně od síly válce (polovina do každého podélníku)
                F = math.pi / 4 * p1["prumer"] ** 2 * 1.0 / 2.0
                rh = nosnik(Ls, p["Ix_cm4"], p["Wx_cm3"], 0.0, [(F, p1["x"] - 20.0 - A / 2)])
                if rh["f"] > Ls / self.limit or not rh["vyhovuje_napeti"]:
                    r["vyhovuje"] = False
                    r["vodorovne_nevyhovuje"] = f"{p1['tag']}: {rh['f']} mm"
            res.append(r)
            if r["vyhovuje"]:
                return kod, res
        return cands[-1], res

    def build(self):
        D, W = self.D, self.W
        # zatížení horního věnce (svisle) — deska + užitné + moduly
        m_deska = D * W * self.t_deska * 1e-9 * DATA["deska"]["hustota_kg_m3"] if self.deska else 0.0
        Ls = D - A
        q_rail = (m_deska + self.zatizeni) * G / 2.0 / D
        F_body = []
        for mo in self.moduly_in:
            yshare = 1.0 - min(max(mo["pos"][1] / W, 0.0), 1.0)
            F_body.append((mo["hmotnost_kg"] * G * max(yshare, 1 - yshare), mo["pos"][0] - A / 2))
        p1_mass = []
        for p in self.p1_in:                           # P1 se staví až po volbě profilu — hmotnost odhadem z dat modulu
            p1_mass.append(((p.get("hmotnost_kg") or 1.5) * G / 2, p["x"] - A / 2))
        kod, vyber = self.vyber_profilu(Ls, F_body + list(p1_mass), q_rail)
        prof = DATA["profily"][kod]
        h = float(prof["b"])                          # výška věnce (104080 na výšku)
        w = 40.0
        self.h = h
        self.kod = kod
        self.vypocet["vyber_podelniku"] = vyber
        z_top, zr = self.z_top, self.z_top - h
        # podpory
        if self.podpory == "kola":
            g = DATA["kola"]["geometrie"]
            z0 = g["h_celkem"]
        else:
            g = DATA["patky"]["geometrie"]
            z0 = g["h_patky"] + g["dr_volny"]
        self.z0 = z0
        Lp = zr - z0
        if Lp < self.z_low + 2 * A + 100:
            self.chyby.append(f"sloupek {Lp:.0f} mm je na spodní věnec ve výšce {self.z_low:g} krátký")
        corners = [((A / 2, A / 2), (1, 1), 0), ((D - A / 2, A / 2), (-1, 1), 90), ((D - A / 2, W - A / 2), (-1, -1), 180),
                   ((A / 2, W - A / 2), (1, -1), 270)]
        posts = []
        for (xc, yc), (sx, sy), ang in corners:
            c, s = round(math.cos(math.radians(ang))), round(math.sin(math.radians(ang)))
            m = self.member("104040", A, A, Lp, [xc, yc, z0], [c, s, 0], [-s, c, 0], [0, 0, 1], "sloupek",
                            f"sloupek ({xc:g}, {yc:g})")
            m["sx"], m["sy"], m["xc"], m["yc"] = sx, sy, xc, yc
            posts.append(m)
        front = self.member(kod, w, h, D, [0, w / 2, z_top - h / 2], [0, 1, 0], [0, 0, 1], [1, 0, 0], "podelnik", "podélník přední")
        back = self.member(kod, w, h, D, [D, W - w / 2, z_top - h / 2], [0, -1, 0], [0, 0, 1], [-1, 0, 0], "podelnik", "podélník zadní")
        # příčníky horního věnce: u sloupků + mezilehlé (rozpětí desky ≤ 600 ODHAD), ne tam, kde jsou montážní nosníky
        xs = [1.5 * A, D - 1.5 * A]
        if self.deska and not self.nosniky_x:
            n = int(math.ceil((D - 3 * A) / 600.0))
            xs += [1.5 * A + (D - 3 * A) * i / n for i in range(1, n)]
            if n > 1:
                self.odhady.add("mezilehlé příčníky pod deskou po ≤ 600 mm = ODHAD (průhyb desky nepočítán)")
        shorts = []
        for x in sorted(xs):
            m = self.member(kod, w, h, W - 2 * w, [x, w, z_top - h / 2], [1, 0, 0], [0, 0, -1], [0, 1, 0], "pricnik", f"příčník x {x:g}")
            m["x"] = x
            shorts.append(m)
        beams = []
        for x in self.nosniky_x:
            m = self.member("104080", 80.0, 40.0, W - 2 * w, [x, w, z_top - 20.0], [1, 0, 0], [0, 0, -1], [0, 1, 0], "nosnik_modulu",
                            f"montážní nosník 40×80 naležato x {x:g}")
            m["x"] = x
            beams.append(m)
        # spodní věnec
        zl = self.z_low
        lowy, lowx = [], []
        for side_x in (A / 2, D - A / 2):
            lowy.append(self.member("104040", A, A, W - 2 * A, [side_x, A, zl + A / 2], [1, 0, 0], [0, 0, -1], [0, 1, 0], "spodni_y",
                                    f"spodní příčka y x {side_x:g}"))
        for side_y in (A / 2, W - A / 2):
            lowx.append(self.member("104040", A, A, D - 2 * A, [A, side_y, zl + 1.5 * A], [0, 1, 0], [0, 0, 1], [1, 0, 0], "spodni_x",
                                    f"spodní příčka x y {side_y:g}"))
        # spoje: podélník → sloupek (svisle)
        for pm in posts:
            rail = front if pm["yc"] < W / 2 else back
            self.dlouhy_sroub(rail, [pm["xc"], pm["yc"], z_top], [0, 0, -1], h, f"podélník → sloupek ({pm['xc']:g}, {pm['yc']:g})")
        # příčníky a nosníky → podélníky (vodorovně přes podélník)
        for m in shorts:
            cores = [z_top - 20.0] if h == 40 else [z_top - 20.0, z_top - 60.0]
            for z in cores:
                self.dlouhy_sroub(front, [m["x"], 0.0, z], [0, 1, 0], w, f"příčník x {m['x']:g} → podélník přední z {z:g}")
                self.dlouhy_sroub(back, [m["x"], W, z], [0, -1, 0], w, f"příčník x {m['x']:g} → podélník zadní z {z:g}")
        for m in beams:
            for dx in (-20.0, 20.0):
                self.dlouhy_sroub(front, [m["x"] + dx, 0.0, z_top - 20.0], [0, 1, 0], w, f"nosník x {m['x']:g} → podélník přední")
                self.dlouhy_sroub(back, [m["x"] + dx, W, z_top - 20.0], [0, -1, 0], w, f"nosník x {m['x']:g} → podélník zadní")
        # spodní věnec → sloupky
        for pm in posts:
            yo = 0.0 if pm["sy"] > 0 else W
            xo = 0.0 if pm["sx"] > 0 else D
            self.dlouhy_sroub(pm, [pm["xc"], yo, zl + A / 2], [0, pm["sy"], 0], A, f"spodní příčka y → sloupek ({pm['xc']:g}, {pm['yc']:g})")
            self.dlouhy_sroub(pm, [xo, pm["yc"], zl + 1.5 * A], [pm["sx"], 0, 0], A, f"spodní příčka x → sloupek ({pm['xc']:g}, {pm['yc']:g})")
        # zavětrování úhelníky
        if self.uhelniky:
            for pm in posts:
                xi = pm["xc"] + pm["sx"] * A / 2
                yi = pm["yc"] + pm["sy"] * A / 2
                self.uhelnik([xi, pm["yc"], zl + 2 * A], [0, 0, 1], [pm["sx"], 0, 0], None, pm, f"spodní roh x-z ({pm['xc']:g}, {pm['yc']:g})")
                self.uhelnik([pm["xc"], yi, zl + A], [0, 0, 1], [0, pm["sy"], 0], None, pm, f"spodní roh y-z ({pm['xc']:g}, {pm['yc']:g})")
                self.uhelnik([xi, pm["yc"], zr], [0, 0, -1], [pm["sx"], 0, 0], None, pm, f"horní roh x-z ({pm['xc']:g}, {pm['yc']:g})")
            self.vypocet["zavetrovani"] = ("úhelníky 303876 ve spodním věnci (x-z i y-z) a pod podélníky (x-z); příčná rovina nahoře "
                                           "ztužena jen deskou / příčníky — tuhost rámu NEPOČÍTÁNA (ODHAD), diagonály nejsou")
            self.odhady.add("zavětrování: tuhost rámu (vodorovná síla, kmitání) nepočítána — při rázech / ose na rámu ověřit "
                            "(skill fem-vypocty) a případně doplnit diagonály")
        # záslepky volných čel podélníků
        zs = DATA["zaslepka"]
        zk = self.dil(_lib(f"Zaslepka_{prof['zaslepka']}", {"add": [{"box": [-w / 2, w / 2, -h / 2, h / 2, 0, zs["t"]]}]},
                           f"Záslepka ALUTEC {prof['zaslepka']} PA6 (zástupná)", zs["zdroj"], "obálka", typ="prislusenstvi",
                           material="PA6", pozn=zs["pozn"], zastupny=True))
        self.odhady.add(zs["pozn"])
        for x, sgn in ((0.0, -1), (D, 1)):
            for yc in (w / 2, W - w / 2):
                self.put(zk, [x, yc, z_top - h / 2], cols([0, sgn, 0], [0, 0, 1], [sgn, 0, 0]), "zaslepka")
        # podpory
        self.podpory_build(posts, z0)
        # deska
        if self.deska:
            self.deska_build(front, back, shorts)
        self.finalize_members()
        self.pruchody_vyhodnot()
        self.p1_build(beams)
        self.calc(posts, front, beams, m_deska)
        self.klic_kontrola()
        return self

    def podpory_build(self, posts, z0):
        if self.podpory == "kola":
            kd = DATA["kola"]
            g = kd["geometrie"]
            r, bw, H = 37.5, g["sirka_kola"], g["h_celkem"]
            body = {"add": [{"cyl": {"p": [0, -bw / 2, r], "d": [0, 1, 0], "r": r, "h": bw}},
                            {"box": [-6, 6, -bw / 2 - 6, bw / 2 + 6, r, H - 8]},
                            {"box": [-g["deska"] / 2, g["deska"] / 2, -g["deska"] / 2, g["deska"] / 2, H - 8, H]},
                            {"cyl": {"p": [0, 0, H], "d": [0, 0, 1], "r": 4.0, "h": g["dr_zavit_v_jadru"]}}]}
            for i, pm in enumerate(posts):
                kod = "517508" if i % 2 == 0 else "507508"
                k = self.dil(_lib(f"Kolo_{kod}", body, f"Kolo ALUTEC {kod} Ø75 M8 {kd[kod]['druh']} (zástupné)", kd["_zdroj"],
                                  "obálka", typ="patka", material="ocel / guma", pozn=g["pozn"], zastupny=True))
                self.put(k, [pm["xc"], pm["yc"], 0.0], I3, "kolo")
            self.odhady.add(g["pozn"])
            self.zdroje.add(kd["_zdroj"])
        else:
            pd = DATA["patky"]
            g = pd["geometrie"]
            self.patka_kod = "408008"
            r = pd[self.patka_kod]["d"] / 2
            body = {"add": [{"cyl": {"p": [0, 0, 0], "d": [0, 0, 1], "r": r, "h": g["h_patky"]}},
                            {"cyl": {"p": [0, 0, g["h_patky"]], "d": [0, 0, 1], "r": 4.0, "h": g["dr_volny"] + g["dr_zavit_v_jadru"]}}]}
            k = self.dil(_lib(f"Patka_{self.patka_kod}", body, f"Stavěcí patka ALUTEC {self.patka_kod} Ø{2 * r:g} M8 (zástupná)",
                              pd["_zdroj"], "obálka", typ="patka", material="PA6 + sklo / ocel", pozn=g["pozn"], zastupny=True))
            for pm in posts:
                self.put(k, [pm["xc"], pm["yc"], 0.0], I3, "patka")
            self.odhady.add(g["pozn"])
            self.zdroje.add(pd["_zdroj"])

    def deska_build(self, front, back, shorts):
        dd = DATA["deska"]
        t, M = dd["t"], dd["M"]
        k = NORM["ISO4762"]["rady"][M]["k"]
        cb = None
        for c in [k + 0.5 + 0.5 * i for i in range(12)]:
            if spojky_mech.delka_do_drazky(M, t - c, "40/8", podlozka=False)["ok"]:
                cb = c
                break
        if cb is None:
            self.chyby.append(f"deska {t:g} mm: žádná délka {M} do drážky")
            return
        self.deska_cb = cb
        pts = []
        n = max(2, int(math.ceil((self.D - 200) / 300.0)) + 1)
        for i in range(n):
            x = 100.0 + (self.D - 200.0) * i / (n - 1)
            pts.append(([x, 20.0], [1, 0, 0]))
            pts.append(([x, self.W - 20.0], [1, 0, 0]))
        for m in shorts:
            ny = max(1, int(round((self.W - 80) / 400.0)))
            for j in range(ny):
                pts.append(([m["x"], 40.0 + (self.W - 80.0) * (j + 0.5) / ny], [0, 1, 0]))
        self.deska_srouby = [p for p, _ in pts]
        cut = []
        for (x, y), _ in pts:
            cut.append(_cyl([x, y, t - cb], [0, 0, 1], dd["zahloubeni_d"] / 2, cb + 1))
            cut.append(_cyl([x, y, -1], [0, 0, 1], spojky_mech.otvor_vule(M) / 2, t + 2))
        self.deska_cut = cut
        self.deska_spec = {"t": t, "cb": cb}
        for (x, y), al in pts:
            self.nut_screw(M, [x, y, self.z_top], al, [0, 0, 1], t - cb, False, f"deska → věnec ({x:g}, {y:g})")
        self.zdroje.add(SRC_KAT + " s. 12/1–12/7 (matice s pružinou 210462)")
        self.odhady.add(dd["pozn"])
        self.boxes_extra.append(("pracovní deska", [0.0, 0.0, self.z_top, self.D, self.W, self.H]))

    def pruchody_vyhodnot(self):
        self.pruchody = {"prijato": [], "odmitnuto": []}
        cut = list(getattr(self, "deska_cut", []))
        for p in self.poz:
            d = float(p.get("d") or 20.0)
            x, y = p["bod"][0], p["bod"][1]
            under = [m for m in self.members if m["role"] in ("podelnik", "pricnik", "nosnik_modulu")
                     and m["box"][0] - d / 2 - 5 < x < m["box"][3] + d / 2 + 5 and m["box"][1] - d / 2 - 5 < y < m["box"][4] + d / 2 + 5]
            near = [s for s in getattr(self, "deska_srouby", []) if math.hypot(s[0] - x, s[1] - y) < d / 2 + 15]
            if p.get("kind") == "otvor_drazka" and self.deska and under:
                # E3 (celek): šroub modulu deskou do matice T drážky profilu POD deskou (stojina D1 → montážní nosník)
                cut.append(_cyl([x, y, -1], [0, 0, 1], d / 2, self.t_deska + 2))
                self.pruchody["prijato"].append({"co": p.get("co"), "bod": r3([x, y, self.H]), "d": d, "kde": "pracovní deska",
                                                 "pozn": "otvor pro šroub deskou do drážky profilu pod deskou ("
                                                         + ", ".join(sorted({m["nazev"] for m in under})) + ")"})
                continue
            if self.deska and not under and not near and d / 2 + 10 < x < self.D - d / 2 - 10 and d / 2 + 10 < y < self.W - d / 2 - 10:
                cut.append(_cyl([x, y, -1], [0, 0, 1], d / 2, self.t_deska + 2))
                zh = p.get("zahloubeni")            # O3: šroub zespodu deskou — zahloubení hlavy ze spodu desky {d, h}
                if zh:
                    cut.append(_cyl([x, y, -1], [0, 0, 1], float(zh["d"]) / 2, float(zh["h"]) + 1))
                self.pruchody["prijato"].append({"co": p.get("co"), "bod": r3([x, y, self.H]), "d": d, "kde": "pracovní deska",
                                                 "pozn": ("otvor pro šroub zespodu se zahloubením hlavy" if zh else
                                                          "otvor v desce; hrana zabrousit / průchodka (V2) — ODHAD")})
            else:
                why = ("nad profilem věnce — profily se pro kabely nevrtají (oslabení, drážky); posunout průchod do pole desky "
                       "nebo vést drážkou pod krycím profilem 230818 (│45│40│, katalog s. 16/3)") if under else \
                      ("u šroubu desky" if near else ("rám bez desky — pole rámu je otevřené, průchod není potřeba" if not self.deska
                                                      else "mimo desku / u okraje"))
                self.pruchody["odmitnuto"].append({"co": p.get("co"), "bod": r3(p["bod"]), "d": d, "duvod": why})
        if self.deska:
            dd = DATA["deska"]
            key = f"Deska_{self.D:g}x{self.W:g}x{dd['t']:g}_" + hashlib.sha1(json.dumps(cut, sort_keys=True).encode()).hexdigest()[:6]
            self.dil(_lib(key, {"add": [{"box": [0, self.D, 0, self.W, 0, dd["t"]]}], "cut": cut},
                          f"Pracovní deska {dd['material']} {self.D:g}×{self.W:g}×{dd['t']:g}", ["ODHAD — vlastní díl (data/ram.json deska)"],
                          "tvar", typ="dil", material=dd["material"], pozn=dd["pozn"], vlastni=True))
            self.deska_inst = self.put(key, [0, 0, self.z_top], I3, "deska", {"Konstrukce_Role": "pracovni_deska"})
            for kl in self.klice:                    # deska zakrývá svislé šrouby věnce → přístup jen před montáží desky
                if kl["smer"][2] > 0.5 and kl["z"][2] < self.z_top:
                    kl["deska"] = True

    def p1_build(self, beams):
        if not self.p1_in:
            return
        from . import modul_valec
        for i, p in enumerate(self.p1_in):
            bm = min(beams, key=lambda m: abs(m["x"] - p["x"]))
            pa = modul_valec.patka_ms1(p["prumer"])
            pos = (bm["x"] + p.get("drazka", -20.0), 40.0 + p.get("y0", 30.0) + pa["delka"] + modul_valec.PREKRYV,
                   self.z_top + pa["AH"] + modul_valec.T_DESKA)
            m = modul_valec.modul(p["tag"], "ISO 15552", p["prumer"], p["zdvih"], "patky", "nic", "deska", pos=pos,
                                  rot=modul_valec.RZ90, nazev=f"P1 {p['tag']} ISO 15552 Ø{p['prumer']}×{p['zdvih']} na nosníku x {bm['x']:g}")
            self.p1_mods.append(m)
            ob = m["rozhrani"]["obalka"]
            self.boxes_extra.append((m["nazev"], ob))

    def calc(self, posts, front, beams, m_deska):
        prof = DATA["profily"][self.kod]
        m_prof = sum(DATA["profily"][m["kod"]]["Q_kg_m"] * m["L"] / 1000.0 for m in self.members)
        m_p1 = sum((m["rozhrani"].get("hmotnost_kg") or 0) for m in self.p1_mods)
        m_mod = sum(mo["hmotnost_kg"] for mo in self.moduly_in)
        m_tot = m_prof + m_deska + m_p1 + m_mod + self.zatizeni + 1.5 * len(self.inst) * 0.02
        self.hmotnost = {"profily_kg": round(m_prof, 2), "deska_kg": round(m_deska, 2), "moduly_kg": round(m_mod + m_p1, 2),
                         "uzitne_kg": self.zatizeni, "celkem_kg": round(m_tot, 1),
                         "pozn": "spojovací materiál a příslušenství odhadem 0,03 kg / kus; hmotnost profilů z katalogu (kg/m)"}
        # podpory: na 3 ze 4 (nerovnost podlahy — prislusenstvi.md §3)
        per = m_tot / 3.0
        if self.podpory == "kola":
            un = DATA["kola"]["517508"]["unosnost_kg"]
            kod = "517508 / 507508"
        else:
            un = DATA["patky"][self.patka_kod]["unosnost_kg"]
            kod = self.patka_kod
        self.vypocet["podpory"] = {"kod": kod, "na_podporu_kg": round(per, 1), "unosnost_kg": un, "vyhovuje": per <= un,
                                   "pozn": "celá hmotnost na 3 podpory ze 4 (skill alutech-profily prislusenstvi.md §3)"}
        if per > un:
            self.chyby.append(f"podpory {kod}: {per:.0f} kg na podporu > {un} kg")
        # sloupek na vzpěr (β = 2 — volný konec, nejhorší případ; spodní věnec a úhelníky ho zkracují)
        pp = DATA["profily"]["104040"]
        vz = vzper(per * G, posts[0]["L"], pp["Ix_cm4"], pp["A_cm2"], 2.0)
        vz["vyhovuje"] = (vz["bezpecnost"] or 99) >= 3.0
        self.vypocet["sloupek_vzper"] = dict(vz, pozn="Euler, β = 2 (konzola) — konzervativně; požadavek bezpečnosti ≥ 3 (ODHAD)")
        # vodorovná síla modulů P1 do podélníku (síla ve směru osy nosníku → ohyb podélníku v ose x profilu)
        hz = []
        for m in self.p1_mods:
            F = m["rozhrani"]["sily"]["F_ven_10bar_N"] / 2.0   # nosník je osově tuhý a přišroubovaný k oběma podélníkům
            x = m["placement"]["pos"][0]
            I = prof["Ix_cm4"]
            r = nosnik(self.D - A, I, prof["Wx_cm3"], 0.0, [(F, x - A / 2)])
            r.update(modul=m["tag"], F_N=F, limit=round((self.D - A) / self.limit, 3),
                     pozn="polovina síly válce při 10 bar (P1 rozhrani.sily, ODHAD max.; montážní nosník osově tuhý, spojen s oběma podélníky) do podélníku, ohyb vodorovně (osa x); "
                          "vlastní tíha nepůsobí v tomto směru")
            r["vyhovuje"] = r["f"] <= r["limit"] and r["vyhovuje_napeti"]
            hz.append(r)
            if not r["vyhovuje"]:
                self.varovani.append(f"podélník: vodorovný průhyb od {m['tag']} {r['f']} mm > {r['limit']} mm — přesunout nosník ke sloupku / diagonála")
        self.vypocet["podelnik_vodorovne"] = hz
        # montážní nosník svisle (moduly P1 jako síla uprostřed)
        bn = []
        for b in beams:
            Fp = sum((m["rozhrani"].get("hmotnost_kg") or 0) * G for m in self.p1_mods if abs(m["placement"]["pos"][0] - b["x"]) < 60)
            p8 = DATA["profily"]["104080"]
            r = nosnik(b["L"], p8["Ix_cm4"], p8["Wx_cm3"], p8["Q_kg_m"], [(Fp, b["L"] / 2)])
            r.update(prvek=b["nazev"], F_N=round(Fp, 1), limit=round(b["L"] / self.limit, 3), osa="x (naležato, ohyb ve směru 40)")
            r["vyhovuje"] = r["f"] <= r["limit"]
            bn.append(r)
        self.vypocet["nosniky_modulu"] = bn
        sel = [r for r in self.vypocet["vyber_podelniku"] if r["kod"] == self.kod][0]
        if sel["f"] > sel["limit"] or not sel["vyhovuje_napeti"]:
            self.varovani.append(f"podélník {self.kod}: svislý průhyb {sel['f']} mm > L/{self.limit:g} = {sel['limit']} mm")
        # dovolené přídavné zatížení podélníku uprostřed do limitu (smlouva)
        I = prof["Iy_cm4"] if self.kod == "104080" else prof["Ix_cm4"]
        L = self.D - A
        f_res = max(sel["limit"] - sel["f"], 0.0)
        self.F_dov_podelnik = round(f_res * 48 * E * I * 1e4 / L ** 3, 0)

    def klic_kontrola(self):
        """Přístup klíčem: úsečka v ose šroubu od hlavy ven (DATA klic.delka) nesmí projít jiným dílem (obálky profilů,
        desky, úhelníků, modulů); vlastní profil s zahloubením se vynechá. Svislé šrouby pod deskou = montážní pořadí."""
        L = DATA["klic"]["delka"]
        self.klic_vysledky = []
        for kl in self.klice:
            blocked = []
            pts = [add(kl["z"], kl["smer"], L * k / 30.0) for k in range(1, 31)]
            for m in self.members:
                if m is kl.get("vlastni"):
                    continue
                b = m["box"]
                if any(b[0] + 0.5 < p[0] < b[3] - 0.5 and b[1] + 0.5 < p[1] < b[4] - 0.5 and b[2] + 0.5 < p[2] < b[5] - 0.5 for p in pts):
                    blocked.append(m["nazev"])
            for nm, b in self.boxes_extra:
                if any(b[0] + 0.5 < p[0] < b[3] - 0.5 and b[1] + 0.5 < p[1] < b[4] - 0.5 and b[2] + 0.5 < p[2] < b[5] - 0.5 for p in pts):
                    blocked.append(nm)
            stav = "volno" if not blocked else ("před montáží desky" if set(blocked) <= {"pracovní deska"} else "blokováno")
            self.klic_vysledky.append({"spoj": kl["spoj"], "stav": stav, "prekazky": sorted(set(blocked))})
            if stav == "blokováno":
                self.chyby.append(f"přístup klíčem: {kl['spoj']} — {', '.join(sorted(set(blocked)))}")

    # -- smlouva: volné úseky drážek
    def plochy(self):
        out = []
        boxes = [(m["nazev"], m["box"]) for m in self.members] + self.boxes_extra
        holes = []
        for m in self.members:
            for c in m["cuts"]:
                holes.append(c["p"])
        nuts = [it["pos"] for it in self.inst if it["druh"] == "matice"]
        for m in self.members:
            a, b, L = m["a"], m["b"], m["L"]
            faces = [(m["ex"], a / 2, m["ey"], b), ([-x for x in m["ex"]], a / 2, m["ey"], b),
                     (m["ey"], b / 2, m["ex"], a), ([-x for x in m["ey"]], b / 2, m["ex"], a)]
            for n, off, lat, width in faces:
                n_slots = int(round(width / 40.0))
                for j in range(n_slots):
                    lo = -width / 2 + 20 + 40 * j
                    p0 = add(add(m["o"], n, off), lat, lo)
                    p1 = add(p0, m["ez"], L)
                    blocked = []
                    for nm, bx in boxes:
                        if nm == m["nazev"]:
                            continue
                        # deska / díl přiložený k líci a překrývající osu drážky
                        s_vals = []
                        ok = True
                        for kk in range(3):
                            if abs(n[kk]) > 0.5:
                                pl = p0[kk]
                                lo_, hi_ = bx[kk], bx[kk + 3]
                                if n[kk] > 0 and not (lo_ - 0.6 <= pl <= lo_ + 0.6 or (lo_ < pl < hi_)):
                                    ok = False
                                if n[kk] < 0 and not (hi_ - 0.6 <= pl <= hi_ + 0.6 or (lo_ < pl < hi_)):
                                    ok = False
                            elif abs(m["ez"][kk]) > 0.5:
                                s_vals = [(bx[kk] - p0[kk]) * m["ez"][kk], (bx[kk + 3] - p0[kk]) * m["ez"][kk]]
                            else:
                                if not (bx[kk] - 4 < p0[kk] < bx[kk + 3] + 4):
                                    ok = False
                        if ok and s_vals:
                            blocked.append((min(s_vals), max(s_vals), nm))
                    for h in holes + nuts:
                        dl = sub(h, p0)
                        lat_d = [dl[k] - dot(dl, m["ez"]) * m["ez"][k] for k in range(3)]
                        if abs(dot(lat_d, n)) < 13 and math.sqrt(max(dot(lat_d, lat_d) - dot(lat_d, n) ** 2, 0)) < 5:
                            s = dot(dl, m["ez"])
                            blocked.append((s - 15, s + 15, "díra / matice"))
                    free, cur = [], 0.0
                    for s0, s1, _ in sorted(blocked):
                        if s0 > cur + 30:
                            free.append([round(cur, 1), round(s0, 1)])
                        cur = max(cur, s1)
                    if L > cur + 30:
                        free.append([round(cur, 1), round(L, 1)])
                    if free:
                        out.append({"prvek": m["nazev"], "profil": m["kod"], "normala": r3(n), "osa_od": r3(p0), "osa_do": r3(p1),
                                    "smer": r3(m["ez"]), "volne_useky_mm": free, "drazka": "40/8",
                                    "matice": "s pružinou 210442 / 210452 / 210462 / 210482 (M4–M8), vkládá se do hotového rámu",
                                    "role": m["role"], "profil80": m["role"] == "nosnik_modulu"})
        return out

    def rozhrani(self):
        prof = DATA["profily"][self.kod]
        rez = {}
        for m in self.members:
            k = (m["kod"], round(m["L"], 1), "; ".join(sorted(set(m["opr"]))) or "bez opracování", m["role"])
            rez.setdefault(k, []).append(m["nazev"])
        mont = ["1 spodní příčky y → sloupky (dlouhý šroub přes sloupek, klíč SW6 zvenku)",
                "2 spodní příčky x → sloupky (o 40 mm výš — vrtání se nekříží)",
                "3 podélníky na sloupky (svislý dlouhý šroub shora)",
                "4 příčníky / montážní nosníky mezi podélníky (dlouhý šroub zvenku přes podélník)",
                "5 úhelníky (matice s pružinou natočením do drážky hotového rámu)",
                "6 patky / kola do jádra sloupků", "7 záslepky čel podélníků, zátky děr 220013"]
        if self.deska:
            mont.append("8 pracovní deska NAKONEC — svislé šrouby podélník → sloupek jsou pod ní (utáhnout před deskou)")
        return {
            "format": "plcdesk-pro-modul", "modul": "N1", "verze": 1, "id": self.ident, "generator": GEN, "nazev": self.nazev,
            "rozmery": {"D": self.D, "W": self.W, "H_horni_lic": self.H, "z_horni_lic_ramu": self.z_top, "deska_t": self.t_deska,
                        "spodni_venec_z": self.z_low, "podpory": self.podpory, "souradnice": "x = délka, y = šířka (y 0 = přední strana), z nahoru, podlaha z 0"},
            "profily": {"sloupek": "104040", "venec": self.kod + (" na výšku" if self.kod == "104080" else ""),
                        "nosnik_modulu": "104080 naležato" if self.nosniky_x else None, "drazka": "40/8", "zdroj": SRC_PROF},
            "plochy": self.plochy(),
            "deska": ({"z_lic": self.H, "t": self.t_deska, "material": DATA["deska"]["material"],
                       "zavity": {"M6": "≥ 9 mm (1,5·d, Al)", "M8": "≥ 12 mm (1,5·d, Al)"},
                       "srouby_desky": [r3(p + [self.H]) for p in getattr(self, "deska_srouby", [])],
                       "odstup_od_sroubu_mm": 15, "pozn": "závity pro moduly = požadavek na rám (díra se vyvrtá podle modulu); "
                                                          "deska je ODHAD tloušťky a materiálu"} if self.deska else None),
            "nosnost": {"podelnik_svisle": [r for r in self.vypocet["vyber_podelniku"] if r["kod"] == self.kod][0],
                        "podelnik_F_dov_uprostred_N": self.F_dov_podelnik,
                        "podelnik_vodorovne": self.vypocet.get("podelnik_vodorovne"),
                        "nosniky_modulu": self.vypocet.get("nosniky_modulu"), "sloupek_vzper": self.vypocet["sloupek_vzper"],
                        "podpory": self.vypocet["podpory"], "limit": f"L/{self.limit:g}", "limit_zdroj": DATA["limity"]["zdroj"],
                        "spoje": "únosnost spojů výrobce NEUVÁDÍ (spoje.md §0) — šroubovaný spoj počítán jako kloub (prostý nosník)",
                        "zavetrovani": self.vypocet.get("zavetrovani"),
                        "data": f"profil {self.kod}: Ix {prof['Ix_cm4']} / Iy {prof['Iy_cm4']} cm⁴, {prof['Q_kg_m']} kg/m — {SRC_PROF}"},
            "hmotnost": self.hmotnost,
            "pruchody": self.pruchody,
            "klic": self.klic_vysledky,
            "montazni_poradi": mont,
            "rezaci_seznam": [{"profil": k[0], "delka_mm": k[1], "kusu": len(v), "opracovani": k[2], "role": k[3], "oznaceni": v} for k, v in sorted(rez.items())],
            "spojovaci_material": self._bom(),
            "odhady": sorted(self.odhady), "varovani": self.varovani, "chyby": self.chyby, "zdroje": sorted(self.zdroje),
        }

    def _bom(self):
        cnt = {}
        for it in self.inst:
            if it["druh"] == "profil":
                continue
            nm = self.dily[it["model"]]["nazev"]
            cnt[nm] = cnt.get(nm, 0) + 1
        return [{"polozka": k, "kusu": v} for k, v in sorted(cnt.items())]

    def plan(self):
        mod = {"typ": "N1 rám", "tag": self.ident, "nazev": self.nazev, "dily": list(self.dily.values()), "instance": self.inst,
               "telesa": self.tel, "kabely": [], "skupiny": [],
               "props": {"Konstrukce_Generator": GEN, "Konstrukce_Modul": "N1", "PLCdesk_Id": f"asm:{self.ident}"}}
        mods = [mod] + self.p1_mods
        dily = {}
        for m in mods:
            for s in m["dily"]:
                dily.setdefault(s["key"], s)
        return {"format": "pro3d-lib-plan", "verze": 1, "generator": GEN, "model": "Ram", "nazev": self.nazev,
                "dily": list(dily.values()), "moduly": mods, "snimky_prefix": "ram", "snimky": ["iso", "iso2", "celo", "shora", "bok"]}


def plan_ramu(**kw) -> dict:
    r = Ram(**kw).build()
    p = r.plan()
    p["rozhrani"] = r.rozhrani()
    p["kontrola"] = {"srouby": r.srouby, "vypocet": r.vypocet, "chyby": r.chyby, "varovani": r.varovani}
    return p


VZORY = {
    "maly": dict(D=800, W=600, H=900, deska=True, podpory="patky", zatizeni_kg=50, ident="N1-maly",
                 nazev="N1 stůl 800 × 600 × 900 s deskou, patky",
                 moduly=[{"nazev": "modul A (ODHAD 8 kg)", "hmotnost_kg": 8.0, "pos": [400, 300]}],
                 pozadavky=[{"co": "průchod kabelu snímače M12 (Ø 15)", "bod": [250, 300, 900], "d": 25},
                            {"co": "průchod hadice nad podélníkem", "bod": [400, 20, 900], "d": 20}]),
    "velky": dict(D=1500, W=800, H=900, deska=False, podpory="kola", zatizeni_kg=30, ident="N1-velky",
                  nazev="N1 rám 1500 × 800 × 900 na kolech, nosníky 40×80 s moduly P1",
                  nosniky=[300, 1330],
                  p1=[{"tag": "-Y1", "prumer": 32, "zdvih": 100, "x": 300, "hmotnost_kg": 1.0},
                      {"tag": "-Y2", "prumer": 50, "zdvih": 80, "x": 1330, "hmotnost_kg": 2.0}]),
}


def write_rozhrani(plan: dict, folder: Path) -> list[str]:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / f"N1_{plan['rozhrani']['id']}.json"
    p.write_text(json.dumps(plan["rozhrani"], ensure_ascii=False, indent=1), encoding="utf-8")
    out = [str(p)]
    for m in plan["moduly"][1:]:
        if "rozhrani" in m:
            q = folder / f"P1_{m['tag'].lstrip('-')}.json"
            q.write_text(json.dumps(m["rozhrani"], ensure_ascii=False, indent=1), encoding="utf-8")
            out.append(str(q))
    return out


def build_fc(plan: dict, folder: Path, slot: str = SLOT, timeout: int = 1200) -> dict:
    """Plán → model (fc_ram.py) → barvy + snímky → kontroly ``vse`` (stejně jako ``bench.build_and_check``)."""
    from . import bench
    folder = Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    pp = folder / "plan.json"
    pp.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    rp = folder / "fc_lib_vysledek.json"
    if rp.exists():
        rp.unlink()
    r = bench._ps([bench.RUN_FC, "run", "--slot", slot, "--timeout", str(timeout), "--result", rp, HERE / "fc_ram.py", pp, folder],
                  timeout + 120)
    summ = bench._last_json(r.stdout)
    b = json.loads(rp.read_text(encoding="utf-8")) if rp.is_file() else {"ok": False, "stdout": r.stdout[-1500:], "stderr": r.stderr[-1500:]}
    b["fc"] = {k: summ.get(k) for k in ("ok", "exit_code", "timed_out", "duration_s", "error", "leftover")}
    if not b.get("model"):
        return {"ok": False, "stavba": b}
    model = Path(b["model"])
    sn = folder / "snimky"
    sn.mkdir(exist_ok=True)
    shots = {k: sn / f"{plan.get('snimky_prefix', 'ram')}_{k}.png" for k in plan.get("snimky") or ("iso",)}
    c = bench.colors_and_shots(model, b.get("soubory_dilu") or [], shots, slot=slot)
    rep = bench.checks(model, folder / "kontroly", slot=slot)
    s = bench.souhrn(rep)
    nch = sum(v["chyby"] for v in s.values())
    failed = [k for k, v in s.items() if v["selhalo"]]
    return {"ok": bool(b.get("ok")) and nch == 0 and not failed, "stavba": {k: b.get(k) for k in ("ok", "chyby", "model", "objektu", "fc")},
            "barvy": c, "souhrn": {"model": str(model), "chyb": nch, "selhalo": failed, "kontroly": s, "snimky": [str(p) for p in shots.values()]}}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Modul N1 — rám / stůl z profilů ALUTEC (plán; volitelně FreeCAD + kontroly)")
    ap.add_argument("--vzor", choices=sorted(VZORY), help="zkušební rám (maly = 800×600 deska + patky, velky = 1500×800 kola + P1)")
    ap.add_argument("--D", type=float, default=800)
    ap.add_argument("--W", type=float, default=600)
    ap.add_argument("--H", type=float, default=900)
    ap.add_argument("--bez-desky", action="store_true")
    ap.add_argument("--kola", action="store_true")
    ap.add_argument("--zatizeni", type=float, default=50.0)
    ap.add_argument("--plan")
    ap.add_argument("--rozhrani")
    ap.add_argument("--fc")
    ap.add_argument("--slot", default=SLOT)
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    kw = dict(VZORY[a.vzor]) if a.vzor else dict(D=a.D, W=a.W, H=a.H, deska=not a.bez_desky,
                                               podpory="kola" if a.kola else "patky", zatizeni_kg=a.zatizeni)
    plan = plan_ramu(**kw)
    roz = plan["rozhrani"]
    print(f"{roz['nazev']}: věnec {roz['profily']['venec']}, hmotnost {roz['hmotnost']['celkem_kg']} kg, "
          f"průhyb podélníku {roz['nosnost']['podelnik_svisle']['f']} mm (limit {roz['nosnost']['podelnik_svisle']['limit']})")
    for t in plan["kontrola"]["chyby"] + plan["kontrola"]["varovani"]:
        print("  !", t)
    if a.plan:
        Path(a.plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.rozhrani:
        print("\n".join(write_rozhrani(plan, Path(a.rozhrani))))
    if a.fc:
        write_rozhrani(plan, Path(a.fc))
        res = build_fc(plan, Path(a.fc), slot=a.slot)
        print(json.dumps(res.get("souhrn", res), ensure_ascii=False, indent=1)[:6000])
        return 0 if res.get("ok") else 1
    return 0 if not plan["kontrola"]["chyby"] else 1


if __name__ == "__main__":
    sys.exit(main())
