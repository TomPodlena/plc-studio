"""MODULY.md — zpráva generátoru modulů (čistý Python)."""

from __future__ import annotations


def _r(v, n=1):
    return "—" if v is None else (f"{v:.{n}f}" if isinstance(v, float) else str(v))


def md(lay: dict, fc: dict | None) -> str:
    s = lay["souhrn"]
    L = ["# Moduly stroje — vygenerováno kódem (pro3d_modules)", "",
         f"Projekt **{lay.get('projekt') or '—'}**, manifest SHA-256 `{lay['manifestSha256'][:16]}…`, vytvořeno {lay['created']}.",
         "Generátor je deterministický (stejný vstup → stejný model). Co kód neumí, je v oddílu **Nepostaveno** — doplní stavitel.",
         "Hodnoty mají zdroj (tabulky pro3d_parts, skill kabelaz-a-hadice / festo-pneumatics), jinak jsou označené **ODHAD**.", "",
         "## Souhrn", "",
         f"- zařízení v poli {s['zarizeni']} (v rámu už {s['v_ramu']}, postaveno kódem {s['postaveno_zarizeni']}, bez polohy / upevnění {s['chybi']})",
         f"- válce {s['valcu']}, snímače {s['snimacu_postaveno']} / {s['snimacu']}, držáky a patky {s['drzaku']}, nosné konstrukce z konceptu "
         f"{s['nosnych']}, šrouby {s['sroubu']}",
         f"- hadice postaveno {s['hadic_postaveno']} / {s['hadic']} (délky vč. rezervy {s['hadice_m']} m), kabely postaveno "
         f"{s['kabelu_postaveno']} / {s['kabelu']} ({s['kabely_m']} m)",
         f"- požadavky na rám (díry, průchody) {s['predani']}, nepostaveno {s['nepostaveno']}", ""]
    if fc is not None:
        L += [f"Model `moduly/Moduly.FCStd`: objektů {fc.get('objektu')}, odkazů {fc.get('odkazu')}, tras postaveno {fc.get('tras')}"
              + (f", **odebráno pro kolizi {len(fc.get('odebrano') or [])}**" if fc.get("odebrano") else "")
              + (f"; chyby FreeCADu: {'; '.join(fc.get('chyby') or [])[:400]}" if fc.get("chyby") else "") + ".", ""]
        if fc.get("snimky"):
            L += ["Snímky: " + ", ".join(f"`{p}`" for p in fc["snimky"]), ""]
    pn = lay.get("pneu")
    if pn:
        bz = pn.get("bezpecnost") or {}
        L += ["## Pneumatika — ostrov P3 a úprava vzduchu P2 (pro3d_lib.modul_ostrov)", "",
              f"- `moduly/Pneumatika.FCStd` (App::Link ve skupině G-pneu): ostrov {pn['ident']} s rozváděči {', '.join(pn['ventily'])}, "
              f"úprava vzduchu MS6 {'uzávěr → filtr-regulátor → bezpečnostní ventil MS6-SV-E (NÁVRH ke schválení)' if pn['sv'] else 'uzávěr → filtr-regulátor (stroj bez modulu bezpečnosti — bez MS6-SV-E)'}",
              f"- místo: volný úsek drážky „{pn['prvek']}“ podle smlouvy N1 (ODHAD k odsouhlasení), obálka {pn['box']}",
              f"- uzávěr: {(pn.get('uzaver') or {}).get('pozn', '')}",
              f"- bezpečnost: {bz.get('stav', '')}",
              "- hadice P4 ostrov → válce vede router (oddíl Hadice a kabely); rozvod P je součástí modulu", ""]
    sm = lay.get("smlouva_n1")
    if sm:
        L += ["## Smlouva rámu N1", "", f"- soubor `{sm['soubor']}`: šrouby do drážek podle volných úseků smlouvy, obsazené místo "
              f"{sm['drazky_obsazene']}×, závity do pracovní desky (vrtá výrobce rámu podle modulu) {sm['zavity_deska']}×",
              f"- průchody požadované moduly {sm['pruchody']}, v rámu už {sm['pruchody_v_ramu']}, chybí {sm['pruchody_chybi']} — "
              "požadavky ve formátu N1 v `layout.json` `predani_n1` (další stavba rámu je převezme)", ""]
    L += ["## Pneumatika — válce", "", "| zařízení | model | upevnění | směr pístnice | přípojky |", "|---|---|---|---|---|"]
    for it in lay["items"]:
        if it["druh"] == "valec":
            d = next((x for x in lay["devices"] if x.get("item") == it["id"]), {})
            L.append(f"| {it['tag']} | {it['label']} ({it['model']}) | {it.get('upevneni', '—')} | {it.get('smer_zdroj')} | "
                     f"{', '.join(p['id'] for p in d.get('ports') or []) or '—'} |")
    L += ["", "## Hadice a kabely", "",
          "| trasa | od → do | médium | Ø | R min | R trasy | délka mm | s rezervou | stav |", "|---|---|---|---|---|---|---|---|---|"]
    for r in lay["routes"]:
        t, v = r["trasa"], r["vysledek"]
        med = t["medium"] if isinstance(t["medium"], str) else (t["medium"].get("id") or "ODHAD")
        st = "postaveno" if r["postavit"] else ("ODHAD délky — " + (r.get("duvod") or "nestavěno"))
        if v.get("chyby"):
            st = "CHYBA: " + "; ".join(v["chyby"][:1])
        L.append(f"| {t['id']} | {t['od']} → {t['do']} | {med} | {_r(t.get('D'))} | {_r(v.get('R_min'))} | {_r(v.get('R'))} | "
                 f"{_r(v.get('delka_mm'), 0)} | {_r(v.get('delka_s_rezervou_mm'), 0)} | {st} |")
    if lay.get("oddeleni"):
        L += ["", "Oddělení silových × signálových tras (≥ 250 mm nebo přepážka — SINAMICS G120C OI, skill kabelaz-a-hadice): "
              + "; ".join(o.get("text", str(o)) for o in lay["oddeleni"][:8])]
    L += ["", "## Snímače a držáky", "", "| zařízení | zdroj polohy | stav |", "|---|---|---|"]
    for d in lay["devices"]:
        if d["cat"].startswith("sensor") or d["cat"] in ("cylinder_switch", "pressure_transmitter"):
            st = "postaven" if d.get("item") else ("v rámu" if d["src"] == "ram" else "NEPOSTAVEN")
            L.append(f"| {d['tag']} #{d['inst']} {d['cat']} | {d['src']} | {st}{' — držák ' + d['drzak'] if d.get('drzak') else ''} |")
    L += ["", "## Nosné konstrukce z konceptu", "", "| konstrukce | stojí na | upevnění |", "|---|---|---|"]
    for s2 in lay["supports"]:
        on = s2.get("on")
        L.append(f"| {s2['label']}{' (zástupná)' if s2.get('zast') else ''} | {on[1] if on else '—'} | {s2.get('upevneni') or '—'} |")
    L += ["", "## Nepostaveno (doplní stavitel)", ""]
    L += [f"- {n['co']}: {n['duvod']}" for n in lay["nepostaveno"]] or ["- nic"]
    for x in (fc or {}).get("odebrano") or []:
        L.append(f"- {x['co']}: odebráno ve FreeCADu — {x['duvod']}")
    L += ["", "## Požadavky na rám (předání — rám je schválený, NEMĚNIT ho v modulech)", ""]
    L += [f"- {p['co']} u {p['bod']} ({p['proc']})" for p in lay["predani"]] or ["- žádné"]
    L += ["", "## ODHADY", ""] + [f"- ODHAD: {o}" for o in lay["odhady"]] + [""]
    L += ["## Zpětná vazba pro PLCdesk", "",
          f"`moduly/PLCdesk_CAD_feedback_moduly_kod.json` (plcdesk-cad-feedback v1, {len(lay['zpetna_vazba']['issues'])} bodů — "
          "rozhodne uživatel v kroku Kusovník)", ""]
    L += [f"- {i['kind']} / {i['severity']}: {i['message'][:240]}" for i in lay["zpetna_vazba"]["issues"]]
    return "\n".join(L) + "\n"
