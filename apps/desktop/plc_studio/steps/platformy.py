"""Krok 3 — Cílové platformy: výběr jedné nebo více platforem (klikací karty)."""

from __future__ import annotations

import base64
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from .. import __version__, theme
from ..bridge import BridgeError
from ..i18n import _
from ..license import site_url
from ..widgets import card, scroll_area, tooltip, wrap_label

COLS = 3
# barva štítku ověření podle stavu (jako web: ověřeno = OK, jazyk = akcent, beta = varování)
VERIF_FG = {"verified": theme.OK, "lang": theme.ACCENT, "beta": theme.WARN, "unsupported": theme.ERR}


def render(app, parent) -> None:
    # 20 platforem se do nízkého okna nevejde: celý krok je posuvný (jinak by mřížka karet
    # vytlačila z okna souhrn a přepínač stylu kódu Klasický / OOP)
    area, inner = scroll_area(parent)
    area.pack(fill="both", expand=True)
    body = card(inner, "03", _("Cílové platformy"))
    wrap_label(body, _(
        "Vyber jednu nebo víc platforem — program se vygeneruje pro každou zvlášť. "
        "Logika je stejná (IEC 61131-3 ST), liší se dialekt, soubor s tagy a postup importu."))

    grid = ttk.Frame(body)
    grid.pack(fill="x", pady=(10, 0))
    for c in range(COLS):
        grid.columnconfigure(c, weight=1, uniform="plat")

    def toggle(key: str) -> None:
        app.ui["plat_y"] = area.canvas.canvasy(0)      # po překreslení zůstat na stejném místě
        plats = app.prj["platforms"]
        if key in plats:
            plats.remove(key)
        else:
            plats.append(key)
        app.save()
        app.render()

    # nejdřív základní platformy, pod nadpisem profily CODESYS dalších výrobců (PLAT[k].base)
    own = [(k, pf) for k, pf in app.PLAT.items() if not pf.get("base")]
    prof = [(k, pf) for k, pf in app.PLAT.items() if pf.get("base")]
    cells = []
    for i, item in enumerate(own):
        cells.append((i // COLS, i % COLS, item))
    head_row = (len(own) + COLS - 1) // COLS
    if prof:
        ttk.Label(grid, style="Dim.TLabel", text=_(
            "Další řídicí systémy na bázi CODESYS — stejný kód jako CODESYS, postup importu, "
            "I/O a kusovník podle výrobce:")).grid(row=head_row, column=0, columnspan=COLS, sticky="w", padx=5, pady=(10, 0))
    for i, item in enumerate(prof):
        cells.append((head_row + 1 + i // COLS, i % COLS, item))
    # servoosa: platformy, které osu negenerují (Mitsubishi, Schneider, Unitronics…), dostanou varování
    # s důvodem v bublině (jádro axisSupport — jako web)
    no_axis: dict[str, str] = {}
    if any(d["cls"] == "Axis" for d in app.prj["devices"]):
        for key in app.PLAT:
            try:
                sup = app.core("axisSupport", app.prj, key)
            except BridgeError:
                continue
            if not sup["ok"]:
                no_axis[key] = sup["why"]
    for row, col, (key, pf) in cells:
        on = key in app.prj["platforms"]
        bg = theme.TREE_SEL if on else theme.FIELD
        box = tk.Frame(grid, bg=bg, cursor="hand2", highlightthickness=2 if on else 1,
                       highlightbackground=theme.ACCENT if on else theme.BORDER)
        box.grid(row=row, column=col, sticky="nsew", padx=5, pady=5)
        box.columnconfigure(0, weight=1)
        parts = [
            tk.Label(box, text=("✔ " if on else "") + pf["name"], bg=bg, anchor="w",
                     fg=theme.PRIMARY, font=("Segoe UI", 11, "bold")),
            tk.Label(box, text=f"{pf['ide']} · {pf['cpu']}", bg=bg, fg=theme.FG, anchor="w",
                     font=theme.FONT_DIM, justify="left"),
            tk.Label(box, text=f"{pf['lang']} · {pf['imp']}", bg=bg, fg=theme.DIM, anchor="w",
                     font=theme.FONT_DIM, justify="left"),
        ]
        for lbl in parts[1:]:            # zalamovat podle šířky karty, ne pevně
            lbl.bind("<Configure>", lambda e: e.widget.configure(wraplength=max(150, e.width - 4)))
        parts[0].grid(row=0, column=0, sticky="ew", padx=(12, 4), pady=(10, 2))
        parts[1].grid(row=1, column=0, columnspan=2, sticky="ew", padx=12)
        parts[2].grid(row=2, column=0, columnspan=2, sticky="ew", padx=12, pady=(2, 10))
        if key in no_axis:
            parts[2].grid_configure(pady=(2, 0))
            warn = tk.Label(box, text="⚠ " + _("servoosu nepodporuje"), bg=bg, fg=theme.WARN, anchor="w",
                            font=theme.FONT_DIM, cursor="question_arrow")
            warn.grid(row=3, column=0, columnspan=2, sticky="ew", padx=12, pady=(2, 10))
            warn.axis_warning = True                 # testy
            tooltip(warn, no_axis[key])
            parts.append(warn)
        # štítek ověření (data/verification.json) + bublina: význam, co ověřeno, kde, co neověřeno
        ver = app.VERIF.get(key)
        if ver:
            fg = VERIF_FG.get(ver["state"], theme.DIM)
            chip = tk.Label(box, text=ver["label"], bg=bg, fg=fg, font=("Segoe UI", 8), padx=6, pady=0,
                            highlightthickness=1, highlightbackground=fg, cursor="question_arrow")
            chip.grid(row=0, column=1, sticky="ne", padx=(0, 10), pady=(12, 0))
            chip.verif_state = ver["state"]          # pro testy
            tooltip(chip, ver["tip"])
            parts.append(chip)
            if ver["state"] == "beta":
                verify_pack_row(app, box, bg, key, pf)
        for w in (box, *parts):
            w.bind("<Button-1>", lambda _e, k=key: toggle(k), add="+")

    wrap_label(body, _(
        "Štítek u platformy říká, jak je výstup ověřený: ověřeno v IDE (import a překlad ve skutečném "
        "vývojovém prostředí), jazyk ověřen (překladačem, ne v IDE výrobce), beta (jen emulátor PLCdesk). "
        "Co ověřené není, ukáže bublina nad štítkem."), pady=(8, 0))
    n = len(app.prj["platforms"])
    ttk.Label(body, style="Dim.TLabel" if n else "Err.TLabel",
              text=_("Vybráno platforem: {n}", n=n) if n else
              _("Není vybraná žádná platforma — bez ní se nevygeneruje žádný kód.")
              ).pack(anchor="w", pady=(10, 0))
    code_style(app, body, area.canvas)
    area.bind_wheel()
    area.restore_y = app.ui.get("plat_y") or None


def source_commit(root: Path | None = None) -> str | None:
    """Commit zdrojů ze složky .git (i worktree) bez spouštění gitu; přenosná verze → None."""
    root = root or Path(__file__).resolve().parents[4]
    try:
        meta = root / ".git"
        gdir = meta
        if meta.is_file():                         # worktree: „gitdir: <cesta>“
            gdir = Path(meta.read_text(encoding="utf-8").split(":", 1)[1].strip())
        head = (gdir / "HEAD").read_text(encoding="utf-8").strip()
        if not head.startswith("ref:"):
            return head[:12] or None
        ref = head[4:].strip()
        common = gdir
        if (gdir / "commondir").is_file():
            common = (gdir / (gdir / "commondir").read_text(encoding="utf-8").strip()).resolve()
        for base in (gdir, common):
            if (base / ref).is_file():
                return (base / ref).read_text(encoding="utf-8").strip()[:12] or None
        packed = common / "packed-refs"
        if packed.is_file():
            for line in packed.read_text(encoding="utf-8").splitlines():
                if line.endswith(" " + ref):
                    return line.split(" ", 1)[0][:12]
    except (OSError, IndexError):
        pass
    return None


def verify_pack_row(app, box, bg: str, key: str, pf: dict) -> None:
    """Platforma ve stavu beta: tlačítko „Balík k ověření“ + výzva s odkazem na Kontakt webu.
    Klik sem nepřepíná výběr platformy (vazba toggle je jen na kartě a jejích popiscích)."""
    # přímo do mřížky karty (bez vnořeného tk.Frame — karty se v testech počítají podle tk.Frame)
    btn = ttk.Button(box, text=_("Balík k ověření"))
    btn.configure(command=lambda: download_verify_pack(app, key, btn))
    btn.grid(row=4, column=0, columnspan=2, sticky="w", padx=12)
    btn.verify_pack = key                      # pro testy
    msg = tk.Label(box, text=_("Máte {ide}? Ověřte import a pošlete nám protokol — licenci Pro "
                               "dostanete zdarma.", ide=pf["ide"]),
                   bg=bg, fg=theme.DIM, font=theme.FONT_DIM, justify="left", anchor="w")
    msg.grid(row=5, column=0, columnspan=2, sticky="ew", padx=12, pady=(4, 0))
    msg.bind("<Configure>", lambda e: e.widget.configure(wraplength=max(150, e.width - 4)))
    link = tk.Label(box, text=_("Kontakt"), bg=bg, fg=theme.ACCENT, cursor="hand2",
                    font=theme.FONT_DIM + ("underline",), anchor="w")
    link.grid(row=6, column=0, sticky="w", padx=12, pady=(0, 10))
    link.bind("<Button-1>", lambda _e: webbrowser.open(site_url("kontakt", app.lang)))


def save_verify_pack(app, res: dict, path: str | None = None) -> str | None:
    """Uloží ZIP balíku (dialog „Uložit jako“, v testech ``path``). Bez licenční brány: balík
    není výstup projektu uživatele (pevné vzory) — stahuje se i ve Free a nad limitem I/O."""
    if path is None:
        path = filedialog.asksaveasfilename(
            parent=app.root, title=_("Uložit balík k ověření"), initialfile=res["name"],
            initialdir=app.settings.get("last_dir") or None, defaultextension=".zip",
            filetypes=[(_("Archiv ZIP"), "*.zip"), (_("Všechny soubory"), "*.*")])
        if not path:
            return None
    try:
        Path(path).write_bytes(base64.b64decode(res["zip"]))
    except OSError as exc:
        messagebox.showerror(_("Uložení se nezdařilo"), str(exc), parent=app.root)
        return None
    app.settings["last_dir"] = str(Path(path).parent)
    app.set_status(_("Balík k ověření uložen: {path}", path=path))
    return path


def download_verify_pack(app, key: str, btn=None, path: str | None = None):
    """Balík se skládá v pracovním procesu mostu (okno nezamrzne); po dokončení dialog uložení."""
    job = app.bridge.submit("verifypack", {"plat": key, "version": __version__,
                                           "commit": source_commit()},
                            preemptible=False, cache=False)
    label = None
    if btn is not None:
        label = btn.cget("text")
        btn.configure(text=_("Připravuji balík…"), state="disabled")

    def done(j) -> None:
        try:
            if btn is not None and btn.winfo_exists():
                btn.configure(text=label, state="normal")
        except tk.TclError:
            pass
        if j.state == "cancelled":
            return
        try:
            res = j.result()
        except BridgeError as exc:
            messagebox.showerror(_("Balík se nepodařilo připravit"), str(exc), parent=app.root)
            return
        save_verify_pack(app, res, path)

    app.on_job(job, done, owner=btn)
    return job


def code_style(app, body, canvas=None) -> None:
    """Styl kódu Klasický / OOP — jen když je vybraná platforma, která OOP umí (rodina CODESYS)."""
    oop_plats = [k for k in app.prj["platforms"] if (app.PLAT.get(k) or {}).get("oop")]
    if not oop_plats:
        return
    box = ttk.LabelFrame(body, text=_("Styl kódu"), padding=(10, 6))
    box.pack(fill="x", pady=(12, 0))
    # Tk proměnnou držet živou (bez reference ji GC uklidí a přepínač zbělá)
    app._code_style_var = var = tk.StringVar(value="oop" if app.prj.get("codeStyle") == "oop" else "classic")

    def changed() -> None:
        if canvas is not None:                     # posuvný krok: zůstat dole u přepínače
            app.ui["plat_y"] = canvas.canvasy(0)
        if var.get() == "oop":
            app.prj["codeStyle"] = "oop"
        else:
            app.prj.pop("codeStyle", None)
        app.save()
        app.render()

    row = ttk.Frame(box)
    row.pack(anchor="w")
    ttk.Radiobutton(row, text=_("Klasický (doporučeno)"), value="classic", variable=var,
                    command=changed).pack(side="left", padx=(0, 18))
    ttk.Radiobutton(row, text=_("OOP"), value="oop", variable=var, command=changed).pack(side="left")
    wrap_label(box, _(
        "OOP: rozhraní I_Device, abstraktní základ FB_DeviceBase, třídy zařízení s metodami a "
        "vlastnostmi, sekvence ve FB_Sequence. Chování je stejné jako u klasického stylu (ověřuje "
        "emulátor), mění se jen zápis. Platí pro: {list}; ostatní platformy dostanou klasický kód.",
        list=", ".join(app.PLAT[k]["name"] for k in oop_plats)))
