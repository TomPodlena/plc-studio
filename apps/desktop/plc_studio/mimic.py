"""Grafické schéma systému pro živou simulaci.

Vlevo snímače a měření, uprostřed PLC s moduly a kanály, vpravo akční členy.
Každý signál je vodič mezi zařízením a kanálem modulu; při TRUE se rozsvítí
a čárkování po něm „teče" směrem signálu (vstupy do PLC, výstupy z PLC).
Symboly zařízení ukazují funkci: rotor motoru se točí, píst válce se vysouvá
podle polohy z modelu stroje, kontakt spínače se zavírá, kontrolka svítí,
sloupec analogového výstupu ukazuje hodnotu.

Vstupy se ovládají přímo ve schématu (když je zadané ``on_force`` / ``on_analog``):

* každý digitální vstup zařízení (port „běh", „porucha", „otevřeno", „vstup"…) je
  tlačítko — klik hodnotu přepne a vnutí (``on_force(key, value)``), „↺" vedle
  vnuceného vstupu ho vrátí simulovanému stroji (``on_force(key, None)``);
* analogový snímač má otočný potenciometr přes rozsah snímače — táhnutí myší
  nahoru / dolů, kolečko, dvojklik = polovina rozsahu (``on_analog(key, raw)``).

Statická kresba se staví jednou (a znovu při změně měřítka); ``update()``
pak jen přebarvuje a posouvá prvky podle snímku simulace.
"""

from __future__ import annotations

import math

import tkinter as tk
from tkinter import ttk

from . import theme
from .i18n import N_, _

# --- rozvržení (logické jednotky; násobí se měřítkem) -------------------------
W = 900
X_LEFT, W_DEV = 16, 196            # levý sloupec zařízení (snímače, měření)
X_PLC, W_PLC = 330, 230            # PLC uprostřed
X_RIGHT = 688                      # pravý sloupec (akční členy)
LANES_L = (X_LEFT + W_DEV + 10, X_PLC - 10)
LANES_R = (X_PLC + W_PLC + 10, X_RIGHT - 10)
Y_TOP = 46
ROW = 15                           # rozteč portů zařízení
CH = 14                            # rozteč kanálů modulu
GAP = 12

SIG = {"fbkRunning": N_("běh"), "fault": N_("porucha"), "outRun": N_("chod"),
       "fbkOpen": N_("otevřeno"), "fbkClosed": N_("zavřeno"), "outOpen": N_("otevřít"),
       "raw": N_("hodnota"), "in": N_("vstup"), "out": N_("výstup")}
LEFT_CLS = ("DI", "AnalogIn")
# Barvy stavu jsou sémantické (theme.SIG_* / STATE_*), ne značkový akcent: DI modrá,
# DO zelená, analog fialová, aktivní žlutá/oranžová, porucha červená.
WIRE_OFF = "#C3CAD6"
WIRE_DIM = "#E6E9EF"               # vodič mimo vybrané zařízení / modul
WIRE_FOCUS = "#3A4660"             # vybraný vodič v klidu (FALSE)
WIRE_IN, WIRE_OUT, WIRE_AN = theme.SIG_IN, theme.SIG_OUT, theme.SIG_AN
FILL = {"on": theme.STATE_ON_BG, "active": theme.STATE_ACTIVE_BG, "err": theme.DANGER_BG,
        "off": theme.STATE_OFF_BG, None: "#FFFFFF"}
EDGE = {"on": theme.STATE_ON, "active": theme.WARN, "err": theme.ERR, "off": theme.NEUTRAL,
        None: theme.NEUTRAL}
LAMP = "#F5C518"
BTN_BG, BTN_EDGE = theme.FIELD, theme.NEUTRAL     # tlačítko vstupu v klidu
KNOB_BG, KNOB_TRACK = theme.FIELD, "#E3E7EE"
SWEEP, START = 270, 225                       # potenciometr: úhel otáčení, začátek vlevo dole
RAW_MAX = 27648


def _clip(text: str, n: int) -> str:
    """Zkrácení textu pro pevné pole schématu — se třemi tečkami, ať je vidět, že pokračuje."""
    return text if len(text) <= n else text[:n - 1].rstrip() + "…"


def dev_mark(d: dict, frame: dict, ios: list[dict]) -> str | None:
    """Stav bloku zařízení pro obarvení (stejná pravidla jako blokové schéma stroje)."""
    state = frame["dev"].get(str(d["id"]))
    if state is not None:
        if state["error"]:
            return "err"
        if state["step"] < 0:
            return "off"
        if state["busy"]:
            return "active"
        return "on" if state["step"] == 20 else None
    if d["cls"] in ("DI", "DO"):
        return "on" if any(frame["io"].get(e["key"]) is True for e in ios) else None
    return None


class Mimic(ttk.Frame):
    """``on_select(dev_id)`` — klik na symbol zařízení; ``on_force(key, value)`` — tlačítko
    digitálního vstupu (``value`` None = zpět stroji, ``key`` None = uvolnit vše);
    ``on_analog(key, raw)`` — potenciometr analogového vstupu."""

    def __init__(self, parent, app, mods: list[dict], *, on_select=None, on_force=None,
                 on_analog=None):
        super().__init__(parent)
        self.app, self.mods, self.on_select = app, mods, on_select
        self.on_force, self.on_analog = on_force, on_analog
        self._grab = None                 # stisknuté tlačítko vstupu / tažený potenciometr
        self.prj = app.prj
        self._scale = 1.0
        self._fit = True
        self._res: dict | None = None
        self._sel: int | None = None
        self._mod: int | None = None      # vybraný modul PLC (index v ``mods``) — zvýrazní jeho vodiče
        self._phase = 0.0                 # posun čárkování aktivních vodičů
        self._angle: dict[int, float] = {}
        self._press = None
        self._dragging = False
        self._cache: dict = {}            # poslední nastavené hodnoty prvků (méně volání Tk)

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 4))
        ttk.Button(bar, text="−", width=3, command=lambda: self.zoom(1 / 1.2)).pack(side="left")
        ttk.Button(bar, text="+", width=3, command=lambda: self.zoom(1.2)).pack(side="left", padx=(4, 0))
        ttk.Button(bar, text=_("Na šířku"), command=self.fit_width).pack(side="left", padx=(4, 0))
        self._zoom_lbl = ttk.Label(bar, text="", style="Dim.TLabel")
        self._zoom_lbl.pack(side="left", padx=10)
        self._release = None
        if on_force is not None:
            self._release = ttk.Button(bar, text=_("Uvolnit vše"),
                                       command=lambda: on_force(None, None))
            self._release.pack(side="left")
            self._release.state(["disabled"])
            hint = _("klik na vstup = přepnout a vnutit, ↺ = zpět stroji · potenciometr: "
                     "táhni nebo kolečko · klik na blok nebo modul = výběr a zvýraznění vodičů, "
                     "klik do prázdna = zrušit")
        else:
            hint = _("svítí při TRUE: vstupy modře, výstupy zeleně · klik na zařízení nebo modul "
                     "= zvýraznění vodičů")
        tip = ttk.Label(self, style="Dim.TLabel", text=hint, justify="left")   # vlastní řádek,
        tip.pack(fill="x", pady=(0, 4))                                        # ať se vejde
        tip.bind("<Configure>", lambda e: tip.configure(wraplength=max(200, e.width - 4)))

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True)
        body.rowconfigure(0, weight=1)
        body.columnconfigure(0, weight=1)
        c = self.canvas = tk.Canvas(body, bg="#FFFFFF", height=320, highlightthickness=1,
                                    highlightbackground=theme.BORDER)
        ys = ttk.Scrollbar(body, orient="vertical", command=c.yview)
        xs = ttk.Scrollbar(body, orient="horizontal", command=c.xview)
        c.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        c.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        xs.grid(row=1, column=0, sticky="ew")
        c.bind("<Configure>", self._on_resize)
        c.bind("<MouseWheel>", self._on_wheel)
        c.bind("<Double-Button-1>", self._on_double)
        c.bind("<Shift-MouseWheel>", lambda e: c.xview_scroll(-1 if e.delta > 0 else 1, "units"))
        c.bind("<Control-MouseWheel>", lambda e: self.zoom(1.2 if e.delta > 0 else 1 / 1.2))
        c.bind("<ButtonPress-1>", self._on_press)
        c.bind("<B1-Motion>", self._on_drag)
        c.bind("<ButtonRelease-1>", self._on_release)

        self._layout()
        self._build()

    # --- rozvržení -------------------------------------------------------------------

    def _layout(self) -> None:
        """Polohy zařízení, kanálů a vodičů v logických jednotkách."""
        prj = self.prj
        self.io_of = {d["id"]: [e for e in prj["io"] if e["devId"] == d["id"]] for d in prj["devices"]}
        es = prj["program"]["estop"]
        self.estop_key = self.io_of[es][0]["key"] if es in self.io_of and self.io_of[es] else None
        self.locks = {i for i in prj["program"].get("interlocks") or [] if i != es}
        self.dev_box: dict[int, tuple] = {}       # id → (x, y, w, h, strana)
        self.port: dict[str, tuple] = {}          # klíč I/O → (x, y) portu na zařízení
        y = {"L": Y_TOP, "R": Y_TOP}
        for d in prj["devices"]:
            side = "L" if d["cls"] in LEFT_CLS else "R"
            n = max(1, len(self.io_of[d["id"]]))
            h = max(36 + n * ROW + 6, 74 if d["cls"] in ("Motor", "Ventil", "AnalogIn") else 54)
            x = X_LEFT if side == "L" else X_RIGHT
            self.dev_box[d["id"]] = (x, y[side], W_DEV, h, side)
            for j, e in enumerate(self.io_of[d["id"]]):
                self.port[e["key"]] = (x + W_DEV if side == "L" else x, y[side] + 40 + j * ROW)
            y[side] += h + GAP

        # PLC: hlavička + moduly s kanály
        self.plc_head = (X_PLC, Y_TOP, W_PLC, 84)
        self.mod_box: list[tuple] = []            # (x, y, w, h, modul)
        self.chan: dict[str, float] = {}          # klíč I/O → y kanálu
        my = Y_TOP + 84 + 8
        for m in self.mods:
            h = 20 + len(m["ch"]) * CH + 6
            self.mod_box.append((X_PLC, my, W_PLC, h, m))
            for i, key in enumerate(m["ch"]):
                self.chan[key] = my + 20 + i * CH + CH / 2
            my += h + 8
        self.height = max(y["L"], y["R"], my) + 10

        # vodiče: každý má svůj svislý „pruh", ať se nepřekrývají
        self.wires: dict[str, dict] = {}
        side_of = {e["key"]: self.dev_box[e["devId"]][4] for e in prj["io"] if e["devId"] in self.dev_box}
        for side, (a, b) in (("L", LANES_L), ("R", LANES_R)):
            keys = sorted((k for k in self.chan if side_of.get(k) == side and k in self.port),
                          key=lambda k: (self.chan[k], self.port[k][1]))
            for i, key in enumerate(keys):
                lane = a + (b - a) * (i + 0.5) / max(len(keys), 1)
                px, py = self.port[key]
                cx = X_PLC if side == "L" else X_PLC + W_PLC
                e = next(x for x in prj["io"] if x["key"] == key)
                pts = [(px, py), (lane, py), (lane, self.chan[key]), (cx, self.chan[key])]
                if e["dir"] in ("DO", "AO"):
                    pts.reverse()                 # body ve směru signálu: z PLC k zařízení
                self.wires[key] = {"pts": pts, "dir": e["dir"], "cx": cx}

    # --- kresba ----------------------------------------------------------------------

    def _font(self, size: float, bold: bool = False, mono: bool = False):
        px = max(6, round(size * self._scale))
        fam = "Consolas" if mono else "Segoe UI"
        return (fam, -px, "bold") if bold else (fam, -px)

    def _build(self) -> None:
        c, s = self.canvas, self._scale
        c.delete("all")
        self._cache.clear()
        self.items: dict = {"wire": {}, "led": {}, "dev": {}, "plc": {}, "btn": {}}
        self._zoom_lbl.configure(text=f"{round(s * 100)} %")
        P = lambda v: v * s  # noqa: E731

        c.create_text(P(X_LEFT), P(14), text=_("Snímače a měření"), anchor="w", fill=theme.DIM,
                      font=self._font(10, bold=True))
        c.create_text(P(X_RIGHT), P(14), text=_("Akční členy a signalizace"), anchor="w",
                      fill=theme.DIM, font=self._font(10, bold=True))
        c.create_text(P(X_PLC), P(14), text="PLC", anchor="w", fill=theme.PRIMARY,
                      font=self._font(11, bold=True))
        c.create_text(P(X_PLC + W_PLC), P(14), text=_clip(self.prj["meta"]["name"] or "", 34),
                      anchor="e", fill=theme.DIM, font=self._font(9.5))

        # vodiče (pod bloky)
        for key, w in self.wires.items():
            flat = [P(v) for pt in w["pts"] for v in pt]
            self.items["wire"][key] = c.create_line(*flat, fill=WIRE_OFF, width=1,
                                                    joinstyle="round", tags=("wire",))

        # PLC: hlavička
        x, y, w, h = self.plc_head
        c.create_rectangle(P(x), P(y), P(x + w), P(y + h), outline=theme.ACCENT, width=2,
                           fill=theme.FIELD)
        c.create_text(P(x + 10), P(y + 14), text="CPU", anchor="w", fill=theme.PRIMARY,
                      font=self._font(11, bold=True))
        self.items["plc"]["enable"] = c.create_oval(P(x + w - 22), P(y + 8), P(x + w - 10),
                                                    P(y + 20), outline=theme.FG, fill="")
        c.create_text(P(x + w - 28), P(y + 14), text="enable", anchor="e", fill=theme.DIM,
                      font=self._font(9.5))
        for name, yy, size, bold in (("mode", 34, 10, False), ("seq", 50, 10, True),
                                     ("fault", 68, 10, True)):
            self.items["plc"][name] = c.create_text(
                P(x + 10), P(y + yy), text="", anchor="w", fill=theme.FG,
                font=self._font(size, bold=bold), width=P(w - 20))

        # PLC: moduly a kanály
        tag_of = {e["key"]: e["tag"] for e in self.prj["io"]}
        self.items["mod"], self.items["chtext"] = {}, {}
        for idx, (x, y, w, h, m) in enumerate(self.mod_box):
            mt = (f"mod:{idx}",)                    # klik na modul = zvýraznit jeho vodiče
            self.items["mod"][idx] = c.create_rectangle(P(x), P(y), P(x + w), P(y + h),
                                                        outline=theme.NEUTRAL, fill="#FFFFFF", tags=mt)
            c.create_rectangle(P(x), P(y), P(x + w), P(y + 18), outline=theme.NEUTRAL, fill=theme.FIELD,
                               tags=mt)
            c.create_text(P(x + 8), P(y + 9),
                          text=m["name"] + "  ·  " + _("{n} kanálů", n=len(m["ch"])),
                          anchor="w", fill=theme.PRIMARY, font=self._font(10, bold=True), tags=mt)
            c.tag_bind(mt[0], "<Enter>", lambda _e: c.configure(cursor="hand2"))
            c.tag_bind(mt[0], "<Leave>", lambda _e: c.configure(cursor=""))
            for i, key in enumerate(m["ch"]):
                cy = self.chan[key]
                left = self.wires.get(key, {}).get("cx", x) == x
                lx = x + 8 if left else x + w - 8
                self.items["led"].setdefault(key, []).append(
                    c.create_oval(P(lx - 3.5), P(cy - 3.5), P(lx + 3.5), P(cy + 3.5),
                                  outline=theme.FG, fill=""))
                self.items["chtext"][key] = c.create_text(
                    P(x + 18) if left else P(x + w - 18), P(cy),
                    text=f"{i:>2} {_clip(tag_of.get(key, ''), 24)}",
                    anchor="w" if left else "e", fill=theme.FG,
                    font=self._font(9.5, mono=True), tags=mt)

        for d in self.prj["devices"]:
            self._build_device(d)
        self.items["sel"] = c.create_rectangle(0, 0, 0, 0, outline=theme.PRIMARY, width=2,
                                               dash=(5, 3), state="hidden")
        self.items["focus"] = []                    # rámečky protějšků vybraného zařízení / modulu
        c.configure(scrollregion=(0, 0, P(W), P(self.height)))
        if self._res is not None:
            self.update(self._res, 0.0)
        self._place_selection()

    def _build_device(self, d: dict) -> None:
        c, s = self.canvas, self._scale
        P = lambda v: v * s  # noqa: E731
        x, y, w, h, side = self.dev_box[d["id"]]
        tag = f"dev:{d['id']}"
        it: dict = {"cls": d["cls"]}
        it["rect"] = c.create_rectangle(P(x), P(y), P(x + w), P(y + h), outline=theme.NEUTRAL,
                                        fill="#FFFFFF", tags=(tag,))
        estop = self.prj["program"]["estop"] == d["id"]
        lock = d["id"] in self.locks
        c.create_text(P(x + 8), P(y + 11), text=d["name"] + ("  E-STOP" if estop else ""),
                      anchor="w", fill=theme.ERR if estop else theme.PRIMARY,
                      font=self._font(12, bold=True), tags=(tag,))
        if lock:                                       # blokovací vstup: jeho FALSE zastaví stroj
            c.create_text(P(x + 34), P(y + 11), text=_("blokování"), anchor="w", fill=theme.WARN,
                          font=self._font(9.5, bold=True), tags=(tag,))
        c.create_text(P(x + 8), P(y + 25), text=_clip(d["desc"] or self.app.CLS[d["cls"]]["label"], 30),
                      anchor="w", fill=theme.DIM, font=self._font(9.5), tags=(tag,))
        it["state"] = c.create_text(P(x + w - 8), P(y + 11), text="", anchor="e", fill=theme.DIM,
                                    font=self._font(9.5), tags=(tag,))
        # porty na straně k PLC
        for e in self.io_of[d["id"]]:
            px, py = self.port[e["key"]]
            self.items["led"].setdefault(e["key"], []).append(
                c.create_oval(P(px - 4), P(py - 4), P(px + 4), P(py + 4), outline=theme.FG,
                              fill="#FFFFFF", tags=(tag,)))
            label = _(SIG[e["sig"]]) if e["sig"] in SIG else e["sig"]
            if side == "L":
                t = c.create_text(P(px - 11), P(py), text=label, anchor="e", fill=theme.FG,
                                  font=self._font(9.5), tags=(tag,))
            else:
                t = c.create_text(P(px + 11), P(py), text=label, anchor="w", fill=theme.FG,
                                  font=self._font(9.5), tags=(tag,))
            if e["dir"] == "DI" and self.on_force is not None:
                self._make_button(e["key"], t, side)

        # symbol funkce na straně od PLC
        gx = x + 14 if side == "L" else x + 104        # levý okraj plochy symbolu (šířka ~80)
        cy = y + 36 + (h - 36) / 2
        if d["cls"] == "Motor":
            mx, r = gx + 52, 17
            it["body"] = c.create_oval(P(mx - r), P(cy - r), P(mx + r), P(cy + r),
                                       outline=theme.FG, width=max(1, round(1.5 * s)),
                                       fill="#FFFFFF", tags=(tag,))
            it["rotor"] = c.create_line(P(mx), P(cy), P(mx + r - 3), P(cy), fill=theme.FG,
                                        width=max(1, round(2 * s)), tags=(tag,))
            c.create_text(P(mx - r - 12), P(cy), text="M", fill=theme.FG,
                          font=self._font(11, bold=True), tags=(tag,))
            it["geo"] = (mx, cy, r - 3)
        elif d["cls"] == "Ventil":
            bx0, bx1 = gx + 6, gx + 52                 # tělo válce
            c.create_rectangle(P(bx0), P(cy - 9), P(bx1), P(cy + 9), outline=theme.FG,
                               fill="#FFFFFF", width=max(1, round(1.5 * s)), tags=(tag,))
            it["piston"] = c.create_rectangle(0, 0, 0, 0, outline=theme.FG, fill=theme.DIM,
                                              tags=(tag,))
            it["rod"] = c.create_line(0, 0, 0, 0, fill=theme.FG, width=max(2, round(3 * s)),
                                      tags=(tag,))
            it["head"] = c.create_rectangle(0, 0, 0, 0, outline=theme.FG, fill=theme.FG,
                                            tags=(tag,))
            sig = {e["sig"]: e["key"] for e in self.io_of[d["id"]]}
            for name, sx in (("fbkClosed", bx0 + 4), ("fbkOpen", bx1 - 4)):
                if name in sig:                        # koncové snímače nad válcem
                    it[name] = c.create_rectangle(P(sx - 4), P(cy - 19), P(sx + 4), P(cy - 12),
                                                  outline=theme.FG, fill="#FFFFFF", tags=(tag,))
            it["geo"] = (bx0, bx1, cy)
        elif d["cls"] == "DO":
            lx, r = gx + 52, 12
            it["body"] = c.create_oval(P(lx - r), P(cy - r), P(lx + r), P(cy + r),
                                       outline=theme.FG, fill="#FFFFFF",
                                       width=max(1, round(1.5 * s)), tags=(tag,))
            k = r * 0.7
            c.create_line(P(lx - k), P(cy - k), P(lx + k), P(cy + k), fill=theme.FG, tags=(tag,))
            c.create_line(P(lx - k), P(cy + k), P(lx + k), P(cy - k), fill=theme.FG, tags=(tag,))
        elif d["cls"] == "DI":
            x0, x1 = gx + 6, gx + 62                   # kontakt: dvě svorky a páka
            c.create_line(P(x0), P(cy), P(x0 + 16), P(cy), fill=theme.FG,
                          width=max(1, round(1.5 * s)), tags=(tag,))
            c.create_line(P(x1 - 16), P(cy), P(x1), P(cy), fill=theme.FG,
                          width=max(1, round(1.5 * s)), tags=(tag,))
            it["lever"] = c.create_line(0, 0, 0, 0, fill=theme.FG, width=max(1, round(2 * s)),
                                        tags=(tag,))
            it["geo"] = (x0 + 16, x1 - 16, cy)
        elif d["cls"] == "AnalogIn":                   # analogový snímač: potenciometr + hodnota
            key = next((e["key"] for e in self.io_of[d["id"]] if e["dir"] == "AI"), None)
            kx, r = gx + 18, 13
            kt = (f"knob:{key}",) if key is not None and self.on_analog is not None else (tag,)
            c.create_arc(P(kx - r - 4), P(cy - r - 4), P(kx + r + 4), P(cy + r + 4), start=-45,
                         extent=SWEEP, style="arc", outline=KNOB_TRACK,
                         width=max(2, round(3 * s)), tags=kt)
            it["arc"] = c.create_arc(P(kx - r - 4), P(cy - r - 4), P(kx + r + 4), P(cy + r + 4),
                                     start=START, extent=0, style="arc", outline=WIRE_AN,
                                     width=max(2, round(3 * s)), tags=kt)
            it["knob"] = c.create_oval(P(kx - r), P(cy - r), P(kx + r), P(cy + r), outline=BTN_EDGE,
                                       fill=KNOB_BG, width=max(1, round(1.2 * s)), tags=kt)
            it["ptr"] = c.create_line(0, 0, 0, 0, fill=theme.FG, width=max(2, round(2.5 * s)),
                                      capstyle="round", tags=kt)
            it["value"] = c.create_text(P(kx + r + 10), P(cy), text="", anchor="w", fill=theme.FG,
                                        font=self._font(10, bold=True, mono=True), tags=(tag,))
            it["geo"] = (kx, cy, r)
            if kt[0].startswith("knob:"):
                c.tag_bind(kt[0], "<Enter>", lambda _e: c.configure(cursor="sb_v_double_arrow"))
                c.tag_bind(kt[0], "<Leave>", lambda _e: c.configure(cursor=""))
        else:                                          # analogový výstup: sloupcový ukazatel
            x0, x1 = gx, gx + 70
            c.create_rectangle(P(x0), P(cy - 2), P(x1), P(cy + 8), outline=theme.FG,
                               fill="#FFFFFF", tags=(tag,))
            it["bar"] = c.create_rectangle(P(x0), P(cy - 2), P(x0), P(cy + 8), outline="",
                                           fill=WIRE_AN, tags=(tag,))
            it["value"] = c.create_text(P(x0), P(cy - 10), text="", anchor="w", fill=theme.FG,
                                        font=self._font(9.5, mono=True), tags=(tag,))
            it["geo"] = (x0, x1, cy)
        self.items["dev"][d["id"]] = it

    def _make_button(self, key: str, text_item, side: str) -> None:
        """Popisek portu digitálního vstupu jako tlačítko (+ „↺" pro návrat stroji)."""
        c, s = self.canvas, self._scale
        x0, y0, x1, y1 = c.bbox(text_item)
        bt, pad = f"btn:{key}", 3 * s
        rect = c.create_rectangle(x0 - pad, y0, x1 + pad, y1, outline=BTN_EDGE, fill=BTN_BG,
                                  tags=(bt,))
        c.tag_raise(text_item)
        c.addtag_withtag(bt, text_item)
        rx = x0 - pad - 8 * s if side == "L" else x1 + pad + 8 * s
        rel = c.create_text(rx, (y0 + y1) / 2, text="↺", fill=theme.WARN, state="hidden",
                            font=self._font(11, bold=True), tags=(f"rel:{key}",))
        for t in (bt, f"rel:{key}"):
            c.tag_bind(t, "<Enter>", lambda _e: c.configure(cursor="hand2"))
            c.tag_bind(t, "<Leave>", lambda _e: c.configure(cursor=""))
        self.items["btn"][key] = {"rect": rect, "text": text_item, "rel": rel}

    # --- stav ------------------------------------------------------------------------

    def _set(self, item, **opts) -> None:
        """``itemconfigure`` jen při změně (plátno se překresluje 20× za sekundu)."""
        key = (item, tuple(sorted(opts.items())))
        if self._cache.get(item) != key:
            self._cache[item] = key
            self.canvas.itemconfigure(item, **opts)

    def update(self, res: dict, dt: float) -> None:
        """Promítne snímek simulace; ``dt`` = uplynulý čas simulace (pro animaci)."""
        self._res = res
        c, s, fr = self.canvas, self._scale, res["frame"]
        P = lambda v: v * s  # noqa: E731
        io = fr["io"]
        force = res.get("force") or {}
        self._phase = (self._phase + dt * 40) % 1000

        focus = self.focus_keys()
        for key, item in self.items["wire"].items():
            w, val = self.wires[key], io.get(key)
            if focus is not None and key not in focus:   # mimo výběr: ztlumit, bez animace
                self._set(item, fill=WIRE_DIM, width=1, dash=())
            elif w["dir"] in ("AI", "AO"):
                k = 2.6 if focus else 1.4
                self._set(item, fill=WIRE_AN, width=max(1, round(k * s)), dash=(2, 3))
            elif val is True:
                k = 3.4 if focus else 2.4
                self._set(item, fill=WIRE_IN if w["dir"] == "DI" else WIRE_OUT,
                          width=max(2, round(k * s)), dash=(7, 4))
                c.itemconfigure(item, dashoffset=-int(self._phase) % 11)
            elif focus is not None:                       # vybraný vodič v klidu: výrazně, plně
                self._set(item, fill=WIRE_FOCUS, width=max(2, round(2 * s)), dash=())
            else:
                self._set(item, fill=WIRE_OFF, width=1, dash=())
        for key, leds in self.items["led"].items():
            val = io.get(key)
            e_dir = self.wires.get(key, {}).get("dir", "DI")
            color = (WIRE_AN if e_dir in ("AI", "AO") else
                     (WIRE_IN if e_dir == "DI" else WIRE_OUT) if val is True else "#FFFFFF")
            forced = key in force                      # vnucený vstup: oranžový kroužek
            for led in leds:
                self._set(led, fill=color, outline=theme.WARN if forced else theme.FG,
                          width=max(2, round(2 * s)) if forced else 1)

        for d in self.prj["devices"]:
            it = self.items["dev"][d["id"]]
            ios = self.io_of[d["id"]]
            mark = dev_mark(d, fr, ios)
            self._set(it["rect"], fill=FILL[mark], outline=EDGE[mark],
                      width=2 if mark in ("on", "active", "err") else 1)
            state = fr["dev"].get(str(d["id"]))
            sig = {e["sig"]: io.get(e["key"]) for e in ios}
            if d["cls"] == "Motor":
                self._set(it["state"], text=state["label"],
                          fill=theme.ERR if state["error"] else theme.DIM)
                mx, cy, r = it["geo"]
                pos = state["pos"]
                self._angle[d["id"]] = a = (self._angle.get(d["id"], 0.0) + dt * 9 * pos) % (2 * math.pi)
                c.coords(it["rotor"], P(mx - r * math.cos(a)), P(cy - r * math.sin(a)),
                         P(mx + r * math.cos(a)), P(cy + r * math.sin(a)))
                self._set(it["body"], fill=theme.DANGER_BG if state["error"] else
                          theme.STATE_ON_FULL if pos >= 1 else theme.STATE_ACTIVE_BG if pos > 0 else "#FFFFFF")
            elif d["cls"] == "Ventil":
                self._set(it["state"], text=state["label"],
                          fill=theme.ERR if state["error"] else theme.DIM)
                bx0, bx1, cy = it["geo"]
                px = bx0 + 3 + state["pos"] * (bx1 - bx0 - 12)      # píst uvnitř těla
                rod = bx1 + 4 + state["pos"] * 24                    # konec pístnice venku
                c.coords(it["piston"], P(px), P(cy - 8), P(px + 6), P(cy + 8))
                c.coords(it["rod"], P(px + 6), P(cy), P(rod), P(cy))
                c.coords(it["head"], P(rod), P(cy - 5), P(rod + 3), P(cy + 5))
                for name in ("fbkClosed", "fbkOpen"):
                    if name in it:
                        self._set(it[name], fill=WIRE_IN if sig.get(name) is True else "#FFFFFF")
            elif d["cls"] == "DO":
                on = sig.get("out") is True
                self._set(it["body"], fill=LAMP if on else "#FFFFFF")
                self._set(it["state"], text=_("svítí") if on else "")
            elif d["cls"] == "DI":
                on = sig.get("in") is True
                x0, x1, cy = it["geo"]
                c.coords(it["lever"], P(x0), P(cy), P(x1 if on else x1 - 3),
                         P(cy if on else cy - 11))
                self._set(it["lever"], fill=WIRE_IN if on else theme.FG)
                self._set(it["state"], text="TRUE" if on else "FALSE",
                          fill=WIRE_IN if on else theme.DIM)
            elif d["cls"] == "AnalogIn":
                frac = min(1.0, max(0.0, float(sig.get("raw") or 0) / RAW_MAX))
                kx, cy, r = it["geo"]
                self._set(it["arc"], extent=-SWEEP * frac)
                a = math.radians(START - SWEEP * frac)
                c.coords(it["ptr"], P(kx + 3 * math.cos(a)), P(cy - 3 * math.sin(a)),
                         P(kx + (r - 3) * math.cos(a)), P(cy - (r - 3) * math.sin(a)))
                value = d["rmin"] + frac * (d["rmax"] - d["rmin"])
                self._set(it["value"], text=f"{value:.4g} {d.get('unit') or ''}".strip())
            else:
                raw = sig.get("raw") or 0
                frac = min(1.0, max(0.0, float(raw) / 27648))
                x0, x1, cy = it["geo"]
                c.coords(it["bar"], P(x0), P(cy - 2), P(x0 + frac * (x1 - x0)), P(cy + 8))
                value = d["rmin"] + frac * (d["rmax"] - d["rmin"])
                self._set(it["value"], text=f"{value:.4g} {d.get('unit') or ''}".strip())

        for key, b in self.items["btn"].items():      # tlačítka digitálních vstupů
            on, forced = io.get(key) is True, key in force
            self._set(b["rect"], fill=WIRE_IN if on else BTN_BG,
                      outline=theme.WARN if forced else BTN_EDGE,
                      width=max(2, round(2 * s)) if forced else 1)
            self._set(b["text"], fill="#FFFFFF" if on else theme.FG)
            self._set(b["rel"], state="normal" if forced else "hidden")
        if self._release is not None:
            self._release.state(["!disabled"] if force else ["disabled"])

        plc = self.items["plc"]
        self._set(plc["enable"], fill=theme.STATE_ON if fr["enable"] else theme.ERR)
        auto = res.get("modeAuto", True)
        self._set(plc["mode"], text=_("režim: AUTO") if auto
                  else _("režim: RUČNĚ (povely z HMI)"))
        if not res["stepCount"]:
            seq = _("bez automatické sekvence")
        elif fr["step"] >= 0:
            seq = _("krok {i}/{n}: {title}", i=fr["step"] + 1, n=res["stepCount"],
                    title=res["stepTitle"])
        else:
            seq = _("sekvence: klid")
        self._set(plc["seq"], text=seq, fill=theme.PRIMARY)
        if fr["fault"]:
            self._set(plc["fault"], fill=theme.ERR,
                      text=_("PORUCHA STROJE (krok {n}) — čeká na kvitaci", n=fr["faultStep"] + 1)
                      if fr["faultStep"] is not None else _("PORUCHA STROJE — čeká na kvitaci"))
        elif not fr["enable"]:
            es_ok = self.estop_key is not None and io.get(self.estop_key) is True
            self._set(plc["fault"], fill=theme.ERR,
                      text=_("BLOKOVÁNÍ rozpojeno — stroj stojí") if es_ok else _("E-STOP — bloky blokovány"))
        else:
            self._set(plc["fault"], text=_("bez poruchy"), fill=theme.DIM)

    # --- výběr, zoom, myš ---------------------------------------------------------------

    def select(self, dev_id: int | None) -> None:
        self._sel, self._mod = dev_id, None
        self._place_selection()

    def select_module(self, idx: int | None) -> None:
        """Výběr modulu PLC: zvýrazní vodiče všech jeho kanálů a zařízení na nich."""
        self._mod = idx if idx is not None and 0 <= idx < len(self.mod_box) else None
        if self._mod is not None:
            self._sel = None
        self._place_selection()

    def focus_keys(self) -> set[str] | None:
        """Klíče I/O, jejichž vodiče se mají zvýraznit (None = nic není vybráno)."""
        if self._mod is not None:
            return set(self.mod_box[self._mod][4]["ch"])
        if self._sel is not None and self._sel in self.io_of:
            return {e["key"] for e in self.io_of[self._sel]}
        return None

    def _place_selection(self) -> None:
        c, s = self.canvas, self._scale
        for item in self.items["focus"]:
            c.delete(item)
        self.items["focus"] = []
        box = self.dev_box.get(self._sel) if self._sel is not None else None
        if box is None and self._mod is not None:
            box = self.mod_box[self._mod][:4] + (None,)
        if box is None:
            c.itemconfigure(self.items["sel"], state="hidden")
        else:
            x, y, w, h, _side = box
            c.coords(self.items["sel"], (x - 4) * s, (y - 4) * s, (x + w + 4) * s, (y + h + 4) * s)
            c.itemconfigure(self.items["sel"], state="normal")
            c.tag_raise(self.items["sel"])
        self._apply_focus()

    def _apply_focus(self) -> None:
        """Zvýrazní protějšky výběru: vodiče nahoru, kanály v modulech a bloky zařízení."""
        c, s = self.canvas, self._scale
        focus = self.focus_keys()
        for key, item in self.items["chtext"].items():
            on = focus is not None and key in focus
            c.itemconfigure(item, fill=theme.PRIMARY if on else (theme.DIM if focus else theme.FG),
                            font=self._font(9.5, bold=on, mono=True))
        for key in focus or ():                    # nad ostatní vodiče, ale pod bloky
            item = self.items["wire"].get(key)
            if item is not None:
                c.tag_raise(item, "wire")
        if focus is None:
            pass
        elif self._mod is not None:                # rámečky zařízení zapojených do modulu
            devs = {e["devId"] for e in self.prj["io"] if e["key"] in focus}
            for dev_id in devs:
                b = self.dev_box.get(dev_id)
                if b:
                    x, y, w, h, _side = b
                    self.items["focus"].append(c.create_rectangle(
                        (x - 3) * s, (y - 3) * s, (x + w + 3) * s, (y + h + 3) * s,
                        outline=theme.ACCENT, width=2, dash=(3, 2)))
        else:                                      # vybrané zařízení: rámečky jeho modulů
            for x, y, w, h, m in self.mod_box:
                if focus & set(m["ch"]):
                    self.items["focus"].append(c.create_rectangle(
                        (x - 3) * s, (y - 3) * s, (x + w + 3) * s, (y + h + 3) * s,
                        outline=theme.ACCENT, width=2, dash=(3, 2)))
        if self._res is not None:
            self.update(self._res, 0.0)

    def see(self, dev_id: int) -> None:
        box = self.dev_box.get(dev_id)
        if box is None:
            return
        s, c = self._scale, self.canvas
        top, view_h = c.canvasy(0), c.winfo_height()
        if box[1] * s < top + 10 or (box[1] + box[3]) * s > top + view_h - 10:
            c.yview_moveto(max(0.0, (box[1] * s - view_h / 3) / max(self.height * s, 1)))

    def see_item(self, item) -> None:
        """Posune pohled tak, aby byl prvek plátna vidět (svisle i vodorovně)."""
        c = self.canvas
        box = c.bbox(item)
        if not box:
            return
        sr = [float(v) for v in str(c.cget("scrollregion")).split()] or [0, 0, 1, 1]
        w, h = max(sr[2], 1), max(sr[3], 1)
        left, top = c.canvasx(0), c.canvasy(0)
        if not (left <= box[0] and box[2] <= left + c.winfo_width()):
            c.xview_moveto(max(0.0, (box[0] - 20) / w))
        if not (top <= box[1] and box[3] <= top + c.winfo_height()):
            c.yview_moveto(max(0.0, (box[1] - c.winfo_height() / 3) / h))

    def zoom(self, factor: float) -> None:
        self._fit = False
        self._scale = min(3.0, max(0.4, self._scale * factor))
        self._build()

    def fit_width(self) -> None:
        self._fit = True
        self._apply_fit()
        self._build()

    def _apply_fit(self) -> bool:
        avail = self.canvas.winfo_width() - 6
        if avail > 100:
            new = min(1.6, max(0.4, avail / W))
            if abs(new - self._scale) > 0.01:
                self._scale = new
                return True
        return False

    def _on_resize(self, _e) -> None:
        if self._fit and self._apply_fit():
            self._build()

    def _hit(self, x: int, y: int, prefix: str) -> str | None:
        """Klíč I/O ovládacího prvku pod kurzorem (značka ``prefix<klíč>``)."""
        c = self.canvas
        cx, cy = c.canvasx(x), c.canvasy(y)
        for item in reversed(c.find_overlapping(cx - 1, cy - 1, cx + 1, cy + 1)):
            for t in c.gettags(item):
                if t.startswith(prefix):
                    return t[len(prefix):]
        return None

    def knob_percent(self, key: str) -> float:
        raw = (self._res or {}).get("frame", {}).get("io", {}).get(key) or 0
        return min(100.0, max(0.0, float(raw) / RAW_MAX * 100))

    def set_knob(self, key: str, percent: float) -> None:
        """Potenciometr na ``percent`` % rozsahu (ořízne se na 0–100)."""
        percent = min(100.0, max(0.0, percent))
        self.on_analog(key, round(percent / 100 * RAW_MAX))

    def _on_wheel(self, e) -> None:
        key = self._hit(e.x, e.y, "knob:") if self.on_analog else None
        if key is not None:
            self.set_knob(key, self.knob_percent(key) + (2 if e.delta > 0 else -2))
        else:
            self.canvas.yview_scroll(-1 if e.delta > 0 else 1, "units")

    def _on_double(self, e) -> None:
        key = self._hit(e.x, e.y, "knob:") if self.on_analog else None
        if key is not None:
            self.set_knob(key, 50.0)

    def _on_press(self, e) -> None:
        self._grab = None
        if self.on_analog is not None and (key := self._hit(e.x, e.y, "knob:")):
            self._grab = ("knob:", key, e.y, self.knob_percent(key))
            return
        if self.on_force is not None:
            for prefix in ("rel:", "btn:"):
                if key := self._hit(e.x, e.y, prefix):
                    self._grab = (prefix, key)
                    return
        self._press, self._dragging = (e.x, e.y), False
        self.canvas.scan_mark(e.x, e.y)

    def _on_drag(self, e) -> None:
        if self._grab is not None:
            if self._grab[0] == "knob:":          # 1 px nahoru = +0,5 % rozsahu
                _p, key, y0, v0 = self._grab
                self.set_knob(key, v0 + (y0 - e.y) * 0.5)
            return
        if self._press and (abs(e.x - self._press[0]) > 4 or abs(e.y - self._press[1]) > 4):
            self._dragging = True
        if self._dragging:
            self.canvas.scan_dragto(e.x, e.y, gain=1)

    def _on_release(self, e) -> None:
        if self._grab is not None:
            grab, self._grab = self._grab, None
            prefix, key = grab[0], grab[1]
            if prefix != "knob:" and self._hit(e.x, e.y, prefix) == key:
                if prefix == "rel:":
                    self.on_force(key, None)
                else:                              # vnutí opak toho, co program právě čte
                    io = (self._res or {}).get("frame", {}).get("io", {})
                    self.on_force(key, io.get(key) is not True)
            return
        was_drag, self._press, self._dragging = self._dragging, None, False
        if was_drag:
            return
        dev_id = self.device_at(e.x, e.y)
        if dev_id is not None:
            if self.on_select is not None:
                self.on_select(dev_id)              # volající zavolá select() → zvýraznění
            else:
                self.select(dev_id)
            return
        mod = self._hit(e.x, e.y, "mod:")
        if mod is not None:                         # opakovaný klik na týž modul výběr zruší
            idx = int(mod)
            self.select_module(None if self._mod == idx else idx)
        elif self._sel is not None or self._mod is not None:
            self._sel, self._mod = None, None       # klik do prázdna: zrušit zvýraznění
            self._place_selection()

    def device_at(self, x: int, y: int) -> int | None:
        c = self.canvas
        cx, cy = c.canvasx(x), c.canvasy(y)
        for item in reversed(c.find_overlapping(cx - 1, cy - 1, cx + 1, cy + 1)):
            for tag in c.gettags(item):
                if tag.startswith("dev:"):
                    return int(tag[4:])
        return None
