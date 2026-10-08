import { licensedProjectFiles } from "./license.js";
import { allProjectFiles } from "./docs.js";
/** Podsložky složky dat projektu (stejné názvy v každém jazyce — cesty na disku). */
export const PROJECT_DIRS = {
    code: "kod", docs: "dokumentace", drawings: "vykresy", bom: "kusovnik", hmi: "hmi", exports: "exporty",
};
/** Sada souborů projektu roztříděná do podsložek (`PROJECT_DIRS`). `gate` = brána licence (null = bez licence). */
export function projectFolderFiles(prj, gate = null) {
    const files = gate ? licensedProjectFiles(prj, gate) : allProjectFiles(prj);
    const seen = new Set();
    const out = [];
    for (const f of files) {
        const dir = f.dir || PROJECT_DIRS.exports;
        const name = dir.startsWith(PROJECT_DIRS.code + "/") ? f.name : f.save;
        const path = dir + "/" + name;
        if (seen.has(path))
            continue; // stejný soubor z víc zdrojů (nemá nastat) — první vyhrává
        seen.add(path);
        out.push({ path, body: f.body, kind: f.kind });
    }
    return out;
}
