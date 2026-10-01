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
from ..widgets import Table, card, scrolled_text, wrap_label

ERRORS = {
    "no_key": "Doplň API klíč v Nastavení AI.",
    "bad_key": "API klíč byl odmítnut (401).",
    "rate_limited": "Příliš mnoho dotazů — zkus to za chvíli.",
    "invalid_json": "Odpověď se nepodařilo přečíst — zkus to znovu.",
}
ACTS = ("start", "stop", "open", "close", "wait")


def apply_proposal(app) -> None:
    """Převezme navrženou sestavu do projektu (nahradí zařízení i sekvenci)."""
    pr = app.ai.get("last")
    if not pr or not pr["devices"]:
        return
    p = app.prj
    p["devices"], p["io"], p["nextId"] = [], [], 1
    by_name = {}
    for d in pr["devices"]:
        name = d["name"] or app.core("nextName", p, d["cls"])
        nd = {"id": p["nextId"], "name": name, "cls": d["cls"], "desc": d["desc"],
              "opt": d["opt"], "unit": d["unit"], "rmin": d["rmin"], "rmax": d["rmax"]}
        p["nextId"] += 1
        p["devices"].append(nd)
        by_name[name] = nd
    app.sync()
    p = app.prj
    p["program"]["estop"] = by_name.get(pr["estop"], {}).get("id", "")
    seq = []
    for s in pr["seq"]:
        step = {"dev": by_name.get(s["dev"], {}).get("id", 0),
                "act": s["act"] if s["act"] in ACTS else "wait",
                "cond": s["cond"], "timeS": s["timeS"]}
        if step["act"] == "wait" or step["dev"]:
            seq.append(step)
    p["program"]["seq"] = seq
    app.step = 3
    app.save()
    app.render()


def _turn_lines(app, turn: dict) -> list[tuple[str, str]]:
    """Jedna zpráva konverzace → řádky ``(text, značka)`` pro okno chatu."""
    if turn["role"] == "user":
        return [("Ty\n", "who"), (turn["content"] + "\n\n", "user")]
    try:
        r = app.bridge.ai("aiNorm", json.loads(turn["content"]))
    except (ValueError, BridgeError):
        return [("AI\n", "who"), (turn["content"][:300] + "\n\n", "ai")]
    out = [("AI návrhář\n", "who")]
    if r["questions"]:
        out.append(("Potřebuji upřesnit:\n", "bold"))
        out += [(f"  • {q}\n", "ai") for q in r["questions"]]
    if r["devices"]:
        seq = f" a sekvence o {len(r['seq'])} krocích" if r["seq"] else ""
        out.append((f"Navrženo {len(r['devices'])} zařízení{seq}.\n", "ai"))
    if r["note"]:
        out.append((r["note"] + "\n", "hint"))
    out.append(("\n", "ai"))
    return out


def render(app, parent) -> None:
    ui = app.ui.setdefault("ai", {"busy": False, "token": 0, "status": ""})
    ai = app.ai
    body = card(parent, "02", "AI návrh systému")
    wrap_label(body, "Popiš stroj vlastními slovy — co dělá, jaké má pohony, válce, co se měří "
               "a hlídá. AI navrhne sestavu zařízení, případně se nejdřív doptá na detaily. "
               "Návrh převezmeš a doladíš v dalších krocích; AI zná i tvou aktuální sestavu, "
               "takže můžeš kdykoli psát jen úpravy.")

    # --- nastavení ---
    cfg = ttk.Frame(body)
    cfg.pack(fill="x", pady=(8, 6))
    ttk.Label(cfg, text="Anthropic API klíč:").pack(side="left")
    var_key = tk.StringVar(value=app.settings.get("ai_key", ""))
    ttk.Entry(cfg, textvariable=var_key, show="•", width=34).pack(side="left", padx=(6, 14))
    ttk.Label(cfg, text="Model:").pack(side="left")
    var_model = tk.StringVar(value=app.settings.get("ai_model") or ai_client.DEFAULT_MODEL)
    ttk.Combobox(cfg, textvariable=var_model, values=ai_client.MODELS, state="readonly",
                 width=26).pack(side="left", padx=(6, 14))
    ttk.Label(cfg, text="klíč z console.anthropic.com; ukládá se jen na tomto počítači, "
                        "dotazy jsou placené", style="Dim.TLabel").pack(side="left")

    def save_cfg(*_):
        app.settings["ai_key"] = var_key.get().strip()
        app.settings["ai_model"] = var_model.get()
        app.save_settings()

    var_key.trace_add("write", save_cfg)
    var_model.trace_add("write", save_cfg)

    # --- návrh (dole, ať ho vstup nevytlačí) ---
    pr = ai.get("last")
    if pr and pr["devices"]:
        prop = ttk.Frame(body)
        prop.pack(side="bottom", fill="x", pady=(10, 0))
        ttk.Label(prop, text="Navržená sestava", style="Section.TLabel").pack(anchor="w")
        tbl = Table(prop, [("name", "Označení", 90, False), ("cls", "Třída", 190, False),
                           ("desc", "Popis", 360, True), ("opt", "Volby", 240, True)],
                    height=min(5, len(pr["devices"])))
        tbl.pack(fill="x", pady=(4, 0))
        for i, d in enumerate(pr["devices"]):
            opts = ", ".join(k for k, v in d["opt"].items() if v)
            if d["cls"].startswith("Analog"):
                opts = f"{opts} {d['unit']} {d['rmin']:g}–{d['rmax']:g}".strip()
            tbl.add(i, (d["name"], app.CLS[d["cls"]]["label"], d["desc"], opts))
        if pr["seq"]:
            steps = " → ".join(
                f"{i + 1}. " + (f"výdrž {s['timeS']:g} s" if s["act"] == "wait"
                                else f"{s['dev']} {s['act']}")
                for i, s in enumerate(pr["seq"]))
            wrap_label(prop, "Sekvence: " + steps, pady=(4, 0))
        row = ttk.Frame(prop)
        row.pack(fill="x", pady=(6, 0))
        ttk.Button(row, text="Převzít návrh (nahradí zařízení)", style="Accent.TButton",
                   command=lambda: apply_proposal(app)).pack(side="left")
        ttk.Label(row, text="Nesedí? Napiš upřesnění a odešli znovu.",
                  style="Dim.TLabel").pack(side="left", padx=10)

    # --- tlačítka a vstup (nad návrhem) ---
    btns = ttk.Frame(body)
    btns.pack(side="bottom", fill="x", pady=(6, 0))
    in_frm, txt_in = scrolled_text(body, height=3)
    in_frm.pack(side="bottom", fill="x", pady=(8, 0))
    txt_in.insert("1.0", ai.get("draft") or "")

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
            status.configure(text="Nejdřív popiš stroj (nebo klikni na Vložit příklad).")
            txt_in.focus_set()
            return
        key = app.settings.get("ai_key", "")
        if not key:
            status.configure(text="Doplň API klíč v nastavení výše.")
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
                        text="Odeslat upřesnění" if ai["turns"] else "Navrhnout zařízení")
    b_send.pack(side="left")
    if ui["busy"]:
        b_send.state(["disabled"])
        ttk.Button(btns, text="Stop", command=stop).pack(side="left", padx=(6, 0))
        ttk.Label(btns, text="Přemýšlím…", style="Section.TLabel").pack(side="left", padx=10)
    if not ai["turns"]:
        ttk.Button(btns, text="Vložit příklad", command=example).pack(side="left", padx=(6, 0))
    elif not ui["busy"]:
        ttk.Button(btns, text="Nová konverzace", style="Danger.TButton", command=clear
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
        chat.insert("end", "Konverzace je prázdná — napiš popis stroje níže.", "hint")
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
            _abort(app, ui, ERRORS.get(exc.code, f"Nepodařilo se získat odpověď: {exc}"))
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
            app.set_status("AI návrhář odpověděl — viz krok AI návrh.")
    else:
        text = ERRORS.get(value.code) or (
            "Nepodařilo se získat odpověď" + (f": {value.detail}" if value.detail
                                               else " — zkus to znovu."))
        _abort(app, ui, text)
