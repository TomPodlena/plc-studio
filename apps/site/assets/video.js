/* PLCdesk — videopruvodce (/video/): prepinac jazyka videa, kapitoly (klik = pretoceni), zvyrazneni
   aktualni kapitoly. Bez inline skriptu (CSP). Bez JS funguji odkazy: kapitola = soubor MP4 s #t=,
   jazyk = ?v=<jazyk> (zde ho skript precte) a soubory ke stazeni pod prehravacem. */
(function () {
  "use strict";
  var root = document.querySelector("[data-video]");
  if (!root) return;
  var video = root.querySelector("video");
  var btns = [].slice.call(root.querySelectorAll("[data-v]"));
  var lists = [].slice.call(document.querySelectorAll("[data-chapters]"));
  var cur = root.getAttribute("data-default");

  function btn(l) {
    for (var i = 0; i < btns.length; i++) if (btns[i].getAttribute("data-v") === l) return btns[i];
    return null;
  }

  function select(l, remember) {
    var b = btn(l);
    if (!b) return false;
    if (l !== cur) {
      video.pause();
      video.querySelector("source").setAttribute("src", b.getAttribute("data-src"));
      var old = video.querySelector("track");
      if (old) old.parentNode.removeChild(old);
      var vtt = b.getAttribute("data-vtt");
      if (vtt) {
        var t = document.createElement("track");
        t.kind = "subtitles";
        t.src = vtt;
        t.srclang = l;
        t.label = b.getAttribute("data-label");
        video.appendChild(t);
      }
      var poster = b.getAttribute("data-poster");
      if (poster) video.setAttribute("poster", poster); else video.removeAttribute("poster");
      video.setAttribute("lang", l);
      video.load();
      cur = l;
    }
    btns.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    lists.forEach(function (x) { x.hidden = x.getAttribute("data-chapters") !== l; });
    if (remember && window.history && history.replaceState) {
      try { history.replaceState(null, "", "?v=" + l + location.hash); } catch (e) { /* file:// apod. */ }
    }
    mark();
    return true;
  }

  btns.forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      select(b.getAttribute("data-v"), true);
    });
  });

  // kapitoly: klik pretoci video (bez JS odkaz otevre soubor MP4 s #t=)
  lists.forEach(function (list) {
    list.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest("a[data-t]") : null;
      if (!a) return;
      e.preventDefault();
      select(list.getAttribute("data-chapters"), true);
      video.currentTime = Number(a.getAttribute("data-t"));
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* prehravani muze prohlizec odmitnout - pozice zustane */ });
      var r = root.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) root.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });

  // aktualni kapitola (aria-current)
  function mark() {
    var list = null;
    lists.forEach(function (x) { if (x.getAttribute("data-chapters") === cur) list = x; });
    if (!list) return;
    var links = list.querySelectorAll("a[data-t]"), on = null;
    for (var i = 0; i < links.length; i++) if (Number(links[i].getAttribute("data-t")) <= video.currentTime + 0.25) on = links[i];
    for (var j = 0; j < links.length; j++) {
      if (links[j] === on) links[j].setAttribute("aria-current", "true"); else links[j].removeAttribute("aria-current");
    }
  }
  video.addEventListener("timeupdate", mark);
  video.addEventListener("seeked", mark);

  var want = null;
  try { want = new URLSearchParams(location.search).get("v"); } catch (e) { /* stary prohlizec */ }
  if (want && want !== cur) select(want, false);
  else mark();
})();
