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
from .i18n import N_, _
from .widgets import link

DIR_COLOR = {"DI": theme.SIG_IN, "DO": theme.SIG_OUT, "AI": theme.SIG_AN, "AO": theme.WARN}
ACT = {"start": N_("start"), "stop": N_("stop"), "open": N_("otevřít"), "close": N_("zavřít")}
MOTION_CLS = ("Vfd", "PosDrive", "PropValve", "Axis")   # pohony fáze 2a + servoosa — název kroku z jádra (stepTitle)


def step_text(app, s: dict) -> str:
    """Krok sekvence slovy: akce a podmínka přechodu."""
    if s["act"] == "wait":
        return _("výdrž {t} s", t=f"{s['timeS']:g}")
    d = app.dev_by_id(s["dev"])
    if s["act"] in ("waitOn", "waitOff"):
        name = d["name"] if d else "?"
        what = _("čekat na {dev}", dev=name) if s["act"] == "waitOn" else _("čekat na {dev} = FALSE", dev=name)
        return what + " → " + _("hlídací čas {t} s", t=f"{s['timeS']:g}")
    # u přechodu na zpětné hlášení je čas kroku hlídací (po něm porucha stroje)
    how = (_("čas {t} s", t=f"{s['timeS']:g}") if s["cond"] == "time"
           else _("zpětné hlášení (do {t} s)", t=f"{s['timeS']:g}"))
    if d is not None and d["cls"] in MOTION_CLS:      # otáčky / záznam / žádaná: popis z jádra
        return app.core("stepTitle", app.prj, s) + " → " + how
    act = _(ACT[s["act"]]) if s["act"] in ACT else s["act"]
    return f"{d['name'] if d else '?'} {act} → {how}"


class DevicePanel(ttk.Frame):
    """``here`` = místo, kde panel je ("zarizeni" / "blok" / "flow") — odkaz
    sám na sebe se nezobrazuje. ``terms`` = svorky signálů z mostu."""

    def __init__(self, parent, app, terms: dict, *, here: str = "", width: int = 350,
                 empty: str | None = None, on_change=None):
        super().__init__(parent, width=width)
        if empty is None:               # volající předává text už přeložený
            empty = _("Klikni na blok ve schématu — zobrazí se popis zařízení "
                      "s odkazy na jeho vstupy, výstupy a kroky programu.")
        self.app, self.terms, self.here, self.empty = app, terms, here, empty
        # on_change = panel umí úpravy (popis, parametry, signál) a po uložení zavolá on_change()
        # (schéma se překreslí); bez něj jen čte
        self.on_change = on_change
        self.dev_id: int | None = None
        self.io_key: str | None = None
        self._vars: list = []           # Tk proměnné polí úprav naživu (GC)
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
        self._vars = []
        self._canvas.yview_moveto(0)
        self.dev_id = dev_id
        self.io_key = io_key
        d = app.dev_by_id(dev_id) if dev_id is not None else None
        seq = app.prj["program"]["seq"]

        if step is not None:
            if step < 0:
                ttk.Label(self.body,text=_("Krok 0 · Klid"), style="CardTitle.TLabel").pack(anchor="w")
                self._wrap(_("Sekvence čeká na režim AUTO a povel start. Při ztrátě enable "
                             "(E-stop) se sem vrací a bloky vypnou výstupy."), pady=(2, 0))
            elif step < len(seq):
                ttk.Label(self.body,text=_("Krok {n}", n=step + 1), style="CardTitle.TLabel"
                          ).pack(anchor="w")
                self._wrap(step_text(app, seq[step]), pady=(2, 0))
            row = ttk.Frame(self.body)
            row.pack(anchor="w", pady=(4, 0))
            if step >= 0:
                link(row, _("Upravit v programu") + " ↗", lambda: app.open_program(step)).pack(side="left")
            link(row, _("Simulace") + " ↗", lambda: app.open_sim()).pack(side="left", padx=(12, 0))
            if d is not None:
                ttk.Separator(self.body,orient="horizontal").pack(fill="x", pady=(10, 8))

        if d is None:
            if step is None:
                self._wrap(self.empty, "Dim.TLabel")
            return

        cls = app.CLS[d["cls"]]
        ttk.Label(self.body,text=f"{d['name']} · {cls['label']}", style="CardTitle.TLabel"
                  ).pack(anchor="w")
        self._wrap(d["desc"] or _("(bez popisu)"), pady=(2, 0))
        opts = [cls["opts"].get(k, k) for k, v in (d.get("opt") or {}).items() if v]
        if d["cls"].startswith("Analog") or d["cls"] in ("Vfd", "PropValve"):
            opts.append(_("rozsah {min}–{max} {unit}", min=f"{d['rmin']:g}", max=f"{d['rmax']:g}",
                          unit=d.get("unit") or "").strip())
        if d["cls"] in ("Vfd", "PropValve"):
            if d.get("setpoint") is not None:
                opts.append(_("žádaná {v}", v=f"{d['setpoint']:g} {d.get('unit') or ''}".strip()))
            opts.append(_("rampa {t} s", t=f"{d['rampS']:g}") if (d.get("rampS") or 0) > 0 else _("bez rampy v PLC"))
        if d["cls"] == "PropValve" and (d.get("opt") or {}).get("fbk") is not False and d.get("tol") is not None:
            opts.append(_("tolerance ± {v}", v=f"{d['tol']:g}"))
        if d["cls"] == "PosDrive":
            recs = "; ".join(f"{r['no']} = {r.get('name') or '?'}" + (f" @ {r['pos']:g}" if r.get("pos") is not None else "")
                             for r in d.get("records") or [])
            opts.append(_("záznamy: {list}", list=recs or "—"))
        if d["cls"] == "Axis":                 # servoosa: konfigurační list (výchozí hodnoty z jádra)
            cfg = app.core("axisCfgOf", d)
            u = d.get("unit") or ""
            opts.append(_("max. {v} {unit}/s, zrychlení {a} {unit}/s²", v=f"{cfg['vMax']:g}", a=f"{cfg['aMax']:g}", unit=u))
            if cfg.get("limNeg") is not None and cfg.get("limPos") is not None:
                opts.append(_("SW limity {lo} až {hi} {unit}", lo=f"{cfg['limNeg']:g}", hi=f"{cfg['limPos']:g}", unit=u))
            opts.append(_("polohy: {list}", list="; ".join(f"{x['name']} @ {x['pos']:g}" for x in cfg["positions"]) or "—"))
            opts.append(_("po síti (bez I/O) — osa a pohon se nastavují v IDE podle README"))
        if opts:
            self._wrap(", ".join(opts), "Dim.TLabel", pady=(2, 0))
        if self.on_change is not None:
            self._device_editor(d)

        row = ttk.Frame(self.body)
        row.pack(anchor="w", pady=(6, 0))
        targets = [("zarizeni", _("Zařízení") + " ↗", lambda: app.open_device(d["id"])),
                   ("blok", _("Blokové schéma") + " ↗", lambda: app.open_block(d["id"])),
                   ("live", _("Živá simulace") + " ↗", lambda: app.open_live(d["id"]))]
        for i, (where, text, cmd) in enumerate(t for t in targets if t[0] != self.here):
            link(row, text, cmd).pack(side="left", padx=(12 if i else 0, 0))

        # --- vstupy a výstupy ---
        self._section(_("Vstupy a výstupy"))
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
            if self.on_change is not None and not hot:
                link(line, "✎", lambda k=e["key"]: self.show(d["id"], io_key=k), bg=bg
                     ).pack(side="right", padx=(0, 8))
            note = e["cmt"] + (" · " + _("NC (rozpínací)") if e.get("nc") else "")
            tk.Label(box, text=note, bg=bg, fg=theme.DIM, font=theme.FONT_DIM, anchor="w",
                     justify="left", wraplength=self._inner_w - 40
                     ).pack(fill="x", padx=(28, 0))
            if hot and self.on_change is not None:
                self._signal_editor(box, e, bg)
        if not ios:
            self._wrap(_("Zařízení nemá žádné signály."), "Dim.TLabel")
        else:
            self._wrap(_("tag → krok I/O · svorka → list zapojení"), "Dim.TLabel", pady=(4, 0))
            if self.on_change is not None:
                self._wrap(_("✎ = upravit tag, adresu a komentář signálu přímo tady"), "Dim.TLabel")

        # --- v programu ---
        self._section(_("V programu"))
        used = False
        if app.prj["program"]["estop"] == d["id"]:
            used = True
            link(self.body, _("Centrální uvolnění (E-stop) → enable všech bloků") + " ↗",
                 lambda: app.open_program(None)).pack(anchor="w")
        for i, s in enumerate(seq):
            if s["act"] != "wait" and s["dev"] == d["id"]:
                used = True
                row = tk.Frame(self.body, bg=theme.TREE_SEL if i == step else theme.BG)
                row.pack(fill="x", pady=1)
                link(row, _("Krok {n}: {text}", n=i + 1, text=step_text(app, s)),
                     lambda i=i: app.open_flow(i), bg=row.cget("bg")).pack(side="left")
        if not used:
            self._wrap(_("Není v automatické sekvenci — volný signál pro vlastní logiku.")
                       if d["cls"] in ("DI", "DO") else
                       _("Není v automatické sekvenci — blok čeká na ruční povel "
                         "(TODO v generovaném kódu)."), "Dim.TLabel")
        elif self.here != "flow":
            self._wrap(_("krok → funkční diagram cyklu"), "Dim.TLabel", pady=(4, 0))

    # --- úpravy přímo v panelu (schéma) ----------------------------------------------

    def _saved(self, text: str) -> None:
        """Po uložení: stav, schéma se překreslí (výkresy z jádra)."""
        self.app.set_status(text)
        self.on_change()

    def _device_editor(self, d: dict) -> None:
        """Popis a parametry zařízení (meze, žádaná, rampa…) — Entry + Uložit."""
        from .steps.zarizeni import PARAM_LABEL, apply_params, read_params   # líně: kroky importují panel
        app, dev_id = self.app, d["id"]
        box = ttk.Frame(self.body)
        box.pack(fill="x", pady=(8, 0))
        box.columnconfigure(1, weight=1)
        var_desc = tk.StringVar(value=d["desc"])
        self._vars.append(var_desc)
        ttk.Label(box, text=_("Popis")).grid(row=0, column=0, sticky="w")
        ttk.Entry(box, textvariable=var_desc).grid(row=0, column=1, sticky="we", padx=(6, 0))
        keys = {"AnalogIn": ("limLo", "limHi"), "AnalogOut": ("setpoint",), "Vfd": ("setpoint", "rampS"),
                "PropValve": ("setpoint", "rampS", "tol", "tolTimeS"), "PosDrive": ("selBits", "travelS")
                }.get(d["cls"], ())
        vars_: dict = {}
        for r, key in enumerate(keys, start=1):
            var = tk.StringVar(value="" if d.get(key) is None else f"{d[key]:g}")
            self._vars.append(var)
            vars_[key] = var
            ttk.Label(box, text=_(PARAM_LABEL[key])).grid(row=r, column=0, sticky="w", pady=(2, 0))
            ttk.Entry(box, textvariable=var, width=10).grid(row=r, column=1, sticky="w", padx=(6, 0), pady=(2, 0))
        if d["cls"] == "DO":
            role_keys = ["", *app.DO_ROLES]
            names = [_("— bez vazby —"), *app.DO_ROLES.values()]
            cb = ttk.Combobox(box, values=names, state="readonly", width=max(len(n) for n in names) + 1)
            cb.current(role_keys.index(d.get("role") or "") if (d.get("role") or "") in role_keys else 0)
            ttk.Label(box, text=_("vazba na stav stroje")).grid(row=1, column=0, sticky="w", pady=(2, 0))
            cb.grid(row=1, column=1, sticky="w", padx=(6, 0), pady=(2, 0))
            vars_["role"] = (cb, role_keys)

        def save() -> None:
            try:
                params = read_params(vars_)
            except ValueError as exc:
                app.set_status(str(exc))
                return
            cur = app.dev_by_id(dev_id)
            if cur is None:
                return
            bits = cur.get("selBits")
            apply_params(cur, params)
            if cur.get("selBits") != bits:          # jiný počet bitů výběru záznamu = jiné signály
                app.sync()
            if var_desc.get().strip() != cur["desc"]:
                app.edit("setDeviceDesc", dev_id, var_desc.get())   # výchozí komentáře signálů s popisem
            app.save()
            self._saved(_("Zařízení {dev} uloženo.", dev=cur["name"]))

        ttk.Button(box, text=_("Uložit"), command=save).grid(row=len(keys) + 2, column=0, columnspan=2,
                                                              sticky="w", pady=(4, 0))

    def _signal_editor(self, parent, e: dict, bg: str) -> None:
        """Tag, adresa a komentář vybraného signálu — Entry + Uložit (jádro edit.ts)."""
        app, key = self.app, e["key"]
        box = tk.Frame(parent, bg=bg)
        box.pack(fill="x", padx=(28, 0), pady=(2, 4))
        box.columnconfigure(1, weight=1)
        fields = (("tag", _("Tag"), "setIoTag"), ("addr", _("Adresa"), "setIoAddr"),
                  ("cmt", _("Komentář"), "setIoCmt"))
        vars_ = {}
        for r, (f, label, _fn) in enumerate(fields):
            var = tk.StringVar(value=e.get(f) or "")
            self._vars.append(var)
            vars_[f] = var
            tk.Label(box, text=label, bg=bg, fg=theme.FG, font=theme.FONT_DIM).grid(row=r, column=0, sticky="w")
            ttk.Entry(box, textvariable=var).grid(row=r, column=1, sticky="we", padx=(6, 0), pady=1)

        def save() -> None:
            cur = next((x for x in app.prj["io"] if x["key"] == key), None)
            if cur is None:
                return
            for f, _label, fn in fields:
                if vars_[f].get().strip() == (cur.get(f) or ""):
                    continue
                res = app.edit(fn, key, vars_[f].get())
                if not res.get("ok"):
                    app.set_status("⚠ " + (res.get("error") or ""), keep=True)
                    return
                cur = next(x for x in app.prj["io"] if x["key"] == key)
            self._saved(_("Signál {tag} uložen.", tag=cur["tag"]))

        ttk.Button(box, text=_("Uložit"), command=save).grid(row=len(fields), column=0, columnspan=2,
                                                              sticky="w", pady=(2, 0))
