"""Kabely E2 / E3 pevnou dráhou (svazek_drah.plan_kabel): 0 průniků kabel × kabel a kabel × zóna zdvihu válce na plánu bez FreeCADu."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from plc_studio.pro3d_lib import celek, modul_ostrov, svazek as sv, svazek_drah as sdr  # noqa: E402

DATA = ROOT / "tests" / "data"
VZORY = {"20": DATA / "moduly" / "20_PLCdesk_CAD.json", "01": DATA / "celek" / "01_PLCdesk_CAD.json"}


def _kabelaz():
    try:
        modul_ostrov.trasa_mod()
        return True
    except RuntimeError:
        return False


def _usecky(kabely):
    out = []
    for k in kabely:
        for e in k["path"]:
            if "line" in e:
                out.append((k["name"], e["line"][0], e["line"][1], k["r"]))
    return out


def _vzd_usecek(p1, q1, p2, q2):
    """Nejmenší vzdálenost dvou úseček ve 3D (iterativní zpřesnění po parametrech, dost pro osy kabelů)."""
    import math
    d1 = [q1[i] - p1[i] for i in range(3)]
    d2 = [q2[i] - p2[i] for i in range(3)]
    r = [p1[i] - p2[i] for i in range(3)]
    a = sum(x * x for x in d1)
    e = sum(x * x for x in d2)
    f = sum(d2[i] * r[i] for i in range(3))
    c = sum(d1[i] * r[i] for i in range(3))
    b = sum(d1[i] * d2[i] for i in range(3))
    den = a * e - b * b
    s = 0.0 if den < 1e-12 else min(1.0, max(0.0, (b * f - c * e) / den))
    t = (b * s + f) / e if e > 1e-12 else 0.0
    if t < 0.0:
        t, s = 0.0, (min(1.0, max(0.0, -c / a)) if a > 1e-12 else 0.0)
    elif t > 1.0:
        t, s = 1.0, (min(1.0, max(0.0, (b - c) / a)) if a > 1e-12 else 0.0)
    return math.dist([p1[i] + d1[i] * s for i in range(3)], [p2[i] + d2[i] * t for i in range(3)])


def pruniky_kabelu(kabely):
    """Dvojice úseků různých kabelů, jejichž osy jsou blíž než r1 + r2 − 0,5 mm (skutečná vzdálenost úseček ve 3D)."""
    seg = _usecky(kabely)
    bad = []
    for i, (n1, a1, b1, r1) in enumerate(seg):
        for n2, a2, b2, r2 in seg[i + 1:]:
            if n1 != n2 and sv._prekryv(sv._box(a1, b1, r1), sv._box(a2, b2, r2), 0.0) and _vzd_usecek(a1, b1, a2, b2) < r1 + r2 - 0.5:
                bad.append((n1, n2, [round(v) for v in a1], [round(v) for v in b1], [round(v) for v in a2], [round(v) for v in b2]))
    return bad


def pruniky_zon(kabely, plan):
    zony = []
    for m in plan["moduly"]:
        pl = m.get("placement") or {"pos": [0, 0, 0], "rot": celek.I3}
        for t in m.get("telesa") or []:
            if (t.get("props") or {}).get("Konstrukce_Zona") == "zdvih":
                b = celek._body_box(t["body"])
                if b:
                    g = celek._tb(pl["rot"], pl["pos"], b)
                    zony.append([g[0] + 2, g[1] + 2, g[2] + 2, g[3] - 2, g[4] - 2, g[5] - 2])
    bad = []
    for n, a, b, r in _usecky(kabely):
        if any(sv._prekryv(sv._box(a, b, r), z) for z in zony):
            bad.append((n, [round(v) for v in a], [round(v) for v in b]))
    return bad, len(zony)


@unittest.skipUnless(_kabelaz(), "skill kabelaz-a-hadice není nainstalován")
class KabelyE2Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from plc_studio.pro3d_cabinet import cli
        cls.plany = {}
        for nm, p in VZORY.items():
            tmp = Path(tempfile.mkdtemp(prefix="kab_"))
            r = cli.generate(p, tmp, no_fc=True)
            man = json.loads(p.read_text(encoding="utf-8"))
            cls.plany[nm] = celek.plan_celku(man, layout_path=str(r["layout"]))

    def _kabely(self, nm):
        return [k for m in self.plany[nm]["plan"]["moduly"] if m.get("tag") in ("E2", "E3") for k in m["kabely"]]

    def test_bez_pruniku_kabel_kabel(self):
        for nm in VZORY:
            ks = self._kabely(nm)
            self.assertTrue(ks, f"vzor {nm}: žádné kabely E2")
            print(f"vzor {nm}: postaveno kabelů E2/E3 {len(ks)}")
            self.assertEqual(pruniky_kabelu(ks), [], f"vzor {nm}")

    def test_bez_pruniku_se_zonou_zdvihu(self):
        for nm in VZORY:
            bad, nz = pruniky_zon(self._kabely(nm), self.plany[nm]["plan"])
            print(f"vzor {nm}: zón zdvihu {nz}")
            self.assertEqual(bad, [], f"vzor {nm}")


class RozestupTest(unittest.TestCase):
    def test_rozestup_zachova_poradi_a_odstup(self):
        v = sdr.rozestup([100.0, 100.0, 101.0, 500.0], [4.3] * 4, 50.0, 600.0)
        self.assertEqual(sorted(range(4), key=lambda i: v[i]), [0, 1, 2, 3])
        self.assertTrue(all(b - a >= 7.3 - 1e-6 for a, b in zip(sorted(v), sorted(v)[1:])))
        v = sdr.rozestup([590.0, 595.0, 600.0], [4.3] * 3, 50.0, 600.0)
        self.assertLessEqual(max(v), 600.0)

    def test_plan_kabel_vlastni_hladina(self):
        s = {"p1": [0, 0, 0], "A": [300, 0, 200], "n": [0, 0, 1], "r": 2.15, "R": 43.0}
        a = sdr.plan_kabel(s, [], [])
        self.assertIsNotNone(a)
        cizi = [sv._box(u, v, 2.15 + 2) for u, v in zip(a, a[1:])]
        s2 = dict(s, p1=[0, 8, 0], A=[300, 8, 200])
        b = sdr.plan_kabel(s2, [], cizi)
        self.assertIsNotNone(b)
        for u, v in zip(b, b[1:]):
            for x, y in zip(a, a[1:]):
                self.assertFalse(sv._prekryv(sv._box(u, v, 1.65), sv._box(x, y, 1.65), 0.5))


if __name__ == "__main__":
    unittest.main()
