#!/usr/bin/env node
// Obrazky na web PRIMO z jadra (packages/core/dist) - stejny ukazkovy projekt jako PDF
// (scripts/ukazka-pdf.js: sampleComplex + cast polozek schvalena smyslenou osobou):
//   assets/img/ukazka-*.svg        skutecne vykresy (blokove schema, zapojeni modulu,
//                                  bezpecnostni okruh, casovy a funkcni diagram)
//   assets/img/doc-{cs,en,de}-0N.webp   nahledy stran ukazkove dokumentace (titulni strana,
//                                  protokol schvaleni, I/O list, bezpecnostni funkce)
// Spusteni z apps/site: node scripts/obrazky.js        (headless Edge jen kvuli nahledum stran)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./cdp.js";
import { sampleProject, buildHtml, rebrand } from "./ukazka-pdf.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "..", "..", "packages", "core", "dist", "index.js");
const IMG = path.join(ROOT, "assets", "img");
const LANGS = ["cs", "en", "de"];
const C = await import(pathToFileURL(CORE).href);

// ---------- vykresy (cesky projekt; texty vykresu jsou latinkou) ----------
const DRAWINGS = [
  ["blokove_schema.svg", "ukazka-blokove.svg"],
  ["DI1_X1.svg", "ukazka-di1.svg"],
  ["DO1_X3.svg", "ukazka-do1.svg"],
  ["bezpecnostni_okruh.svg", "ukazka-bezpecnost.svg"],
  ["casovy_diagram.svg", "ukazka-casovy.svg"],
  ["funkcni_diagram.svg", "ukazka-funkcni.svg"],
];
C.setLang("cs");
{
  const files = C.allProjectFiles(sampleProject({ approver: "-", approver_note: "" }));
  for (const [name, out] of DRAWINGS) {
    const f = files.find((x) => x.name === name);
    if (!f) throw new Error("V jadru chybi " + name);
    // jadro dava jen sirku; vyska z viewBoxu, at <img> nezabira misto spatne pred nactenim
    let svg = rebrand(f.body);
    const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
    if (vb && !/<svg[^>]*\sheight=/.test(svg.slice(0, 400))) svg = svg.replace(/<svg /, `<svg height="${vb[2]}" `);
    fs.writeFileSync(path.join(IMG, out), svg);
    console.log(`assets/img/${out}  ${(svg.length / 1024).toFixed(0)} kB${vb ? `  ${vb[1]}x${vb[2]}` : ""}`);
  }
}

// ---------- nahledy stran dokumentace ----------
// Strany se vykresli na obrazovce v sirce A4 (794 px) a vyrizne se vzdy jedna "strana".
const PAGES = ["", "11_schvaleni.md", "02_io_list.csv", "13_bezpecnostni_funkce.md"]; // "" = titulni strana
const SCREEN_CSS = `<style>
body { width: 794px; background: #fff; }
section { padding: 56px 58px; min-height: 1123px; }
img.sheet { max-height: 900px; }
</style></head>`;
const W = 794, H = 1123, SCALE = 0.6;

const browser = await launch();
try {
  const page = await browser.page();
  await page.viewport(W, 900);
  for (const lang of LANGS) {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, "content", `${lang}.json`), "utf-8")).pdf;
    const html = buildHtml(lang, t).replace("</head>", SCREEN_CSS);
    const tmp = path.join(os.tmpdir(), `plcdesk-nahled-${lang}.html`);
    fs.writeFileSync(tmp, html);
    await page.goto(pathToFileURL(tmp).href, 400);
    for (let i = 0; i < PAGES.length; i++) {
      const y = await page.eval(
        PAGES[i] === ""
          ? "0"
          : `(() => { const s = [...document.querySelectorAll('section .sh span')].find(e => e.textContent.trim() === ${JSON.stringify(PAGES[i])}); return s ? s.closest('section').getBoundingClientRect().top + scrollY : -1; })()`
      );
      if (y < 0) throw new Error(`Strana ${PAGES[i]} v dokumentaci ${lang} chybi`);
      const shot = await page.send("Page.captureScreenshot", {
        format: "webp",
        quality: 80,
        captureBeyondViewport: true,
        clip: { x: 0, y, width: W, height: H, scale: SCALE },
      });
      const file = path.join(IMG, `doc-${lang}-0${i + 1}.webp`);
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      console.log(`assets/img/doc-${lang}-0${i + 1}.webp  ${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
    }
    fs.rmSync(tmp, { force: true });
  }
} finally {
  browser.close();
}
