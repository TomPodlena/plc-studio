/* Drobné UI utility. */
export const $ = (id) => document.getElementById(id);

export function card(el, num, title, inner) {
  const c = document.createElement("section");
  c.className = "card";
  c.innerHTML = '<h2><span class="n">' + num + "</span>" + title + "</h2>" + inner;
  el.appendChild(c);
  return c;
}

export function copyText(txt, btn) {
  const done = () => {
    if (!btn) return;
    const t = btn.textContent;
    btn.textContent = "Zkopírováno";
    setTimeout(() => (btn.textContent = t), 1500);
  };
  try { navigator.clipboard.writeText(txt).then(done).catch(() => {}); } catch { /* bez clipboardu */ }
}

const MIME = {
  svg: "image/svg+xml", dxf: "application/dxf", csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8", xml: "application/xml", json: "application/json",
};
export function downloadFile(name, body) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const blob = new Blob([body], { type: MIME[ext] || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
