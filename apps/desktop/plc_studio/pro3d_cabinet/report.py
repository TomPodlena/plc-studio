"""ROZVADEC.md z ``layout.json`` (čistý Python): skříň, lišty a obsazení, mezery se zdrojem, tepelná bilance se zdrojem
každé položky, ODHAD / CHYBÍ, zpětná vazba pro PLCdesk."""

from __future__ import annotations

from collections import OrderedDict


def _src(z) -> str:
    if not z:
        return "—"
    if isinstance(z, str):
        return z
    s = z.get("dokument", "")
    if z.get("datum"):
        s += f" ({z['datum']})"
    if z.get("strana"):
        s += f", str. {z['strana']}"
    if z.get("url"):
        s += f" — {z['url']}"
    return s


def _f(v, nd=1) -> str:
    return "—" if v is None else (f"{v:.{nd}f}".replace(".", ","))


def md(lay: dict, fc: dict | None = None) -> str:
    L = [f"# Rozvaděč — vygenerováno kódem (pro3d_cabinet) — {lay.get('projekt') or ''}", ""]
    if not lay.get("ok"):
        L += [f"**Nevygenerováno:** {lay.get('chyba', '')}", ""]
        for p in lay.get("pokusy") or []:
            L.append(f"- {p['skrin']}: {'vejde se' if p['ok'] else '; '.join(p['proc'])}")
        L += ["", "## Zpětná vazba pro PLCdesk", ""] + [f"- `{f['kind']}` {f.get('partId', '')}: {f['text']}" for f in lay.get("zpetna_vazba") or []]
        return "\n".join(L) + "\n"
    c, v, b = lay["cabinet"], lay["verdikt"], lay["bilance"]
    p = lay["params"]
    L += [f"Model `rozvadec/Rozvadec.FCStd`, rozmístění `rozvadec/layout.json` (vstup {lay.get('manifest', '')}, "
          f"SHA-256 {str(lay.get('manifestSha256', ''))[:12]}…), vytvořeno {lay['created']}. Parametry: rezerva lišt ≥ {p['rezerva']:.0f} %, "
          f"okolí {p['tamb']:.0f} °C, dovolená vnitřní ≤ {p['tin']:.0f} °C, montáž {p['montaz']}.", ""]
    if fc:
        L += [f"FreeCAD: {'OK' if fc.get('ok') else 'CHYBA'} — objektů {fc.get('objektu', '?')}, odkazů na díly dle dokumentace "
              f"{fc.get('odkazu', '?')}, zástupných {fc.get('zastupnych', '?')}, šroubů {fc.get('sroubu', '?')}"
              + (f"; chyby: {'; '.join(fc.get('chyby') or [])}" if fc.get("chyby") else "") + ".", ""]
    L += ["## Souhrn", "", "| položka | výsledek |", "|---|---|",
          f"| skříň | **{c['brand']} {c['orderCode']}** {c['w']}×{c['h']}×{c['d']} mm, deska {c['plateW']}×{c['plateH']} — "
          + ("**ZMĚNA proti manifestu " + c["manifestCode"] + "** (viz zpětná vazba)" if c["zmena"] else "skříň z manifestu") + " |",
          f"| výška desky | potřeba {_f(lay['vyska']['potreba'], 0)} mm z {c['plateH']} mm |",
          f"| lišty | " + "; ".join(f"{r['name']}: obsazeno {_f(r['obsazeno'], 0)} / {_f(r['L'], 0)} mm, rezerva **{_f(r['rezerva_pct'])} %**"
                              for r in lay["rails"]) + " |",
          f"| rezerva ≥ {p['rezerva']:.0f} % na každé liště | {'SPLNĚNO' if v['rezerva_ok'] else 'NESPLNĚNO'} |",
          f"| zóny mezer × cizí díly | {'bez průniku' if not lay['konflikty_zon'] else '; '.join(lay['konflikty_zon'])} |",
          f"| tepelná bilance | **{b['verdikt'].upper()}** — Qv {_f(b['Qv'])} W (doložené), Qs {_f(b['Qs'])} W, odhad vnitřní teploty "
          f"{_f(b['t_odhad'])} °C |", ""]
    L += ["## Skříň a deska", "",
          f"- Skříň: {c['typ']} — rozměry a deska z katalogu PLCdesk ({c['src']}); vybrána " +
          ("skříň z manifestu (výbava se vejde)." if not c["zmena"] else
           f"nejmenší skříň katalogu, do které se výbava vejde (manifest {c['manifestCode']} nestačí)."),
          f"- Pokusy (od manifestu, pak od nejmenší): " + "; ".join(f"{x['skrin']} {'✓' if x['ok'] else '✗ ' + ', '.join(x['proc'])}"
                                                                 for x in lay["pokusy"]),
          f"- Vnitřní líc dveří y = {_f(lay['yd'])} mm, deska y {_f(lay['plate']['y0'])}–{_f(lay['plate']['y1'])} mm, lišty TS35 "
          f"x {_f(lay['rail']['x0'], 0)}–{_f(lay['rail']['x1'], 0)} mm (délka {_f(lay['rail']['L'], 0)} mm, s rezervou max. {_f(lay['rail']['cap'], 0)} mm).", ""]
    L += ["## Lišty a pásy (shora dolů)", "", "| lišta | skupina | osa z | obsazeno | rezerva | kusy (v pořadí) |", "|---|---|---|---|---|---|"]
    for r in lay["rails"]:
        L.append(f"| {r['name']} | {r['label']} | {_f(r['zc'], 1)} | {_f(r['obsazeno'], 1)} / {_f(r['L'], 0)} mm | "
                 f"{_f(r['rezerva_mm'], 0)} mm = **{_f(r['rezerva_pct'])} %** | {', '.join(r['items'])} |")
    L += ["", "Žlaby: " + ", ".join(f"{d['name']} ({d['orient']})" for d in lay["ducts"]) + " — svislé V1 / V2 propojují vodorovné.", ""]
    L += ["## Přístroje", "", "| označení | kód | lišta | x × z (mm) | š × v × h | rozměr — zdroj | model |", "|---|---|---|---|---|---|---|"]
    for d in lay["devices"] + lay["door"]["items"]:
        if d["kind"] == "zarazka":
            continue
        bx = d["box"]
        where = "dveře" if d["door"] else str(d.get("rail") or "")
        r = d["rozmer"]
        L.append(f"| {d['tag']}{'#' + str(d['inst']) if d['cat'] == 'terminal_block' or d['inst'] > 1 else ''} | {d['code'] or '—'} | {where} | "
                 f"{_f(bx[0], 0)}–{_f(bx[1], 0)} × {_f(bx[4], 0)}–{_f(bx[5], 0)} | {_f(r['w'], 1)} × {_f(r['h'], 1)} × {_f(r['d'], 1)} | "
                 f"{r['stav']}: {r['zdroj'][:120]} | {'App::Link ' + d['model'] if d['model'] else 'zástupný (oranžový)'} |")
    if lay["door"]["varovani"]:
        L += [""] + [f"- ⚠ {w}" for w in lay["door"]["varovani"]]
    L += ["", "## Mezery výrobců (zóny `Mezera …` v modelu)", "", "| přístroj / kód | nad | pod | bok | před | stav | zdroj |", "|---|---|---|---|---|---|---|"]
    seen = OrderedDict()
    for d in lay["devices"]:
        if d["kind"] == "zarazka":
            continue
        k = d["code"] or d["cat"]
        if k not in seen:
            seen[k] = d
    for k, d in seen.items():
        m = d["mezery"]
        nv = lambda x: "neuvedeno" if x is None else x  # noqa: E731
        L.append(f"| {d['tag']} {k} | {nv(m.get('nad'))} | {nv(m.get('pod'))} | {nv(m.get('bok'))} | {nv(m.get('pred'))} | "
                 f"{m.get('stav')} | {_src(m.get('zdroj')) if m.get('zdroj') else m.get('pozn', '—')} |")
    L += ["", "Stanice PLC a svorkovnice mají jednu zónu pro celý blok (moduly S7-1200 G2 vedle sebe; boční mezera „on both sides of the "
          "system“). Mezera „před“ neuvedena = výrobce ji v přečteném dokumentu neuvádí (kontrola hloubky ji bere 0).", ""]
    L += ["## Tepelná bilance", "",
          f"Metoda: {b['k_zdroj']['dokument']} ({b['k_zdroj']['url']}): **Qs = k · A · ΔT**, k = {_f(b['k'])} W/m²K (ocelový plech). "
          f"A = {_f(b['A'], 3)} m² ({'u stěny: čelo + strop + 2 boky' if b['montaz'] == 'stena' else 'volně: + záda'}; "
          f"ODHAD metody — {b['plocha']})", "",
          f"Dovolená vnitřní teplota Ti = min(parametr {_f(b['tin_param'], 0)} °C, nejnižší dovolená přístrojů "
          + (f"{_f(b['tdev']['t'], 0)} °C {b['tdev']['tag']}: „{b['tdev']['text']}“" if b["tdev"] else "nezjištěna")
          + f") = **{_f(b['ti'], 0)} °C**; okolí {_f(b['tamb'], 0)} °C → ΔT = {_f(b['dT'], 0)} K → **Qs = {_f(b['Qs'])} W**.", "",
          "| přístroj | kód | ztráta W | stav | co | Tmax °C | zdroj |", "|---|---|---|---|---|---|---|"]
    agg = OrderedDict()
    for r in b["radky"]:
        k = (r["code"] or r["tag"], r["stav"])
        a = agg.setdefault(k, dict(r, n=0, tags=[]))
        a["n"] += 1
        a["tags"].append(f"{r['tag']}")
    for (code, _st), a in agg.items():
        tags = ", ".join(sorted(set(a["tags"])))
        w = "—" if a["W"] is None else f"{a['n']} × {_f(a['W'], 2)} = {_f(a['n'] * a['W'], 2)}"
        L.append(f"| {tags} | {code} | {w} | {a['stav']} | {a['co'][:110]} | {a['tmax'] if a['tmax'] is not None else '—'} | {_src(a['zdroj'])[:160]} |")
    L += ["", f"**Qv (doložené) = {_f(b['Qv'], 2)} W**" + (f", z toho z výtahu (k ověření v PDF): {', '.join(b['vytah'])}" if b["vytah"] else "")
          + f"; bez opatření vnitřní teplota ≈ {_f(b['t_odhad'])} °C (Ti = Tu + Qv / (k · A)).", ""]
    if b["chybi"]:
        cnt = OrderedDict()
        for x in b["chybi"]:
            k = x.split(" (", 1)[-1].rstrip(")")
            cnt[k] = cnt.get(k, 0) + 1
        L.append("**CHYBÍ ztráta** (bilance neúplná, nevymýšlí se): " + ", ".join(f"{k} × {n}" for k, n in cnt.items()) + ".")
        L.append("")
    L.append(f"**Výsledek: {b['verdikt'].upper()}**" + (" (Qv > Qs)" if b["verdikt"] == "nevyhovuje" else ""))
    if b["opatreni"]:
        L += ["", "Návrh opatření (jen návrh, typ bez kódu — rozhodne uživatel v PLCdesk):"] + [f"- {m}" for m in b["opatreni"]]
        L.append(f"- součinitel f = {b['f']} m³K/Wh: {b['f_zdroj']['dokument']} ({b['f_zdroj']['url']})")
    L += ["", "## ODHADY (geometrie a hodnoty bez dokladu výrobce)", ""] + [f"- ODHAD: {x}" for x in lay["odhady"]]
    if lay.get("poznamky"):
        L += ["", "## Poznámky", ""] + [f"- {x}" for x in lay["poznamky"]]
    L += ["", "## Zpětná vazba pro PLCdesk (návrh — sepsat do PLCdesk_CAD_feedback_rozvadec.json, rozhodne uživatel)", ""]
    L += [f"- `{f['kind']}` {f.get('partId') or ''}: {f['text']}" for f in lay["zpetna_vazba"]] or ["- žádná"]
    L += ["", "## Co kód neumí (doplní stavitel / člověk)", "",
          "- kabeláž ve žlabech, PE / N přípojnice a potenciálové svorky (v manifestu nejsou), štítky a popisky IEC 81346;",
          "- vrtací obrazce přístrojů na desce a upínky přístrojů ve dveřích (šrouby jsou ODHAD polohy);",
          "- výška nad úrovní obsluhy (EN 60204-1 11.2.1: 0,4–2,0 m, svorky ≥ 0,2 m) — dá rám;",
          "- ověření ztrát a mezer označených „výtah“ / „CHYBÍ“ v PDF výrobců.", ""]
    return "\n".join(L) + "\n"
