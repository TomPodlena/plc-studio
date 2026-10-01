import { genSiemensTagsTSV, genSiemensTagsXml, genLibrary, genMainSiemens, genMainIEC, genTagFile, genReadme, } from "./codegen.js";
import { genPLCopenXML } from "./plcopen.js";
const PLCOPEN_PLATS = ["codesys", "beckhoff", "schneider"];
export function genFor(prj, plat) {
    const files = {};
    if (plat === "siemens") {
        files["Gen_Tags.tsv"] = genSiemensTagsTSV(prj);
        files["Gen_IO.xml"] = genSiemensTagsXml(prj);
        files["Gen_Library.scl"] = genLibrary(prj, "siemens");
        files["Gen_Main.scl"] = genMainSiemens(prj);
    }
    else {
        if (PLCOPEN_PLATS.includes(plat))
            files["PLCopen_Import.xml"] = genPLCopenXML(prj, plat);
        const tf = genTagFile(prj, plat);
        files[tf.name] = tf.body;
        files["Gen_Library.st"] = genLibrary(prj, plat);
        files["MAIN.st"] = genMainIEC(prj, plat);
    }
    files["README.txt"] = genReadme(prj, plat);
    return files;
}
