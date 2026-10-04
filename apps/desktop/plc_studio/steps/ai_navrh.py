"""Krok 2 — AI návrh: popis stroje → navržená sestava zařízení a sekvence.

Instrukce pro model, normalizace odpovědi i vytažení JSON jsou v
``apps/web/src/ai.js`` (volané přes most) — tady je jen UI a HTTP dotaz.
"""

from __future__ import annotations

import json
import queue
import threading

import tkinter as tk
from tkinter import ttk

from .. import ai_client, theme
from ..bridge import BridgeError
from ..i18n import N_, _
from ..widgets import Table, card, scrolled_text, wrap_label
from .program import ACT_LABEL
from .zarizeni import _opts_text

ERRORS = {
    "no_key": N_("Doplň API klíč v Nastavení AI."),
    "bad_key": N_("API klíč byl odmítnut (401)."),
    "rate_limited": N_("Příliš mnoho dotazů — zkus to za chvíli."),
    "invalid_json": N_("Odpověď se nepodařilo přečíst — zkus to znovu."),
}
ACTS = ("start", "stop", "open", "close", "wait", "waitOn", "waitOff",
        "home", "posRecord", "setPressure", "setFlow",      # + pohony fáze 2a
        "moveAbs", "moveRel", "velocity", "halt", "waitInPos")   # + servoosa (fáze 2b)
WAIT_ACTS = ("waitOn", "waitOff")          # čekání na digitální vstup (TRUE / FALSE)
DO_ROLES = ("run", "fault", "ready", "stopped", "lock", "auto")   # klíče DO_ROLES z jádra
EXTRA = {"AnalogIn": ("limHi", "limLo"), "AnalogOut": ("setpoint",),
         "Vfd": ("setpoint", "rampS"), "PropValve": ("setpoint", "rampS", "tol", "tolTimeS"),
         "PosDrive": ("selBits",)}


def _is_num(v) -> bool:
    """Konečné číslo (bool ani NaN se nepočítá)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v \
        and v not in (float("inf"), float("-inf"))


def apply_proposal(app) -> None:
    """Převezme navrženou sestavu do projektu (nahradí zařízení i sekvenci)."""
    pr = app.ai.get("last")
    if not pr or not pr["devices"]:
        return
    p = app.prj
    # zařízení se stejným označením a třídou si nechá GUID (identita pro opakovaný export do EPLAN)
    old_guid = {(d["name"], d["cls"]): d["guid"] for d in p["devices"] if d.get("guid")}
    p["devices"], p["io"], p["nextId"] = [], [], 1
    by_name = {}
    for d in pr["devices"]:
        name = d["name"] or app.core("nextName", p, d["cls"])
        nd = {"id": p["nextId"], "name": name, "cls": d["cls"], "desc": d["desc"],
              "opt": d["opt"], "unit": d["unit"], "rmin": d["rmin"], "rmax": d["rmax"]}
        if (name, d["cls"]) in old_guid:
            nd["guid"] = old_guid[(name, d["cls"])]
        # meze měření, žádaná hodnota a role výstupu (aiNorm je pustí jen u správné třídy)
        for key in EXTRA.get(d["cls"], ()):
            if _is_num(d.get(key)):
                nd[key] = d[key]
        if d["cls"] == "DO" and d.get("role") in DO_ROLES:
            nd["role"] = d["role"]
        if d["cls"] == "PosDrive" and isinstance(d.get("records"), list):
            nd["records"] = d["records"]
        if d["cls"] == "Axis" and isinstance(d.get("axis"), dict):   # konfigurace osy (aiNorm ji pročistil)
            nd["axis"] = d["axis"]
        p["nextId"] += 1
        p["devices"].append(nd)
        by_name[name] = nd
    app.sync()
    p = app.prj
    p["program"]["estop"] = by_name.get(pr["estop"], {}).get("id", "")
    p["program"]["interlocks"] = [by_name[n]["id"] for n in pr.get("interlocks", [])
                                  if n in by_name and by_name[n]["cls"] == "DI"]
    seq = []
    for s in pr["seq"]:
        act = s["act"] if s["act"] in ACTS else "wait"
        dev = by_name.get(s["dev"])
        wait_di = act in WAIT_ACTS
        # čekání jen na zařízení třídy DI; přechod je vždy zpětné hlášení (stav vstupu)
        dev_id = dev["id"] if dev and act != "wait" and (not wait_di or dev["cls"] == "DI") else 0
        step = {"dev": dev_id, "act": act,
                "cond": "fbk" if wait_di else s["cond"], "timeS": s["timeS"]}
        for key in ("sp", "rec", "pos", "vel", "acc", "dec"):   # parametry kroků pohonů a osy (aiNorm je pustí jen platné)
            if _is_num(s.get(key)):
                step[key] = s[key]
        if isinstance(s.get("posRef"), str) and s["posRef"]:
            step["posRef"] = s["posRef"]
        if s.get("rev") is True:
            step["rev"] = True
        if step["act"] == "wait" or step["dev"]:
            seq.append(step)
    p["program"]["seq"] = seq
    takt = pr.get("takt")
    if _is_num(takt) and takt > 0:
        p["meta"]["takt"] = takt
    app.step = 3
    app.save()
    app.render()


def _turn_lines(app, turn: dict) -> list[tuple[str, str]]:
    """Jedna zpráva konverzace → řádky ``(text, značka)`` pro okno chatu."""
    if turn["role"] == "user":
        return [(_("Ty") + "\n", "who"), (turn["content"] + "\n\n", "user")]
    try:
        r = app.bridge.ai("aiNorm", json.loads(turn["content"]))
    except (ValueError, BridgeError):
        return [("AI\n", "who"), (turn["content"][:300] + "\n\n", "ai")]
    out = [(_("AI návrhář") + "\n", "who")]
    if r["questions"]:
        out.append((_("Potřebuji upřesnit:") + "\n", "bold"))
        out += [(f"  • {q}\n", "ai") for q in r["questions"]]
    if r["devices"]:
        if r["seq"]:
            text = _("Navrženo {n} zařízení a sekvence o {k} krocích.",
                     n=len(r["devices"]), k=len(r["seq"]))
        else:
            text = _("Navrženo {n} zařízení.", n=len(r["devices"]))
        out.append((text + "\n", "ai"))
    if r["note"]:
        out.append((r["note"] + "\n", "hint"))
    out.append(("\n", "ai"))
    return out


def _safe_list(key: str) -> tuple[bool, object]:
    try:
        return True, ai_client.list_models(key)
    except ai_client.AiError as exc:
        # bez podrobností dřív ukázal jen kód („network“)
        return False, exc.detail or (_(ERRORS[exc.code]) if exc.code in ERRORS
                                     else _("Nepodařilo se spojit s API."))
    except Exception as exc:  # noqa: BLE001 — tlačítko by zůstalo navždy neaktivní
        return False, f"{type(exc).__name__}: {exc}"


def render(app, parent) -> None:
    ui = app.ui.setdefault("ai", {"busy": False, "token": 0, "status": ""})
    ai = app.ai
    body = card(parent, "02", _("AI návrh systému"))
    wrap_label(body, _(
        "Popiš stroj vlastními slovy — co dělá, jaké má pohony, válce, co se měří "
        "a hlídá. AI navrhne sestavu zařízení, případně se nejdřív doptá na detaily. "
        "Návrh převezmeš a doladíš v dalších krocích; AI zná i tvou aktuální sestavu, "
        "takže můžeš kdykoli psát jen úpravy."))

    # --- nastavení ---
    cfg = ttk.Frame(body)
    cfg.pack(fill="x", pady=(8, 6))
    ttk.Label(cfg, text=_("Anthropic API klíč:")).pack(side="left")
    var_key = tk.StringVar(value=app.settings.get("ai_key", ""))
    ttk.Entry(cfg, textvariable=var_key, show="•", width=34).pack(side="left", padx=(6, 14))
    ttk.Label(cfg, text=_("klíč z console.anthropic.com; ukládá se jen na tomto počítači, "
                          "dotazy jsou placené"), style="Dim.TLabel").pack(side="left")

    # --- výběr modelu: známé + načtené pro klíč (GET /v1/models, neúčtuje se) + vlastní ID ---
    mrow = ttk.Frame(body)
    mrow.pack(fill="x", pady=(0, 6))
    ttk.Label(mrow, text=_("Model:")).pack(side="left")
    var_model = tk.StringVar(value=app.settings.get("ai_model") or ai_client.DEFAULT_MODEL)

    def model_values() -> list[str]:
        got = [m for m in app.settings.get("ai_models") or [] if m not in ai_client.MODELS]
        return ai_client.MODELS + got

    cb_model = ttk.Combobox(mrow, textvariable=var_model, values=model_values(), width=30)
    cb_model.pack(side="left", padx=(6, 8))
    lbl_model = ttk.Label(mrow, text="", style="Dim.TLabel")

    def show_label(*_a):
        mid = var_model.get().strip()
        known = ai_client.model_label(mid)
        avail = app.settings.get("ai_models") or []
        txt = _(known) if known else _("vlastní ID modelu")
        if avail and mid not in avail:
            txt += " · " + _("pro tento klíč není v seznamu dostupných")
        lbl_model.configure(text=txt)

    def fetch_models():
        key = var_key.get().strip()
        if not key:
            lbl_model.configure(text=_("Nejdřív zadej API klíč."))
            return
        btn_fetch.state(["disabled"])
        lbl_model.configure(text=_("Načítám dostupné modely…"))
        box: queue.Queue = queue.Queue()
        threading.Thread(target=lambda: box.put(_safe_list(key)), daemon=True).start()

        def poll():
            if box.empty():
                mrow.after(150, poll)
                return
            ok, res = box.get()
            if not mrow.winfo_exists():
                return
            btn_fetch.state(["!disabled"])
            if ok:
                app.settings["ai_models"] = res
                app.save_settings()
                cb_model.configure(values=model_values())
                show_label()
                lbl_model.configure(text=lbl_model.cget("text") + " · "
                                    + _("dostupných modelů: {n}", n=len(res)))
            else:
                lbl_model.configure(text=_("Seznam modelů nejde načíst: {err}", err=res))
        poll()

    btn_fetch = ttk.Button(mrow, text=_("Načíst dostupné modely"), command=fetch_models)
    btn_fetch.pack(side="left", padx=(0, 10))
    lbl_model.pack(side="left")
    show_label()

    def save_cfg(*_a):
        app.settings["ai_key"] = var_key.get().strip()
        app.settings["ai_model"] = var_model.get().strip() or ai_client.DEFAULT_MODEL
        app.save_settings()

    var_key.trace_add("write", save_cfg)
    var_model.trace_add("write", save_cfg)
    var_model.trace_add("write", show_label)
    cfg._vars = (var_key, var_model)  # StringVar nesmí zaniknout s funkcí (prázdné pole)

    # --- návrh (dole, ať ho vstup nevytlačí) ---
    pr = ai.get("last")
    if pr and pr["devices"]:
        prop = ttk.Frame(body)
        prop.pack(side="bottom", fill="x", pady=(10, 0))
        ttk.Label(prop, text=_("Navržená sestava"), style="Section.TLabel").pack(anchor="w")
        tbl = Table(prop, [("name", _("Označení"), 90, False), ("cls", _("Třída"), 190, False),
                           ("desc", _("Popis"), 360, True), ("opt", _("Volby"), 240, True)],
                    height=min(5, len(pr["devices"])))
        tbl.pack(fill="x", pady=(4, 0))
        # v nízkém okně by plná tabulka vytlačila konverzaci (balí se poslední) — zmenšit ji
        rows = min(5, len(pr["devices"]))
        body.bind("<Configure>", lambda e: tbl.tv.configure(
            height=rows if e.height >= 600 else min(rows, 2)), add="+")
        for i, d in enumerate(pr["devices"]):
            # volby, meze a role stejně jako v kroku Zařízení (přeložené popisky, ne klíče)
            tbl.add(i, (d["name"], app.CLS[d["cls"]]["label"], d["desc"], _opts_text(app, d)))
        if pr["seq"]:
            def step_txt(s: dict) -> str:
                if s["act"] == "wait":
                    return _("výdrž {t} s", t=f"{s['timeS']:g}")
                if s["act"] == "waitOn":
                    return _("čekat na {dev}", dev=s["dev"])
                if s["act"] == "waitOff":
                    return _("čekat na {dev} = FALSE", dev=s["dev"])
                act = _(ACT_LABEL[s["act"]]) if s["act"] in ACT_LABEL else s["act"]
                return f"{s['dev']} {act}"

            steps = " → ".join(f"{i + 1}. " + step_txt(s) for i, s in enumerate(pr["seq"]))
            wrap_label(prop, _("Sekvence: {steps}", steps=steps), pady=(4, 0))
        row = ttk.Frame(prop)
        row.pack(fill="x", pady=(6, 0))
        ttk.Button(row, text=_("Převzít návrh (nahradí zařízení)"), style="Accent.TButton",
                   command=lambda: apply_proposal(app)).pack(side="left")
        ttk.Label(row, text=_("Nesedí? Napiš upřesnění a odešli znovu."),
                  style="Dim.TLabel").pack(side="left", padx=10)

    # --- tlačítka a vstup (nad návrhem) ---
    btns = ttk.Frame(body)
    btns.pack(side="bottom", fill="x", pady=(6, 0))
    in_frm, txt_in = scrolled_text(body, height=3)
    in_frm.pack(side="bottom", fill="x", pady=(8, 0))
    txt_in.insert("1.0", ai.get("draft") or "")
    body.bind("<Configure>", lambda e: txt_in.configure(height=3 if e.height >= 600 else 2),
              add="+")                    # nízké okno: víc místa pro konverzaci

    def on_draft(_e=None):
        ai["draft"] = txt_in.get("1.0", "end-1c")
        app.save()

    txt_in.bind("<KeyRelease>", on_draft)

    status = ttk.Label(btns, text=ui["status"], style="Err.TLabel")
    ui["status"] = ""

    def send() -> None:
        msg = txt_in.get("1.0", "end-1c").strip()
        if ui["busy"]:
            return
        if not msg:
            status.configure(text=_("Nejdřív popiš stroj (nebo klikni na Vložit příklad)."))
            txt_in.focus_set()
            return
        key = app.settings.get("ai_key", "")
        if not key:
            status.configure(text=_("Doplň API klíč v nastavení výše."))
            return
        ui["busy"] = True
        ui["token"] += 1
        token = ui["token"]
        ai["turns"].append({"role": "user", "content": msg})
        ai["draft"] = ""
        app.save()
        messages = [{"role": "user", "content": app.bridge.ai("aiInstructions", app.prj)},
                    *ai["turns"]]
        model = app.settings.get("ai_model") or ai_client.DEFAULT_MODEL
        box: queue.Queue = queue.Queue()

        def work():
            try:
                box.put(("ok", ai_client.call(key, model, messages)))
            except ai_client.AiError as exc:
                box.put(("err", exc))
            except Exception as exc:  # noqa: BLE001 — jinak by dotaz navždy „přemýšlel“
                box.put(("err", ai_client.AiError("api_error", f"{type(exc).__name__}: {exc}")))

        threading.Thread(target=work, daemon=True).start()
        # nejdřív překreslit do stavu „Přemýšlím…", výsledek vyzvednout až potom —
        # jinak by rychlá odpověď (chyba) byla tímto překreslením hned smazána
        app.render()
        app.root.after(100, lambda: _poll(app, ui, token, box))

    def stop() -> None:
        if ui["busy"]:
            _abort(app, ui, txt="")

    def clear() -> None:
        ui["token"] += 1
        ui["busy"] = False
        app.ai = {"turns": [], "last": None, "draft": ""}
        app.save()
        app.render()

    def example() -> None:
        txt_in.delete("1.0", "end")
        txt_in.insert("1.0", app.AI_EXAMPLE)
        on_draft()
        txt_in.focus_set()
        status.configure(text="")

    b_send = ttk.Button(btns, style="Accent.TButton", command=send,
                        text=_("Odeslat upřesnění") if ai["turns"] else _("Navrhnout zařízení"))
    b_send.pack(side="left")
    if ui["busy"]:
        b_send.state(["disabled"])
        ttk.Button(btns, text=_("Stop"), command=stop).pack(side="left", padx=(6, 0))
        ttk.Label(btns, text=_("Přemýšlím…"), style="Section.TLabel").pack(side="left", padx=10)
    if not ai["turns"]:
        ttk.Button(btns, text=_("Vložit příklad"), command=example).pack(side="left", padx=(6, 0))
    elif not ui["busy"]:
        ttk.Button(btns, text=_("Nová konverzace"), style="Danger.TButton", command=clear
                   ).pack(side="left", padx=(6, 0))
    status.pack(side="left", padx=10)

    # --- konverzace (zbytek místa) ---
    chat_frm, chat = scrolled_text(body, height=6)
    chat_frm.pack(fill="both", expand=True)
    chat.tag_configure("who", foreground=theme.DIM, font=theme.FONT_DIM)
    chat.tag_configure("user", foreground=theme.FG, lmargin1=8, lmargin2=8)
    chat.tag_configure("ai", foreground=theme.PRIMARY, lmargin1=8, lmargin2=8)
    chat.tag_configure("bold", foreground=theme.PRIMARY, font=theme.FONT_ACCENT, lmargin1=8)
    chat.tag_configure("hint", foreground=theme.DIM, lmargin1=8, lmargin2=8)
    if ai["turns"]:
        for turn in ai["turns"]:
            for text, tag in _turn_lines(app, turn):
                chat.insert("end", text, tag)
    else:
        chat.insert("end", _("Konverzace je prázdná — napiš popis stroje níže."), "hint")
    chat.configure(state="disabled")
    chat.see("end")


def _abort(app, ui: dict, txt: str) -> None:
    """Zruší rozpracovaný dotaz: vrátí popis do vstupu a zahodí odpověď."""
    ui["token"] += 1
    ui["busy"] = False
    if app.ai["turns"] and app.ai["turns"][-1]["role"] == "user":
        app.ai["draft"] = app.ai["turns"].pop()["content"]
    ui["status"] = txt
    app.save()
    if app.step == 1:
        app.render()


def _poll(app, ui: dict, token: int, box: queue.Queue) -> None:
    """Čeká na výsledek z pracovního vlákna (Tk se smí dotýkat jen hlavní vlákno)."""
    if ui["token"] != token:
        return  # zrušeno tlačítkem Stop nebo novou konverzací
    try:
        kind, value = box.get_nowait()
    except queue.Empty:
        app.root.after(150, lambda: _poll(app, ui, token, box))
        return
    if kind == "ok":
        try:
            res = app.bridge.ai("extractJson", value)
        except BridgeError as exc:
            _abort(app, ui, _(ERRORS[exc.code]) if exc.code in ERRORS
                   else _("Nepodařilo se získat odpověď: {detail}", detail=exc))
            return
        app.ai["turns"].append({"role": "assistant",
                                "content": json.dumps(res, ensure_ascii=False)})
        norm = app.bridge.ai("aiNorm", res)
        if norm["devices"]:
            app.ai["last"] = norm
        ui["busy"] = False
        app.save()
        if app.step == 1:
            app.render()
        else:
            app.set_status(_("AI návrhář odpověděl — viz krok AI návrh."))
    else:
        if value.code in ERRORS:
            text = _(ERRORS[value.code])
        elif value.detail:
            text = _("Nepodařilo se získat odpověď: {detail}", detail=value.detail)
        else:
            text = _("Nepodařilo se získat odpověď — zkus to znovu.")
        _abort(app, ui, text)
