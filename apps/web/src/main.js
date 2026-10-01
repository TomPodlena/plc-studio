/* Demo shell nad @plc-studio/core (bez build kroku: importuje zkompilovaný dist). */
import { sampleSmall, sampleComplex, allProjectFiles } from "../../../packages/core/dist/index.js";

const $ = (id) => document.getElementById(id);
let prj = sampleComplex();
prj.platforms = ["siemens", "codesys"];
let files = [], sel = 0;

function refresh() {
  files = allProjectFiles(prj);
  if (sel >= files.length) sel = 0;
  const groups = [...new Set(files.map(f => f.group))];
  let html = "";
  for (const g of groups) {
    html += "<h4>" + g + "</h4>";
    files.forEach((f, i) => { if (f.group === g) html += '<button data-i="' + i + '" class="' + (i === sel ? "on" : "") + '">' + f.name + "</button>"; });
  }
  $("list").innerHTML = html;
  $("list").querySelectorAll("button").forEach(b => b.onclick = () => { sel = +b.dataset.i; refresh(); });
  const f = files[sel];
  if (f.kind === "svg") $("pane").innerHTML = '<div class="svgbox">' + f.body + "</div>";
  else if (f.kind === "dxf") $("pane").innerHTML = '<p class="hint">DXF pro CAD — náhled:</p><div class="svgbox">' + f.prev + "</div>";
  else { $("pane").innerHTML = "<pre></pre>"; $("pane").querySelector("pre").textContent = f.body; }
}

$("samples").innerHTML =
  '<button id="s1">Ukázka: malá stanice</button><button id="s2" class="on">Ukázka: složitá linka</button>';
$("s1").onclick = () => { prj = sampleSmall(); prj.platforms = ["siemens", "codesys"]; sel = 0; refresh(); mark("s1"); };
$("s2").onclick = () => { prj = sampleComplex(); prj.platforms = ["siemens", "codesys"]; sel = 0; refresh(); mark("s2"); };
function mark(id) { for (const x of ["s1", "s2"]) $(x).classList.toggle("on", x === id); }

refresh();
