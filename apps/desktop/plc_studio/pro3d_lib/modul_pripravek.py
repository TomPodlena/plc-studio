"""Modul T1 — přípravek se zkoušeným dílem a válci P1 (kód, bez FreeCADu; stavbu dělá ``celek`` přes ``fc_lib``).

Zadání PLCdesk obálku zkoušeného dílu NEOBSAHUJE → parametr ``dil`` {L, W, H}, výchozí ODHAD 200 × 150 × 80 mm
(„rozměr dílu doplní konstruktér“). Válce z manifestu dostanou roli z popisu zařízení (``role_valce``):
upínací (upín / clamp / Spann), těsnicí hlava (těsnicí / seal / Dichtkopf), zdvih (zdvih / lift / Hub), jinak ostatní.
Upínací a těsnicí válce míří osou kolmo na plochu dílu a stojí na konzolách (profil 40 × 40 se záslepkami, šrouby zespodu
deskou N1 — stejná spojka jako ``StulBezDopravniku``); ostatní zůstávají v mřížce stolu. Geometrie přípravku (ODHAD rozměrů):
základová deska Al, 2 dosedací lišty, 2 středicí kolíky, zástupný díl (``Konstrukce_Typ = pomocny``), zástupné čelisti na
pístnici, zóna vkládání dílu shora (``Konstrukce_Zona = vkladani``). Zdvih válce končí 1 mm před plochou dílu (plný zdvih).
"""
from __future__ import annotations

import re
import unicodedata

from . import modul_kryt as mk
from . import modul_valec, spojky_mech
from .modul_ram import cols

GEN = "pro3d_lib/modul_pripravek"
DIL_VYCHOZI = {"L": 200.0, "W": 150.0, "H": 80.0}
DIL_POZN = "rozměr dílu doplní konstruktér (zadání PLCdesk obálku dílu neobsahuje) — ODHAD"
T_PL = 20.0        # ODHAD — tloušťka základové desky přípravku (Al 6082, závit M6 ≥ 1,5 d)
PRESAH = 30.0      # ODHAD — přesah desky za obrys dílu
LISTA_B = 20.0     # ODHAD — šířka dosedací lišty
LISTA_H_MIN = 5.0  # ODHAD — min. výška lišty
PAD = 15.0         # ODHAD — délka zástupné čelisti / těsnicí hlavy na pístnici
PAD_W = 30.0       # ODHAD — šířka čelisti
MEZERA = 1.0       # mm mezi čelistí a dílem při plném zdvihu
KOLIK_D = 8.0      # ODHAD — Ø středicího kolíku
ZONA_VKLADANI = 150.0   # ODHAD — výška zóny vkládání nad dílem

ROLE_UPIN, ROLE_TESN, ROLE_ZDVIH, ROLE_OST = "upinaci", "tesnici", "zdvih", "ostatni"
ROLE_TEXT = {ROLE_UPIN: "upínací", ROLE_TESN: "těsnicí hlava", ROLE_ZDVIH: "zdvih", ROLE_OST: "ostatní"}
_RE = [(ROLE_TESN, re.compile(r"tesnic|tesneni|seal|dichtkopf|dichtstopfen|dichtung")),
       (ROLE_UPIN, re.compile(r"upin|clamp|spann|klemm")),
       (ROLE_ZDVIH, re.compile(r"zdvih|lift|\bhub\b|heben"))]


def _bez(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(c) != "Mn")


def role_valce(desc: str) -> str:
    """Role válce z popisu zařízení (cs / en / de); těsnicí má přednost před upínací (tesnost přístroje není těsnění)."""
    t = _bez(desc)
    for r, rx in _RE:
        if rx.search(t):
            return r
    return ROLE_OST


def dil_obalka(dil: dict | None = None) -> dict:
    d = dict(DIL_VYCHOZI)
    d.update({k: float(v) for k, v in (dil or {}).items() if k in d and float(v) > 0})
    return d


def _smery(role_list):
    """Přiřazení světových stran: upínací ±x střídavě, těsnicí ±y střídavě; další na téže straně se posunou po 60 mm."""
    stran = {ROLE_UPIN: [(1, 0), (-1, 0)], ROLE_TESN: [(0, 1), (0, -1)]}
    cnt, out = {ROLE_UPIN: 0, ROLE_TESN: 0}, []
    for r in role_list:
        i = cnt[r]
        cnt[r] += 1
        d = stran[r][i % 2]
        out.append((d, 80.0 * (i // 2) * (1 if (i // 2) % 2 == 0 else -1)))
    return out


def vzdalenost_zad(zdvih: float, tip: float) -> float:
    """Vzdálenost počátku válce od plochy dílu při plném zdvihu: špička zasunuté pístnice + čelist + zdvih + mezera."""
    return tip + PAD + zdvih + MEZERA


def rozmer_vlevo(zdvih: float, tip: float, pred: float = 54.0) -> float:
    """Jak daleko od plochy dílu sahá konzola válce dozadu (počátek válce − začátek profilu)."""
    return vzdalenost_zad(zdvih, tip) + pred


def _rot(d):
    return cols([d[0], d[1], 0.0], [-d[1], d[0], 0.0], [0.0, 0.0, 1.0])


def _box_telo(id_, label, box, props, cut=None, add=None):
    x0, x1, y0, y1, z0, z1 = box
    return {"name": id_, "label": label, "body": {"add": [{"box": [x0, x1, y0, y1, z0, z1]}] + (add or []), "cut": cut or []},
            "props": dict(props, PLCdesk_Id=f"T1:{id_}")}


def sonda_valce(norma, pr, zd):
    """Špička zasunuté pístnice (mm od počátku v ose) a výška osy nad dosedací rovinou profilu (A + AH + T_DESKA)."""
    pa = modul_valec.patka_ms1(pr)
    m = modul_valec.modul("-T", norma, pr, zd, "patky", "nic", "deska", pos=[0.0, 0.0, 100.0], rot=modul_valec.RZ90, profil=40)
    return float(m["rozhrani"]["obalka"][4]), pa


def postav(fx, zk, valce, stred, Hd, t_deska, A, dil=None, role_map=None):
    """Postaví přípravek ve ``fx`` (Ram) kolem ``stred`` = (cx, cy). ``valce`` = [(tag, norma, pr, zd, pa, spec)], ``role_map``
    tag → role. Vrací slovník: moduly, tel, zony, boxes, otvory, rozhrani, varovani, chyby."""
    D = dil_obalka(dil)
    cx, cy = float(stred[0]), float(stred[1])
    L, W, H = D["L"], D["W"], D["H"]
    role_map = role_map or {}
    sel = [v for v in valce if role_map.get(v[0]) in (ROLE_UPIN, ROLE_TESN)]
    out = {"moduly": [], "tel": [], "zony": [], "boxes": [], "otvory": [], "varovani": [], "chyby": [], "valce": [], "odhady": [],
           "kotvy_desky": []}
    # výška osy válce nad lícem desky: profil A + výška patky + deska pod patky
    sm = _smery([role_map[v[0]] for v in sel])
    ax_z = Hd + A + sel[0][4]["AH"] + modul_valec.T_DESKA if sel else Hd + 80.0
    h_l = max(LISTA_H_MIN, ax_z - H / 2 - (Hd + T_PL))          # lišty zvednou díl tak, aby osa válce byla ve středu výšky dílu
    z_dil0 = Hd + T_PL + h_l
    x0p, x1p, y0p, y1p = cx - L / 2 - PRESAH, cx + L / 2 + PRESAH, cy - W / 2 - PRESAH, cy + W / 2 + PRESAH
    # základová deska + závity pro šrouby zespodu deskou N1 (4 × M6 u rohů)
    cb = float(mk.NORM["ISO4762"]["rady"]["M6"]["k"])
    sx = [(x0p + 15.0, y0p + 15.0), (x1p - 15.0, y0p + 15.0), (x0p + 15.0, y1p - 15.0), (x1p - 15.0, y1p - 15.0)]
    cut = [{"cyl": {"p": [x, y, Hd - 1.0], "d": [0, 0, 1], "r": spojky_mech.zavit_otvor("M6") / 2, "h": T_PL * 0.75}} for x, y in sx]
    out["tel"].append(_box_telo("deska", f"Základová deska přípravku T1 (Al, t {T_PL:g}, ODHAD)", [x0p, x1p, y0p, y1p, Hd, Hd + T_PL],
                                {"Konstrukce_Typ": "dil", "Konstrukce_Material": "hliník 6082 (ODHAD)",
                                 "Konstrukce_Poznamka": "rozměry ODHAD; 4 × M6 se šrouby zespodu deskou N1"}, cut=cut))
    for i, (x, y) in enumerate(sx):
        r_ = spojky_mech.sroub_do_zavitu("M6", [x, y, Hd - t_deska + cb], False, t_deska - cb, T_PL * 0.75, "hlinik")
        if not r_["ok"]:
            out["chyby"].append("šroub desky přípravku: " + r_["text"])
            continue
        out.setdefault("srouby", []).append(r_)
        out["otvory"].append({"bod": [x, y, Hd], "d": spojky_mech.otvor_vule("M6"), "zahloubeni": {"d": mk.NORM["ISO4762"]["rady"]["M6"]["dk"] + 1.0, "h": cb},
                              "co": f"přípravek T1: otvor M6 zespodu se zahloubením ({x:.0f}, {y:.0f})", "kind": "otvor_sroub"})
    # hnízdo: 2 lišty (podél y) + 2 kolíky u plochy +y
    for sg, nm in ((-1, "L"), (1, "P")):
        xl = cx + sg * (L / 2 - LISTA_B)
        out["tel"].append(_box_telo(f"lista_{nm}", f"Dosedací lišta {nm} (Al, ODHAD)", [xl - LISTA_B / 2, xl + LISTA_B / 2, cy - W / 2 + 10, cy + W / 2 - 10, Hd + T_PL, z_dil0],
                                    {"Konstrukce_Typ": "dil", "Konstrukce_Material": "hliník (ODHAD)",
                                     "Konstrukce_Poznamka": "výška lišty tak, aby osa upínacích válců byla ve středu výšky dílu — ODHAD"}))
    for sg, nm in ((-1, "L"), (1, "P")):
        kx, ky = cx + sg * L / 4, cy + W / 2 + KOLIK_D / 2 + MEZERA
        out["tel"].append(_box_telo(f"kolik_{nm}", f"Středicí kolík {nm} Ø{KOLIK_D:g} (ODHAD)", [0, 0, 0, 0, 0, 0],
                                    {"Konstrukce_Typ": "dil", "Konstrukce_Material": "ocel (ODHAD)"}))
        out["tel"][-1]["body"] = {"add": [{"cyl": {"p": [kx, ky, Hd + T_PL], "d": [0, 0, 1], "r": KOLIK_D / 2, "h": z_dil0 - Hd - T_PL + 15.0}}], "cut": []}
    dilbox = [cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2, z_dil0, z_dil0 + H]
    out["tel"].append(_box_telo("dil", f"Zkoušený díl {L:g}×{W:g}×{H:g} (zástupná obálka, ODHAD)", dilbox,
                                {"Konstrukce_Typ": "pomocny", "PLCdesk_ModelStatus": "placeholder",
                                 "Konstrukce_Poznamka": DIL_POZN}))
    out["tel"].append(_box_telo("vkladani", "Zóna vkládání dílu shora", [cx - L / 2 - 10, cx + L / 2 + 10, cy - W / 2 - 10, cy + W / 2 + 10, z_dil0 + H, z_dil0 + H + ZONA_VKLADANI],
                                {"Konstrukce_Typ": "pomocny", "Konstrukce_Zona": "vkladani", "Konstrukce_Poznamka": "vkládání / vyjímání dílu shora (ODHAD výšky)"}))
    out["zony"].append({"nazev": "T1 vkládání dílu", "bbox": [cx - L / 2 - 10, cy - W / 2 - 10, z_dil0 + H, cx + L / 2 + 10, cy + W / 2 + 10, z_dil0 + H + ZONA_VKLADANI]})
    # válce
    for v, (d, bocne) in zip(sel, sm):
        tag, norma, pr, zd, pa, spec = v
        tip, _ = sonda_valce(norma, pr, zd)
        half = L / 2 if d[0] else W / 2
        fx_ = cx - d[0] * half if d[0] else cx + bocne
        fy_ = cy - d[1] * half if d[1] else cy + bocne
        # plocha dílu leží na opačné straně než směr pístnice: pístnice míří DO dílu, počátek je ZA plochou
        dist = vzdalenost_zad(zd, tip)
        ox_, oy_ = fx_ - d[0] * dist, fy_ - d[1] * dist
        # fx_, fy_ = bod plochy, ze které válec míří do dílu: pro d=(+1,0) je to plocha x = cx − L/2
        Lc = spec["params"]["L8"] + zd
        x0 = -pa["delka"] - modul_valec.PREKRYV
        x1 = Lc + pa["delka"] + modul_valec.PREKRYV
        Lp = x1 - x0 + 10.0
        s = (ox_ + d[0] * (x0 - 5.0), oy_ + d[1] * (x0 - 5.0))
        ez = [d[0], d[1], 0.0]
        ex = [0.0, 0.0, 1.0]
        ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], 0.0]
        fx.member("104040", A, A, Lp, [s[0], s[1], Hd + A / 2], ex, ey, ez, "konzola_valce", f"Konzola P1 {tag} (profil 40×40)")
        for t_ in (15.0, Lp / 2, Lp - 15.0):
            bx, by = s[0] + d[0] * t_, s[1] + d[1] * t_
            _r, q = mk.sroub_zespodu(fx, round(bx, 1), round(by, 1), Hd, t_deska or 15.0, [d[0], d[1], 0], f"konzola válce {tag} → deska")
            out["otvory"].append(dict(q, co=f"konzola válce {tag}: otvor M6 zespodu se zahloubením ({bx:.0f}, {by:.0f})", kind="otvor_sroub"))
        for (px, py, sg) in ((s[0], s[1], -1), (s[0] + d[0] * Lp, s[1] + d[1] * Lp, 1)):
            fx.put(zk, [px, py, Hd + A / 2], cols([-sg * d[1], sg * d[0], 0.0], [0.0, 0.0, 1.0], [sg * d[0], sg * d[1], 0.0]), "zaslepka")
        m = modul_valec.modul(tag, norma, pr, zd, "patky", "nic", "deska", pos=[ox_, oy_, ax_z], rot=_rot(d),
                              nazev=f"P1 {tag} {norma} Ø{pr}×{zd} — {ROLE_TEXT[role_map[tag]]} (přípravek T1)", profil=40)
        # zóna zdvihu končí na ploše dílu: oříznout modulové zóny na plochu − mezera
        lim = (ox_ + d[0] * (dist - MEZERA), oy_ + d[1] * (dist - MEZERA))
        for z in (m["rozhrani"].get("zony") or []):
            b = list(z["bbox"])
            if d[0] > 0:
                b[3] = min(b[3], lim[0])
            elif d[0] < 0:
                b[0] = max(b[0], lim[0])
            elif d[1] > 0:
                b[4] = min(b[4], lim[1])
            else:
                b[1] = max(b[1], lim[1])
            z["bbox"] = b
        out["moduly"].append(m)
        # zástupná čelist / těsnicí hlava na pístnici (zasunutá poloha)
        p0 = (ox_ + d[0] * tip, oy_ + d[1] * tip)
        p1 = (ox_ + d[0] * (tip + PAD), oy_ + d[1] * (tip + PAD))
        a0, a1 = sorted((p0[0], p1[0])) if d[0] else (p0[0] - PAD_W / 2, p0[0] + PAD_W / 2)
        b0, b1 = sorted((p0[1], p1[1])) if d[1] else (p0[1] - PAD_W / 2, p0[1] + PAD_W / 2)
        nm = "tesnici_hlava" if role_map[tag] == ROLE_TESN else "celist"
        out["tel"].append(_box_telo(f"{nm}_{tag.strip('-')}", f"{'Těsnicí hlava' if nm == 'tesnici_hlava' else 'Upínací čelist'} {tag} (zástupná, ODHAD)",
                                    [a0, a1, b0, b1, ax_z - PAD_W / 2, ax_z + PAD_W / 2],
                                    {"Konstrukce_Typ": "dil", "PLCdesk_ModelStatus": "placeholder",
                                     "PLCdesk_Mount": "zavit",          # našroubovaná na závit pístnice

                                     "Konstrukce_Poznamka": "tvar a rozměr čelisti / hlavy doplní konstruktér — ODHAD"}))
        zb = [min(p0[0], lim[0]), min(p0[1], lim[1]), ax_z - PAD_W / 2, max(p0[0], lim[0]), max(p0[1], lim[1]), ax_z + PAD_W / 2]
        zb[0], zb[3] = (min(p0[0] - 0.0, lim[0]), max(p0[0], lim[0])) if d[0] else (p0[0] - PAD_W / 2, p0[0] + PAD_W / 2)
        zb[1], zb[4] = (min(p0[1], lim[1]), max(p0[1], lim[1])) if d[1] else (p0[1] - PAD_W / 2, p0[1] + PAD_W / 2)
        out["zony"].append({"nazev": f"T1 zdvih {tag} (končí na ploše dílu)", "bbox": zb})
        out["valce"].append({"tag": tag, "role": role_map[tag], "role_text": ROLE_TEXT[role_map[tag]], "osa": [d[0], d[1], 0],
                             "pocatek": [round(ox_, 1), round(oy_, 1), round(ax_z, 1)], "zdvih": zd,
                             "plocha_dilu": [round(fx_, 1), round(fy_, 1)],
                             "zona_zdvihu": [round(c, 1) for c in zb], "konzola": {"profil": "40×40", "delka": round(Lp, 1)}})
        out["boxes"].append((f"konzola {tag}", [min(s[0], s[0] + d[0] * Lp) - A / 2, min(s[1], s[1] + d[1] * Lp) - A / 2, Hd,
                                               max(s[0], s[0] + d[0] * Lp) + A / 2, max(s[1], s[1] + d[1] * Lp) + A / 2, Hd + A]))
    # obálka přípravku
    ext = [x0p, y0p, Hd, x1p, y1p, z_dil0 + H]
    for m in out["moduly"]:
        ob = m["rozhrani"].get("obalka")
        if ob:
            ext = [min(ext[0], ob[0]), min(ext[1], ob[1]), min(ext[2], ob[2]), max(ext[3], ob[3]), max(ext[4], ob[4]), max(ext[5], ob[5])]
    for z in out["zony"]:
        b = z["bbox"]
        ext = [min(ext[0], b[0]), min(ext[1], b[1]), ext[2], max(ext[3], b[3]), max(ext[4], b[4]), ext[5]]
    out["obalka"] = [round(c, 1) for c in ext]
    out["dilbox"] = dilbox
    out["rozhrani"] = {
        "format": "plcdesk-pro-modul", "modul": "T1", "verze": 1, "generator": GEN,
        "dil": dict(D, odhad=True, poznamka=DIL_POZN),
        "hnizdo": {"stred": [cx, cy], "bbox": [round(c, 1) for c in dilbox], "zakladova_deska": {"t": T_PL, "bbox": [x0p, y0p, Hd, x1p, y1p, Hd + T_PL]},
                   "listy": 2, "koliky": 2, "vyska_lisht": round(h_l, 1)},
        "valce": out["valce"],
        "role_celkem": {r: sum(1 for k in role_map.values() if k == r) for r in ROLE_TEXT},
        "kotveni": {"deska": f"4 × M6 zespodu deskou N1 do závitů desky přípravku", "konzoly": "profil 40×40, šrouby M6 zespodu deskou N1 do matic T"},
        "pozadavky_na_N1": out["otvory"],
        "obalka": out["obalka"],
        "nebezpecne_zony": out["zony"],
        "odhady": [DIL_POZN, f"základová deska t {T_PL:g}, přesah {PRESAH:g}, lišty {LISTA_B:g}, kolíky Ø{KOLIK_D:g}, čelist {PAD:g}×{PAD_W:g} — ODHAD",
                   "poloha a šířka čelisti, směr působení válců a zdvih při upnutí ověří konstruktér"],
    }
    return out
