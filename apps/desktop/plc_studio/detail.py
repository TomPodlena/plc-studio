"""Panel zařízení — rozcestník mezi schématy, zařízeními, I/O a programem.

Ukáže popis zařízení, jeho vstupy a výstupy (tag → krok I/O, svorka → list
zapojení) a kde zařízení vystupuje v programu. Stejný panel je u blokového
schématu, funkčního diagramu i v kroku Zařízení, takže odkazy fungují
všude stejně.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from . import theme
from .widgets import link

DIR_COLOR = {"DI": "#1F6FB2", "DO": theme.ACCENT, "AI": "#7A4FB5", "AO": theme.WARN}
ACT = {"start": "start", "stop": "stop", "open": "otevřít", "close": "zavřít"}


def step_text(app, s: dict) -> str:
    """Krok sekvence slovy: akce a podmínka přechodu."""
    if s["act"] == "wait":
        return f"výdrž {s['timeS']:g} s"
    d = app.dev_by_id(s["dev"])
    how = f"čas {s['timeS']:g} s" if s["cond"] == "time" else "zpětné hlášení"
    return f"{d['name'] if d else '?'} {ACT.get(s['act'], s['act'])} → {how}"


class DevicePanel(ttk.Frame):
    """``here`` = místo, kde panel je ("zarizeni" / "blok" / "flow") — odkaz
    sám na sebe se nezobrazuje. ``terms`` = svorky signálů z mostu."""

    def __init__(self, parent, app, terms: dict, *, here: str = "", width: int = 350,
                 empty: str = "Klikni na blok ve schématu — zobrazí se popis zařízení "
                              "s odkazy na jeho vstupy, výstupy a kroky programu."):
        super().__init__(parent, width=width)
        self.app, self.terms, self.here, self.empty = app, terms, here, empty
        self.dev_id: int | None = None
        self._inner_w = width - 18          # místo na posuvník

        # obsah se posouvá, když se nevejde (zařízení s mnoha signály / kroky)
        canvas = self._canvas = tk.Canvas(self, bg=theme.BG, highlightthickness=0)
        self._bar = ttk.Scrollbar(self, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=self._bar.set)
        self.grid_propagate(False)
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)
        canvas.grid(row=0, column=0, sticky="nsew")
        self._bar.grid(row=0, column=1, sticky="ns")
        self._bar.grid_remove()
        self.body = ttk.Frame(canvas)
        canvas.create_window(0, 0, window=self.body, anchor="nw", width=self._inner_w)
        self.body.bind("<Configure>", self._layout)
        canvas.bind("<Configure>", self._layout)
        canvas.bind("<MouseWheel>", self._wheel)
        self.show(None)

    # --- pomůcky -------------------------------------------------------------------

    def _layout(self, _e=None) -> None:
        need = self.body.winfo_reqheight()
        self._canvas.configure(scrollregion=(0, 0, self._inner_w, need))
        if need > self._canvas.winfo_height() > 1:
            self._bar.grid()
        else:
            self._bar.grid_remove()
            self._canvas.yview_moveto(0)

    def _wheel(self, e) -> None:
        if self._bar.winfo_ismapped():
            self._canvas.yview_scroll(-1 if e.delta > 0 else 1, "units")

    def _section(self, text: str) -> None:
        ttk.Label(self.body, text=text, style="Section.TLabel").pack(anchor="w", pady=(12, 2))

    def _wrap(self, text: str, style: str = "TLabel", **pack) -> None:
        ttk.Label(self.body, text=text, style=style, wraplength=self._inner_w - 8,
                  justify="left").pack(**({"anchor": "w"} | pack))

    # --- obsah ---------------------------------------------------------------------

    def show(self, dev_id: int | None, *, io_key: str | None = None,
             step: int | None = None) -> None:
        """Zobrazí zařízení (a případně krok sekvence, ze kterého se přišlo)."""
        self._fill(dev_id, io_key, step)

        def bind_wheel(w) -> None:          # kolečko má posouvat i nad texty a odkazy
            w.bind("<MouseWheel>", self._wheel)
            for child in w.winfo_children():
                bind_wheel(child)

        bind_wheel(self.body)

    def _fill(self, dev_id: int | None, io_key: str | None, step: int | None) -> None:
        app = self.app
        for w in self.body.winfo_children():
            w.destroy()
        self._canvas.yview_moveto(0)
        self.dev_id = dev_id
        d = app.dev_by_id(dev_id) if dev_id is not None else None
        seq = app.prj["program"]["seq"]

        if step is not None:
            if step < 0:
                ttk.Label(self.body,text="Krok 0 · Klid", style="CardTitle.TLabel").pack(anchor="w")
                self._wrap("Sekvence čeká na režim AUTO a povel start. Při ztrátě enable "
                           "(E-stop) se sem vrací a bloky vypnou výstupy.", pady=(2, 0))
            elif step < len(seq):
                ttk.Label(self.body,text=f"Krok {step + 1}", style="CardTitle.TLabel").pack(anchor="w")
                self._wrap(step_text(app, seq[step]), pady=(2, 0))
            row = ttk.Frame(self.body)
            row.pack(anchor="w", pady=(4, 0))
            if step >= 0:
                link(row, "Upravit v programu ↗", lambda: app.open_program(step)).pack(side="left")
            link(row, "Simulace ↗", lambda: app.open_sim()).pack(side="left", padx=(12, 0))
            if d is not None:
                ttk.Separator(self.body,orient="horizontal").pack(fill="x", pady=(10, 8))

        if d is None:
            if step is None:
                self._wrap(self.empty, "Dim.TLabel")
            return

        cls = app.CLS[d["cls"]]
        ttk.Label(self.body,text=f"{d['name']} · {cls['label']}", style="CardTitle.TLabel"
                  ).pack(anchor="w")
        self._wrap(d["desc"] or "(bez popisu)", pady=(2, 0))
        opts = [cls["opts"].get(k, k) for k, v in (d.get("opt") or {}).items() if v]
        if d["cls"].startswith("Analog"):
            opts.append(f"rozsah {d['rmin']:g}–{d['rmax']:g} {d.get('unit') or ''}".strip())
        if opts:
            self._wrap(", ".join(opts), "Dim.TLabel", pady=(2, 0))

        row = ttk.Frame(self.body)
        row.pack(anchor="w", pady=(6, 0))
        targets = [("zarizeni", "Zařízení ↗", lambda: app.open_device(d["id"])),
                   ("blok", "Blokové schéma ↗", lambda: app.open_block(d["id"]))]
        for i, (where, text, cmd) in enumerate(t for t in targets if t[0] != self.here):
            link(row, text, cmd).pack(side="left", padx=(12 if i else 0, 0))

        # --- vstupy a výstupy ---
        self._section("Vstupy a výstupy")
        ios = [e for e in app.prj["io"] if e["devId"] == d["id"]]
        for e in ios:
            hot = e["key"] == io_key
            bg = theme.TREE_SEL if hot else theme.BG
            box = tk.Frame(self.body, bg=bg)
            box.pack(fill="x", pady=1)
            line = tk.Frame(box, bg=bg)
            line.pack(fill="x")
            tk.Label(line, text=e["dir"], bg=bg, fg=DIR_COLOR.get(e["dir"], theme.FG),
                     font=("Consolas", 10, "bold"), width=3, anchor="w").pack(side="left")
            link(line, e["tag"], lambda k=e["key"]: app.open_io(k), bg=bg,
                 font=("Consolas", 10)).pack(side="left")
            term = self.terms.get(e["key"])
            if term:
                link(line, f"{term['svorka']} ↗", lambda k=e["key"]: app.open_wiring(k), bg=bg,
                     font=("Consolas", 10)).pack(side="right")
            tk.Label(line, text=e["addr"], bg=bg, fg=theme.FG, font=("Consolas", 10)
                     ).pack(side="right", padx=(0, 10))
            note = e["cmt"] + (" · NC (rozpínací)" if e.get("nc") else "")
            tk.Label(box, text=note, bg=bg, fg=theme.DIM, font=theme.FONT_DIM, anchor="w",
                     justify="left", wraplength=self._inner_w - 40
                     ).pack(fill="x", padx=(28, 0))
        if not ios:
            self._wrap("Zařízení nemá žádné signály.", "Dim.TLabel")
        else:
            self._wrap("tag → krok I/O · svorka → list zapojení", "Dim.TLabel", pady=(4, 0))

        # --- v programu ---
        self._section("V programu")
        used = False
        if app.prj["program"]["estop"] == d["id"]:
            used = True
            link(self.body, "Centrální uvolnění (E-stop) → enable všech bloků ↗",
                 lambda: app.open_program(None)).pack(anchor="w")
        for i, s in enumerate(seq):
            if s["act"] != "wait" and s["dev"] == d["id"]:
                used = True
                row = tk.Frame(self.body, bg=theme.TREE_SEL if i == step else theme.BG)
                row.pack(fill="x", pady=1)
                link(row, f"Krok {i + 1}: {step_text(app, s)}",
                     lambda i=i: app.open_flow(i), bg=row.cget("bg")).pack(side="left")
        if not used:
            kind = ("volný signál pro vlastní logiku" if d["cls"] in ("DI", "DO")
                    else "blok čeká na ruční povel (TODO v generovaném kódu)")
            self._wrap(f"Není v automatické sekvenci — {kind}.", "Dim.TLabel")
        elif self.here != "flow":
            self._wrap("krok → funkční diagram cyklu", "Dim.TLabel", pady=(4, 0))
