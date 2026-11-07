"""2D výkres rozložení rozvaděče: každý přístroj v SVG, platné XML, projekt bez skříně nic nekreslí."""

import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from plc_studio.pro3d_cabinet import cli
from plc_studio.rozvadec_2d import has_cabinet, layout_svg

DATA = Path(__file__).parent / "data"
VZORY = [DATA / "celek" / "01_PLCdesk_CAD.json", DATA / "moduly" / "03_PLCdesk_CAD.json"]


class Rozvadec2dTest(unittest.TestCase):
    def test_vzory(self):
        for f in VZORY:
            with self.subTest(f=f.name):
                man = json.loads(f.read_text(encoding="utf-8"))
                if not has_cabinet(man):
                    continue
                with tempfile.TemporaryDirectory() as d:
                    cli.generate(f, d, no_fc=True)
                    lay = json.loads((Path(d) / "rozvadec" / "layout.json").read_text(encoding="utf-8"))
                svg = layout_svg(lay, "Vzor")
                ET.fromstring(svg)  # platné XML
                tags = {x["tag"] for x in lay["devices"] if x.get("tag")}
                tags |= {x["tag"] for x in lay["door"]["items"] if x.get("tag")}
                self.assertTrue(tags)
                for t in tags:
                    self.assertIn(f">{t}", svg)

    def test_bez_skrine(self):
        self.assertEqual(layout_svg({}, "x"), "")
        self.assertFalse(has_cabinet({"parts": [{"category": "motor"}]}))


if __name__ == "__main__":
    unittest.main()
