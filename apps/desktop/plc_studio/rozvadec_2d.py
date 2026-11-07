"""2D výkres rozložení rozvaděče (SVG) z ``rozvadec/layout.json`` generátoru ``pro3d_cabinet``.

Čistý modul bez závislostí: kreslí jen hodnoty z layoutu (nic nového nepočítá). Pohledy:
montážní deska (lišty, žlaby, přístroje), dveře (přístroje na dveřích) a dno s vývodkami.
Souřadnice layoutu: X zleva při pohledu zepředu, Y do hloubky, Z nahoru; ``box`` =
[x0, x1, y0, y1, z0, z1].
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from .i18n import _

GRID = 28  # mezera mezi pohledy (px)


def _estimate(dev: dict) -> bool:
    """Rozměr přístroje je ODHAD (datový list chybí) — podle stavu rozměru v layoutu."""
    txt = " ".join(str((dev.get("rozmer") or {}).get(k, "")) for k in ("stav", "zdroj")).lower()
    return "odhad" in txt


def has_cabinet(manifest: dict) -> bool:
    """Manifest CAD má skříň (díl s kategorií ``cabinet``)."""
    return any((p or {}).get("category") == "cabinet" for p in manifest.get("parts") or [])


def layout_svg(layout: dict, nazev: str) -> str:
    """SVG se třemi pohledy a popisovým polem; bez skříně v layoutu prázdný řetězec."""
    cab = layout.get("cabinet") or {}
    W, H, D = (float(cab.get(k) or 0) for k in ("w", "h", "d"))
    if W <= 0 or H <= 0:
        return ""
    s = min(1.0, 520.0 / W, 640.0 / H)
    m = 40.0
    ox1, oy = m + 14, m + 14
    ox2 = ox1 + W * s + GRID + 30
    oy3 = oy + H * s + GRID + 20
    dh = max(D, 1.0) * s
    tw = ox2 + W * s + m
    th = oy3 + dh + 24 + 70
    out: list[str] = []
    a = out.append

    def px(ox, x):
        return ox + x * s

    def pz(z):
        return oy + (H - z) * s

    def rect(ox, x0, x1, z0, z1, cls):
        a(f'<rect class="{cls}" x="{px(ox, x0):.1f}" y="{pz(z1):.1f}" '
          f'width="{(x1 - x0) * s:.1f}" height="{(z1 - z0) * s:.1f}"/>')

    def text(x, y, t, cls="t", anchor="start"):
        a(f'<text class="{cls}" x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}">{escape(str(t))}</text>')

    def dims(ox, y_off):
        a(f'<line class="dm" x1="{ox:.1f}" y1="{y_off:.1f}" x2="{ox + W * s:.1f}" y2="{y_off:.1f}"/>')
        text(ox + W * s / 2, y_off - 3, f"{W:g}", "dt", "middle")
        a(f'<line class="dm" x1="{ox - 12:.1f}" y1="{oy:.1f}" x2="{ox - 12:.1f}" y2="{oy + H * s:.1f}"/>')
        a(f'<text class="dt" transform="translate({ox - 15:.1f},{oy + H * s / 2:.1f}) rotate(-90)" '
          f'text-anchor="middle">{H:g}</text>')

    a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{tw:.0f}" height="{th:.0f}" '
      f'viewBox="0 0 {tw:.0f} {th:.0f}" font-family="Arial, sans-serif">')
    a('<style>.fr{fill:#fff;stroke:#222;stroke-width:1.2}.pl{fill:#f1f1ec;stroke:#555;stroke-width:.8}'
      '.dn{fill:#dfe8f2;stroke:#2a4d78;stroke-width:.8}.zl{fill:#e6e6e6;stroke:#777;stroke-width:.8;'
      'stroke-dasharray:4 2}.ls{fill:#bbb;stroke:#555;stroke-width:.8}.pr{fill:#fff4d6;stroke:#8a5a00;'
      'stroke-width:.8}.od{fill:#ffe0c0;stroke:#d06000;stroke-width:1;stroke-dasharray:3 2}'
      '.dm{stroke:#444;stroke-width:.6}.dt{font-size:9px;fill:#222}.t{font-size:8px;fill:#111}'
      '.h{font-size:11px;font-weight:bold;fill:#111}.n{font-size:9px;fill:#555}</style>')
    a(f'<rect width="{tw:.0f}" height="{th:.0f}" fill="#fff"/>')

    # --- montážní deska
    text(ox1, oy - 8, _("Montážní deska (pohled zepředu)"), "h")
    rect(ox1, 0, W, 0, H, "fr")
    pl = layout.get("plate") or {}
    if pl:
        rect(ox1, pl["x0"], pl["x1"], pl["z0"], pl["z1"], "pl")
    for d in layout.get("ducts") or []:
        if d.get("x0") is None:
            continue
        rect(ox1, d["x0"], d["x1"], d["z0"], d["z1"], "zl")
        text(px(ox1, d["x0"]) + 2, pz(d["z1"]) + 8, d.get("name", ""), "n")
    for r in layout.get("rails") or []:
        zc = r["zc"]
        rect(ox1, r["x0"], r["x1"], zc - 17.5, zc + 17.5, "ls")
        text(px(ox1, r["x0"]), pz(zc + 17.5) - 2, f'{r.get("name", "")} — {r.get("rezerva_pct", "")} %', "n")
    n_est = 0
    for dv in layout.get("devices") or []:
        if dv.get("door") or not dv.get("box"):
            continue
        b = dv["box"]
        est = _estimate(dv)
        n_est += est
        rect(ox1, b[0], b[1], b[4], b[5], "od" if est else "pr")
        text(px(ox1, (b[0] + b[1]) / 2), pz((b[4] + b[5]) / 2) + 3,
             dv.get("tag", "") + (" *" if est else ""), "t", "middle")
    dims(ox1, oy + H * s + 14)

    # --- dveře
    text(ox2, oy - 8, _("Dveře (pohled zevnitř skříně)"), "h")
    rect(ox2, 0, W, 0, H, "fr")
    for dv in (layout.get("door") or {}).get("items") or []:
        b = dv.get("box")
        if not b:
            continue
        est = _estimate(dv)
        n_est += est
        rect(ox2, b[0], b[1], b[4], b[5], "od" if est else "dn")
        text(px(ox2, (b[0] + b[1]) / 2), pz((b[4] + b[5]) / 2) + 3,
             dv.get("tag", "") + (" *" if est else ""), "t", "middle")
    dims(ox2, oy + H * s + 14)

    # --- dno (půdorys) s vývodkami
    text(ox1, oy3 - 6, _("Dno skříně s vývodkami (půdorys)"), "h")
    a(f'<rect class="fr" x="{ox1:.1f}" y="{oy3:.1f}" width="{W * s:.1f}" height="{dh:.1f}"/>')
    for i, g in enumerate((layout.get("hw") or {}).get("glands") or [], 1):
        cx, cy = px(ox1, g["x"]), oy3 + g["y"] * s
        a(f'<circle class="pr" cx="{cx:.1f}" cy="{cy:.1f}" r="{max(float(g.get("thread") or 20) * s / 2, 2):.1f}"/>')
        text(cx, cy + 3, str(i), "t", "middle")
    text(ox1 + W * s + 6, oy3 + dh / 2, f"{D:g}", "dt")

    # --- popisové pole
    ty = th - 62
    a(f'<rect class="fr" x="{m:.0f}" y="{ty:.0f}" width="{tw - 2 * m:.0f}" height="52"/>')
    text(m + 8, ty + 16, f'{_("Projekt")}: {nazev or layout.get("projekt", "")}', "h")
    typ = f'{cab.get("brand", "")} {cab.get("orderCode", "")} — {W:g} × {H:g} × {D:g} mm'.strip()
    text(m + 8, ty + 31, f'{_("Skříň")}: {typ}', "t")
    text(m + 8, ty + 45, _("Návrh — ověří elektroprojektant"), "t")
    if n_est:
        text(tw - m - 8, ty + 45, _("* rozměr přístroje je ODHAD"), "n", "end")
    a("</svg>")
    return "\n".join(out)
