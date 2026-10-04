/* PLCdesk — operace mostu pro revize, nabídku a firemní knihovnu (desktop).
   Jen předávání: pohled skládá apps/web/src/biz_view.js (sdílený s webem), logika je v jádře.
   Operace, které projekt mění, vrací změněný `prj` (desktop ho převezme). Texty pro uživatele
   tu nejsou — překládá biz_view.js / jádro (sběr klíčů prochází apps/web/src). */
import * as biz from "../web/src/biz_view.js";
import * as core from "../../packages/core/dist/index.js";

export const BIZ_OPS = {
  /* ---- revize */
  "revision.badge"({ prj }) { return biz.revisionBadge(prj); },
  "revision.view"({ prj, from = "", to = "", exact = false }) { return { prj, view: biz.revisionView(prj, { from, to, exact }) }; },
  "revision.md"({ prj, from = "", to = "", exact = false }) { return { file: core.CHANGES_FILE, md: biz.revisionMd(prj, { from, to, exact }) }; },
  "revision.create"({ prj, by = "", note = "" }) { const rec = biz.issueRevision(prj, by, note); return { prj, rec }; },
  /* dotčené položky schvalování (zvýraznění v kroku Schválení): položky aktuálního stavu přesně */
  "revision.affected"({ prj }) {
    core.syncIO(prj);
    if (!(prj.revisions || []).length) return { rev: "", invalid: [], added: [] };
    return biz.revisionAffected(prj, core.approvalItems(prj));
  },

  /* ---- nabídka */
  "quote.view"({ prj }) { return { prj, view: biz.quoteView(prj) }; },
  "quote.import"({ prj, text = "", currency = "" }) { const r = biz.importPrices(prj, text, currency || undefined); return { prj, ...r }; },
  "quote.set"({ prj, path, value = null }) { biz.setQuote(prj, path, value); return { prj }; },
  "quote.files"({ prj }) { return biz.quoteFiles(prj); },

  /* ---- firemní knihovna */
  "library.load"({ text = "", prj = null }) { const r = biz.loadLibrary(text); return { ...r, view: r.lib ? biz.libraryView(r.lib, prj) : null }; },
  "library.view"({ lib = null, prj = null }) { return { view: biz.libraryView(lib || (prj && prj.library) || null, prj) }; },
  "library.save"({ lib }) { return biz.saveLibrary(lib); },
  "library.template"() { const lib = biz.libraryTemplate(); return { lib, ...biz.saveLibrary(lib) }; },
  "library.attach"({ prj, lib }) { biz.attachToProject(prj, lib); return { prj }; },
  "library.detach"({ prj }) { biz.detachLibrary(prj); return { prj }; },
  "library.types"({ prj }) { return { types: biz.libraryDeviceTypes(prj), approvers: biz.approverNames(prj) }; },
  "library.add"({ prj, typeId, name = "" }) { const dev = biz.addFromLibrary(prj, typeId, name); return { prj, dev }; },
};
