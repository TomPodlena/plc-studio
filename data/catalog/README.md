# Katalog komponent pro kusovník

Rešerše značek, řad a dodavatelů (zaměřeno na český trh). `scripts/build_catalog.py` z ní
generuje `packages/core/src/catalog_data.ts` — aplikace za běhu nic nestahuje.

Soubory podle oblasti: `pohony.json`, `pneu.json`, `snimace.json`, `plc.json`. Tvar:

```json
{
  "categories": {
    "<kategorie>": { "label": "…", "unit": "ks", "brands": [
      { "brand": "…", "series": ["…"], "typical": "…", "orderCode": "…", "src": "https://…",
        "priceLevel": "nízká|střední|vysoká", "suppliers": ["…"], "note": "…" } ] }
  },
  "suppliers": [ { "name": "…", "url": "…", "country": "CZ", "kind": "výrobce|distributor|e-shop", "cats": ["…"] } ],
  "notes": ["…"]
}
```

- Klíče kategorií = `CAT_LABEL` v `catalog.ts`; PLC moduly per platforma `plc_di@siemens` apod.
- Objednací kód jen s URL zdroje (`src`), kde byl ověřen — jinak jen řada. Ceny se neuvádějí.
- Bezpečnostní komponenty jsou jen HW položky; volba a zapojení podle posouzení rizik
  (EN ISO 13849), návrh k revizi.
- Pořadí značek v kategorii = výchozí volba (první).
