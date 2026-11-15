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
          f"{_f(b['t_odhad'])} °C |",
          f"| bilance s opatřením | " + (f"ventilátor {b['ventilator']['typ']['kod']}: Ti {_f(b['ventilator']['ti_s'])} °C, rezerva "
                                        f"{_f(b['ventilator']['rezerva_K'], 2)} K — **{b['ventilator']['verdikt'].upper()}**"
                                        if (b.get("ventilator") or {}).get("typ") else ((b.get("ventilator") or {}).get("duvod") or "není potřeba")) + " |",
          f"| kabeláž ke dveřím | " + "; ".join(f"{k}: volný úsek {_f((r.get('volny') or {}).get('delka'), 0)} / požadavek "
                                                 f"{_f((r.get('volny') or {}).get('pozadavek'), 0)} mm, R {_f(r.get('R_pohyb'), 0)} mm"
                                                 + (" ✗" if r.get("chyby") else " ✓")
                                                 for k, r in (lay.get("kabelaz_dvere") or {}).items()) + " |",
          f"| oddělení silové × signálové | {'SPLNĚNO' if v.get('oddeleni_ok') else 'NESPLNĚNO'} |", ""]
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
    L += [""] + md_extra(lay)
    L += ["## ODHADY (geometrie a hodnoty bez dokladu výrobce)", ""] + [f"- ODHAD: {x}" for x in lay["odhady"]]
    if lay.get("poznamky"):
        L += ["", "## Poznámky", ""] + [f"- {x}" for x in lay["poznamky"]]
    L += ["", "## Zpětná vazba pro PLCdesk (návrh — sepsat do PLCdesk_CAD_feedback_rozvadec.json, rozhodne uživatel)", ""]
    L += [f"- `{f['kind']}` {f.get('partId') or ''}: {f['text']}" for f in lay["zpetna_vazba"]] or ["- žádná"]
    L += ["", "## Co kód neumí (doplní stavitel / člověk)", "",
          "- kabeláž uvnitř žlabů (rozdělení do komor podle druhu), potenciálové svorky, štítky a popisky IEC 81346;",
          "- vrtací obrazce přístrojů na DESCE (šrouby jsou ODHAD polohy); přístroje na dveřích bez záznamu v data/dvere.json;",
          "- výška nad úrovní obsluhy (EN 60204-1 11.2.1: 0,4–2,0 m, svorky ≥ 0,2 m) — dá rám;",
          "- ověření ztrát a mezer označených „výtah“ / „CHYBÍ“ v PDF výrobců.", ""]
    return "\n".join(L) + "\n"


def _druh(k) -> str:
    return {"silovy": "silový (230 / 400 V AC)", "signal": "signálový (24 V DC, PLC, sběrnice)", "smiseny": "smíšený"}.get(k or "", k or "—")


def md_extra(lay: dict) -> list:
    """Oddíly generované dvere.py: dveře, kabeláž ke dveřím, oddělení tras, PE / N, bilance s ventilátorem."""
    L = []
    dv = lay.get("dvere") or {}
    b = lay["bilance"]
    fan = b.get("ventilator")
    if fan:
        L += ["## Tepelná bilance s filtračním ventilátorem (opatření kódem)", ""]
        if fan.get("typ"):
            t, f = fan["typ"], fan["filtr"]
            L += [f"Přirozené chlazení nevyhovuje → generátor zvolil **Rittal {t['kod']}** ({t['U']}, příkon {_f(t['P'])} W, průtok volný "
                  f"{_f(t['V_volny'], 0)} m³/h, **s výstupním filtrem {f['kod']} {_f(t['V_filtr'], 0)} m³/h**, výřez {_f(t['vyrez'], 0)} × "
                  f"{_f(t['vyrez'], 0)} mm, rám {_f(t['ram'], 1)} mm, hloubka {_f(t['hloubka'], 0)} mm, {t['krytí']}) — {_src(t['zdroj'])}.", "",
                  "| člen | hodnota |", "|---|---|",
                  f"| Qv doložené ztráty přístrojů | {_f(fan['Qv'], 2)} W |",
                  f"| + příkon ventilátoru (celý uvnitř skříně) | {_f(t['P'], 1)} W |",
                  f"| Q celkem | **{_f(fan['Q'], 2)} W** |",
                  f"| potřebný průtok V = f · Q / ΔT (f {fan['f']}, ΔT {_f(fan['dT'], 0)} K) | {_f(fan['V_potreba'], 1)} m³/h |",
                  f"| potřebný průtok s rezervou {_f(fan['rezerva_K_min'], 0)} K: f · Q / (ΔT − rezerva) | {_f(fan['V_potreba_rezerva'], 1)} m³/h |",
                  f"| ΔT s ventilátorem = f · Q / V_filtr | {_f(fan['dT_s'], 2)} K |",
                  f"| vnitřní teplota | **{_f(fan['ti_s'], 1)} °C** (dovolená {_f(b['ti'], 0)} °C) |",
                  f"| rezerva | **{_f(fan['rezerva_K'], 2)} K** — {'SPLNĚNO' if fan['rezerva_ok'] else 'NESPLNĚNO (varování)'} ≥ {_f(fan['rezerva_K_min'], 0)} K |",
                  "", f"Rezerva {_f(fan['rezerva_K_min'], 0)} K: {fan['rezerva_text']}. Odvod pláštěm (Qs) se s ventilátorem nezapočítává "
                  f"(konzervativně). {fan['psu_text']}. {fan['hloubka_text']}.", ""]
            L += [f"- ⚠ {w}" for w in fan["varovani"]] + ([""] if fan["varovani"] else [])
            L += [f"**Výsledek s opatřením: {fan['verdikt'].upper()}**" + ("" if fan["rezerva_ok"] else " (rezerva < 2 K)")
                  + "; ventilátor a filtr jsou v modelu ve dveřích (zástupné, mimo kusovník — zpětná vazba), krytí klesá na IP 54.", ""]
        else:
            L += [f"**Opatření ventilátorem nevyhovuje:** {fan.get('duvod', '')}", ""]
    if dv:
        L += ["## Dveře — výřezy, vrtací obrazce a upevnění (data/dvere.json)", "",
              "| přístroj | druh | poloha x × z (mm) | výřez / otvory | upevnění | zdroj |", "|---|---|---|---|---|---|"]
        holes = {}
        for h in dv.get("door_holes", []):
            holes.setdefault(h["tag"], []).append(h)
        cuts = {c["tag"]: c for c in dv.get("door_cutouts", [])}
        clips = {}
        for c in dv.get("clips", []):
            clips.setdefault(c["name"].split(" ")[1], []).append(c)
        for p in dv.get("pristroje", []):
            tag = p["tag"]
            if p.get("x") is None:
                L.append(f"| {tag} | {_druh(p['druh'])} | NEUMÍSTĚNO | — | — | — |")
                continue
            if tag in cuts:
                c = cuts[tag]
                vy = f"výřez {_f(c['x1'] - c['x0'], 0)} × {_f(c['z1'] - c['z0'], 0)}"
            elif tag in holes:
                hs = holes[tag]
                vy = ", ".join(f"Ø{_f(h['d'], 1)}" for h in hs[:1]) + f" × {len([h for h in hs if not h.get('pozn')])}" + \
                    "".join(f" + Ø{_f(h['d'], 1)} ({h['pozn']})" for h in hs if h.get("pozn"))
            else:
                vy = "—"
            if tag in clips:
                up = f"{len(clips[tag])} upínek (počet a strany dle návodu, tvar ODHAD)"
                zd = clips[tag][0]["zdroj"]
            elif p["cat"] == "main_switch":
                up = "4 × šroub M4 (typ ODHAD) čelní deskou a dveřmi, čelní obálka 66 × 66 × 39 vně"
                zd = next((f["zdroj"] for f in dv.get("front_blocks", []) if f["tag"] == tag), "—")
            elif p["cat"] in ("fan", "filter"):
                up = "zacvaknutí do výřezu (ODHAD — montážní návod nečten)"
                zd = "Rittal datový list (výřez, rám, hloubka)"
            else:
                up, zd = "—", "—"
            L.append(f"| {tag} | {_druh(p['druh']) if p['druh'] != 'zadny' else 'bez vodičů'} | {_f(p['x'], 0)} × {_f(p['z'], 0)} | {vy} | {up} | {zd[:150]} |")
        L += [""] + [f"- ⚠ {w}" for w in dv.get("varovani", [])] + [f"- ✗ {c}" for c in dv.get("chyby", [])]
        L += ["", "Rozmístění na dveřích: silové přístroje nahoře u pantů, signálové pod stropem oddělení od silového svazku "
              "(hloubka za dveřmi bez kolize s přístroji, žlaby a zónami mezer na desce; okolí podle návodu — MTP700 15 / 15 / 50 / 50 mm).", ""]
    kd = lay.get("kabelaz_dvere") or {}
    if kd:
        L += ["## Kabeláž ke dveřím (svazky, volný úsek u pantu)", "",
              "Svazek: větve po vnitřní straně dveří → kmen v ose pantu → **volný úsek** (svislý oblouk mezi upínkou na dveřích a upínkou "
              "na boku skříně; dveře se otáčejí kolem svislé osy pantu, úsek se kroutí) → pevný úsek po boku do žlabu. Poloměry: "
              + (next(iter(kd.values()))["R_zdroj"]) + ". Výpočet zaoblení podle kabelaz-a-hadice/scripts/trasa.py (t = R·tan φ/2).", "",
              "| svazek | přístroje | prvky (ODHAD obsazení) | D svazku | R min pevně / pohyblivě | R volného úseku | volný úsek | potřeba 0–95° (max při) | požadavek (+10 %) | poměr | výsledek |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
        for k, r in kd.items():
            v = r.get("volny") or {}
            ok = v.get("ok") and not r.get("chyby")
            L.append(f"| {_druh(k)} → {r.get('cil') or '—'} | {', '.join(r.get('pristroje', []))} | {r.get('prvky')} | {_f(r.get('D'), 1)} mm | "
                     f"{_f(r.get('R_pevne'), 1)} / {_f(r.get('R_pohyb'), 1)} mm | {_f(v.get('R'), 1)} mm | {_f(v.get('delka'), 1)} mm | "
                     f"{_f(v.get('potreba'), 1)} mm ({_f(v.get('potreba_uhel'), 0)}°) | {_f(v.get('pozadavek'), 1)} mm | {_f(v.get('pomer'), 3)} | "
                     f"**{'SPLNĚNO' if ok else 'NESPLNĚNO'}** |")
        L += ["", "| větev | D | R pevně | délka |", "|---|---|---|---|"]
        for k, r in kd.items():
            for b_ in r.get("vetve", []):
                L.append(f"| {_druh(k)} — {b_['tag']} ({b_['prvky']}) | {_f(b_['D'], 1)} mm | {_f(b_.get('R'), 1)} mm | {_f(b_['delka'], 0)} mm |")
        L += ["", "Kontrola obou poloh: **zavřeno** — kolize kódem (pro3d_tools kolize: svazky × přístroje, žlaby, přepážky); **otevřeno 95°** — "
              "`Konstrukce_Pohyb` dveří (kmen, větve, upínky, přístroje a dělicí plech na dveřích se otáčejí, kolize kódem v poloze dveří); "
              "**volný úsek** — délka ≥ (1 + rezerva) × nejkratší dráha upínek po 5° v celém rozsahu 0–95° (kolem čela bočnice, "
              "rozvinutí svisle). Tvar volného úseku v otevřené poloze se nemodeluje (pružný), model ho nese v zavřené poloze.", ""]
        for k, r in kd.items():
            for c in r.get("chyby", []):
                L.append(f"- ✗ svazek {_druh(k)}: {c}")
        L += ["- ODHAD: obsazení vodičů, plnění 0,6, ochranná spirála 0,5 mm, upínky 3 × 15 mm, rezerva 10 % — data/dvere.json; "
              "R podle největšího prvku svazku (volné vodiče v pásce), kabel PROFINET Ø 6,5 mm ODHAD.", ""]
    od = lay.get("oddeleni") or {}
    if od:
        z = od["zdroj"]
        L += ["## Oddělení silových a signálových tras", "",
              f"Požadavek: silové × signálové ≥ **{_f(od['min_mm'], 0)} mm**, jinak uzemněná přepážka spojená s montážní deskou — "
              f"{z['dokument']} ({z['stav']}).", "",
              "| žlab | druh | úprava |", "|---|---|---|"]
        for d in od.get("ducts", []):
            up = []
            if d["druh"] == "smiseny":
                up.append("podélná uzemněná přepážka (komory: " + ", ".join(f"{a} {_druh(b_)}" for a, b_ in (d.get("komory") or {}).items()) + ")")
            if d.get("prodlouzen"):
                up.append("prodloužen k boku desky (otevřený konec — vstup svazku ke dveřím)")
            if d["name"] == od.get("hinge_duct"):
                up.append("svislý u pantů: jen v rozsahu silových žlabů")
            L.append(f"| {d['name']} | {_druh(d['druh'])} | {'; '.join(up) or '—'} |")
        L += ["", "Přepážky (návrh mimo kusovník, plech 1 mm ODHAD, šrouby M4 do závitu desky = uzemnění): "
              + "; ".join(p["name"] for p in od.get("prepazky", []) + od.get("celni", []) + od.get("delici_plechy", [])) + ".", "",
              "| silová trasa | signálová trasa | nejmenší vzdálenost | oddělení | výsledek |", "|---|---|---|---|---|"]
        for x in od.get("tabulka", []):
            L.append(f"| {x['a']} | {x['b']} | {_f(x['vzdalenost'], 1)} mm | "
                     + (f"{x['prepazka']} — {x.get('metoda', '')}" if x.get("prepazka") else ("≥ " + _f(od['min_mm'], 0) + " mm" if x["ok"] else "—"))
                     + f" | **{'SPLNĚNO' if x['ok'] else 'NESPLNĚNO'}** |")
        L += ["", "Metoda: body svazků po střednici × komory žlabů opačného druhu; blíž než požadavek → každá spojnice protíná uzemněnou "
              "přepážku, nebo rovina přepážky odděluje celý svazek od komory (počet spojnic mimo přepážku je uveden). Vodiče uvnitř žlabů "
              "(kromě svazků ke dveřím) kód nemodeluje — rozdělení do komor podle druhu doplní stavitel / montáž.", ""]
    pr = lay.get("pripojnice") or {}
    if pr:
        L += ["## PE a N přípojnice", ""]
        if pr.get("chyba"):
            L += [f"✗ {pr['chyba']}", ""]
        else:
            pe, nn, iz = pr["PE"], pr["N"], pr["izolator"]
            L += ["| přípojnice | typ / rozměr | upevnění | zdroj |", "|---|---|---|---|",
                  f"| PE | {pe['typ']}, {_f(pe['b'], 0)} × {_f(pe['t'], 0)} × {_f(pe['L'], 0)} mm (x {_f(pe['box'][0], 0)}, z {_f(pe['box'][4], 0)}–{_f(pe['box'][5], 0)}) | "
                  f"přímo na desce, 2 × ISO 4762 {pr['sroub']} do závitu desky (vodivě) | {_src(pe['zdroj'])} |",
                  f"| N | {nn['typ']}, délka {_f(nn['L'], 0)} mm (ODHAD) | 2 izolátory Ø{_f(iz['d'], 0)} × {_f(iz['h'], 0)} PA, šroub {pr['sroub']} jen do "
                  f"horního závitu izolátoru, izolátor na závrtném šroubu v desce — **bez kovové cesty N → deska** (mezi závity {_f(float(iz['h']) - 2 * float(iz['hloubka']), 0)} mm plastu) | "
                  f"{_src(nn['zdroj'])}; upevnění ODHAD |", ""]
    return L
