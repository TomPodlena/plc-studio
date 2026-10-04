/* PLCdesk — tvary podle čísla (plurál) nad překlady jádra.

   Klíč je jeden český literál s tvary oddělenými „|“ v pořadí češtiny: 1 | 2–4 | 0 a 5+
   („{n} soubor|{n} soubory|{n} souborů“). Překlad nese tvary cílového jazyka: angličtina,
   němčina a španělština 1 | ostatní („{n} file|{n} files“), čínština jediný tvar. Tvar se
   vybere podle pravidla jazyka; chybí-li, vezme se poslední. Desktop má totéž v i18n.py (_n).

     trn(n, klíč) — klíč označený značkou N_ (kvůli sběru klíčů), např. „{n} soubor|{n} soubory|{n} souborů“
*/
import { tr, fill, getLang } from "../../../packages/core/dist/index.js";

const RULES = {
  cs: n => n === 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2,
  en: n => n === 1 ? 0 : 1,
  de: n => n === 1 ? 0 : 1,
  es: n => n === 1 ? 0 : 1,
  zh: () => 0,
};

/** Index tvaru pro číslo `n` v jazyce `lang` (desetinná čísla = poslední tvar). */
export function pluralIndex(n, lang = getLang()) {
  const x = Math.abs(Number(n));
  if (!Number.isInteger(x)) return 99;
  return (RULES[lang] || RULES.en)(x);
}

/** Přeložený text ve tvaru pro číslo `n`; `{n}` a další `{…}` se dosadí z `params`. */
export function trn(n, key, params = {}) {
  const forms = tr(key).split("|");
  return fill(forms[Math.min(pluralIndex(n), forms.length - 1)], { n, ...params });
}
