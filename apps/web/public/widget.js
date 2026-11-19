/*! Hiwar chat widget loader. Isolated in an iframe, so it never touches the page's styles, and async, so it never blocks the page. */
(function () {
  var script = document.currentScript;
  if (!script || window.__hiwarLoaded) return;
  window.__hiwarLoaded = true;
  var key = script.getAttribute("data-deployment");
  if (!key) return;
  var base = new URL(script.src).origin;
  var frame = document.createElement("iframe");
  frame.src = base + "/embed/" + encodeURIComponent(key) + "?page=" + encodeURIComponent(location.href);
  frame.title = "Chat";
  frame.setAttribute("allow", "clipboard-write");
  var s = frame.style;
  s.position = "fixed";
  s.bottom = "16px";
  s.right = "16px";
  s.width = "84px";
  s.height = "84px";
  s.border = "0";
  s.zIndex = "2147483000";
  s.colorScheme = "normal";
  s.background = "transparent";
  window.addEventListener("message", function (event) {
    if (event.origin !== base || event.source !== frame.contentWindow || !event.data || event.data.hiwar !== "resize") return;
    var small = window.innerWidth < 480;
    if (event.data.position === "left") { s.left = "16px"; s.right = "auto"; } else { s.right = "16px"; s.left = "auto"; }
    if (event.data.open) {
      s.width = small ? "100vw" : "400px";
      s.height = small ? "100vh" : "min(640px, calc(100vh - 32px))";
      if (small) { s.bottom = "0"; s.right = "0"; s.left = "0"; }
      s.boxShadow = "0 16px 48px rgba(27,31,75,.22)";
      s.borderRadius = small ? "0" : "16px";
    } else {
      s.width = "84px";
      s.height = "84px";
      s.bottom = "16px";
      s.boxShadow = "none";
      s.borderRadius = "0";
    }
  });
  (document.body || document.documentElement).appendChild(frame);
})();
