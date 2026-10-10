#!/usr/bin/env node
// Vygeneruje admin/config.yml pro Sveltia CMS ze struktury content/cs.json, aby formular
// v administraci vzdy odpovidal textum webu (pridany klic = nove pole, bez rucni udrzby).
// Spusteni: node scripts/cms-config.js        Kontrola aktualnosti: node scripts/cms-config.js --check

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "admin", "config.yml");
const cs = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "cs.json"), "utf-8"));
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "site.json"), "utf-8"));

// Popisky sekci v administraci (ostatni klice se ukazou tak, jak jsou v JSON)
const LABELS = {
  meta: "SEO – výchozí", ui: "Popisky rozhraní", nav: "Menu", home: "Úvod", funkce: "Funkce",
  platformy: "Platformy", cenik: "Ceník", ukazka: "Ukázka dokumentace", stazeni: "Ke stažení",
  kontakt: "Kontakt", beta: "Beta testeři", podminky: "Podmínky užití", soukromi: "Ochrana osobních údajů",
  notfound: "Stránka 404", pdf: "Texty ukázkového PDF",
};

const q = (s) => JSON.stringify(String(s));
const pad = (n) => " ".repeat(n);

function field(name, value, ind, label = LABELS[name] || name) {
  const head = `${pad(ind)}- name: ${q(name)}\n${pad(ind)}  label: ${q(label)}\n${pad(ind)}  i18n: true\n`;
  if (name === "lang" || name === "locale") return `${pad(ind)}- { name: ${q(name)}, label: ${q(name)}, widget: hidden, i18n: true }\n`;
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === "object") {
      // sjednoceni klicu vsech polozek; co nemaji vsechny, je nepovinne (napr. "note")
      const all = Object.assign({}, ...value);
      const opt = (k) => value.some((it) => !(k in it));
      return head + `${pad(ind)}  widget: list\n${pad(ind)}  fields:\n` +
        Object.entries(all).map(([k, v]) => field(k, v, ind + 4).replace(/\n$/, opt(k) ? `\n${pad(ind + 4)}  required: false\n` : "\n")).join("");
    }
    return head + `${pad(ind)}  widget: list\n`;
  }
  if (value && typeof value === "object") {
    return head + `${pad(ind)}  widget: object\n${pad(ind)}  collapsed: true\n${pad(ind)}  fields:\n` +
      Object.entries(value).map(([k, v]) => field(k, v, ind + 4)).join("");
  }
  return head + `${pad(ind)}  widget: ${String(value).length > 90 ? "text" : "string"}\n`;
}

const yml = `# Sveltia CMS - ${site.brand} (VYGENEROVANO: node scripts/cms-config.js, rucne neupravovat)
# Dokumentace: https://github.com/sveltia/sveltia-cms
#
# Prihlaseni jde pres GitHub. Mezi prohlizec a GitHub patri maly prihlasovaci Worker
# (sveltia-cms-auth, free) - postup v NASAZENI.md. Ulozeni v CMS = commit do vetve main,
# ten spusti nasazeni (.github/workflows/deploy-site.yml).
# Pravidla textu: cestina je zdroj pravdy, nazev znacky piste jako {{site.brand}}.

backend:
  name: github
  repo: TomPodlena/plc-studio
  branch: main
  base_url: https://sveltia-cms-auth.podlena-t.workers.dev

media_folder: apps/site/assets/img
public_folder: /assets/img

i18n:
  structure: multiple_files
  locales: [cs, en, de]
  default_locale: cs

collections:
  - name: texty
    label: Texty webu
    i18n: true
    files:
      - name: web
        label: Všechny stránky
        file: apps/site/content/{{locale}}.json
        format: json
        i18n: true
        fields:
${Object.entries(cs).map(([k, v]) => field(k, v, 10)).join("")}
  - name: nastaveni
    label: Společné údaje
    files:
      - name: site
        label: "Značka, adresa, kontakt (všechny jazyky)"
        file: apps/site/content/site.json
        format: json
        fields:
${Object.entries(site)
  .filter(([k]) => !k.startsWith("_"))
  .map(([k, v]) =>
    v && typeof v === "object"
      ? `          - name: ${q(k)}\n            label: ${q(k)}\n            widget: object\n            fields:\n` +
        Object.keys(v).map((kk) => `              - { name: ${q(kk)}, label: ${q(kk)}, widget: string, required: false }\n`).join("")
      : `          - { name: ${q(k)}, label: ${q(k)}, widget: string }\n`
  )
  .join("")}`;

if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf-8") : "";
  if (cur !== yml) {
    console.error("admin/config.yml neodpovida content/cs.json - spust: node scripts/cms-config.js");
    process.exit(1);
  }
  console.log("admin/config.yml je aktualni.");
} else {
  fs.writeFileSync(OUT, yml);
  console.log(`Zapsano ${path.relative(ROOT, OUT)} (${yml.split("\n").length} radku)`);
}
