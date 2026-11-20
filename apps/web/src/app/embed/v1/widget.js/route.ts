import { connection } from "next/server";

import { env } from "@/lib/env";

/**
 * `GET /embed/v1/widget.js` (widget specification 3): the loader a host page includes.
 *
 * It holds no secret and draws only the launcher; the conversation runs in a frame served
 * from the platform, which the deployment's allowed origins alone may embed. The host page
 * and the frame talk through `postMessage`, checked by origin on both sides.
 *
 *   <script src="https://<host>/embed/v1/widget.js" data-deployment="shj3" data-lang="auto"
 *     data-position="bottom-right" data-open="false" data-context='{"page":"customs"}' defer></script>
 */

/**
 * The loader's source with the platform origin inlined. In the browser it reads the script tag's
 * `data-*` attributes, asks `/embed/v1/config` whether this page may load the deployment, draws
 * the launcher and the frame only when it may, relays messages to and from the frame only for
 * that origin and frame, and exposes `window.AnyPlatformAssistant`. A second include is a no-op.
 */
function loader(origin: string): string {
  return `(function () {
  "use strict";
  var ORIGIN = ${JSON.stringify(origin)};
  // A page opened as a file, or in a sandboxed frame, has an opaque origin, which browsers send as "null";
  // \`location.origin\` reads "file://" there in Chrome.
  var HOST = location.protocol === "file:" || location.origin === "null" ? "null" : location.origin;
  var script = document.currentScript || document.querySelector('script[src*="/embed/v1/widget.js"]');
  if (!script) return;
  var code = script.getAttribute("data-deployment");
  if (!code) { console.warn("[assistant] data-deployment is missing."); return; }
  if (window.AnyPlatformAssistant && window.AnyPlatformAssistant.__loaded) return;

  function pageLang() {
    var asked = (script.getAttribute("data-lang") || "auto").toLowerCase();
    if (asked === "en" || asked === "ar") return asked;
    var html = (document.documentElement.getAttribute("lang") || navigator.language || "en").toLowerCase();
    return html.indexOf("ar") === 0 ? "ar" : "en";
  }
  var lang = pageLang();
  var context = {};
  try { context = JSON.parse(script.getAttribute("data-context") || "{}") || {}; } catch (e) { context = {}; }
  var position = script.getAttribute("data-position") === "bottom-left" ? "left" : "right";
  var startOpen = script.getAttribute("data-open") === "true";
  var listeners = {};
  var queue = [];
  var frame = null, launcher = null, dot = null, ready = false, opened = false, expanded = false;

  function emit(name, detail) { (listeners[name] || []).forEach(function (fn) { try { fn(detail); } catch (e) {} }); }
  function post(message) {
    if (ready && frame) frame.contentWindow.postMessage(message, ORIGIN);
    else queue.push(message);
  }
  function side() {
    // RTL flips the corner (specification 3.1).
    var rtl = lang === "ar";
    return position === "right" ? (rtl ? "left" : "right") : (rtl ? "right" : "left");
  }
  function place() {
    var s = side();
    launcher.style.left = launcher.style.right = "auto";
    frame.style.left = frame.style.right = "auto";
    launcher.style[s] = "20px";
    frame.style[s] = expanded || window.innerWidth < 480 ? "0" : "20px";
  }

  function setOpen(next) {
    opened = next;
    if (!next && expanded) setExpanded(false);
    frame.style.display = next ? "block" : "none";
    launcher.setAttribute("aria-expanded", next ? "true" : "false");
    launcher.querySelector("[data-icon=open]").style.display = next ? "none" : "block";
    launcher.querySelector("[data-icon=close]").style.display = next ? "block" : "none";
    if (next) { dot.style.display = "none"; post({ type: "awp:open" }); emit("open", {}); }
    else { post({ type: "awp:close" }); emit("close", {}); launcher.focus(); }
  }

  function build(config) {
    var accent = config.accentColour || "#0677FF";
    var title = lang === "ar" ? config.title.ar : config.title.en;
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.setAttribute("aria-label", title);
    launcher.setAttribute("aria-expanded", "false");
    launcher.style.cssText = "position:fixed;bottom:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;background:" + accent + ";color:#fff;box-shadow:0 8px 24px rgba(16,24,40,.25);display:grid;place-items:center;padding:0";
    launcher.innerHTML =
      '<svg data-icon="open" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4L12 3z" fill="currentColor"/><path d="M18.5 15l.8 2 2 .7-2 .8-.8 2-.7-2-2-.8 2-.7.7-2z" fill="currentColor"/></svg>' +
      '<svg data-icon="close" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style="display:none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    dot.style.cssText = "position:absolute;top:6px;right:6px;width:12px;height:12px;border-radius:50%;background:#E5484D;border:2px solid #fff;display:none";
    launcher.appendChild(dot);
    launcher.addEventListener("click", function () { setOpen(!opened); });

    frame = document.createElement("iframe");
    var query = "?lang=" + lang + "&host=" + encodeURIComponent(HOST) + (context.page ? "&page=" + encodeURIComponent(context.page) : "");
    frame.src = ORIGIN + "/embed/v1/frame/" + encodeURIComponent(code) + query;
    frame.title = title;
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads");
    frame.setAttribute("allow", "microphone; clipboard-write");
    frame.style.cssText = "position:fixed;bottom:92px;z-index:2147483000;width:400px;height:min(640px,calc(100vh - 112px));max-width:100vw;border:0;border-radius:24px;box-shadow:0 16px 48px rgba(16,24,40,.28);display:none;background:transparent;color-scheme:normal";
    window.addEventListener("resize", fit);
    document.body.appendChild(frame);
    document.body.appendChild(launcher);
    fit();
    if (startOpen) setOpen(true);
  }

  // The panel's size: the whole page while expanded, the corner panel otherwise, full width on a phone.
  function fit() {
    var small = window.innerWidth < 480;
    frame.style.width = expanded || small ? "100vw" : "400px";
    frame.style.height = expanded ? "100vh" : small ? "calc(100vh - 92px)" : "min(640px,calc(100vh - 112px))";
    frame.style.bottom = expanded ? "0" : "92px";
    frame.style.borderRadius = expanded || small ? "0" : "24px";
    launcher.style.display = expanded ? "none" : "grid";
    place();
  }
  function setExpanded(next) {
    expanded = next;
    fit();
    post({ type: "awp:expanded", expanded: expanded });
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== ORIGIN || !frame || event.source !== frame.contentWindow) return;
    var data = event.data || {};
    if (data.type === "awp:ready") { ready = true; queue.splice(0).forEach(post); if (opened) post({ type: "awp:open" }); }
    else if (data.type === "awp:minimize") setOpen(false);
    else if (data.type === "awp:unread" && !opened) dot.style.display = "block";
    else if (data.type === "awp:expand") setExpanded(!expanded);
    else if (data.type === "awp:lang") { lang = data.lang === "ar" ? "ar" : "en"; place(); }
    else if (data.type === "awp:event") emit(data.name, data.detail || {});
  });

  window.AnyPlatformAssistant = {
    __loaded: true,
    open: function () { if (frame) setOpen(true); },
    close: function () { if (frame) setOpen(false); },
    startAction: function (id) { if (frame) { setOpen(true); post({ type: "awp:start", action: String(id) }); } },
    setLanguage: function (next) { lang = next === "ar" ? "ar" : "en"; if (frame) { place(); post({ type: "awp:lang", lang: lang }); } },
    on: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  };

  fetch(ORIGIN + "/embed/v1/config/" + encodeURIComponent(code) + "?host=" + encodeURIComponent(HOST))
    .then(function (answer) { return answer.ok ? answer.json() : Promise.reject(answer.status); })
    .then(function (config) {
      if (document.body) build(config);
      else document.addEventListener("DOMContentLoaded", function () { build(config); });
    })
    .catch(function (status) { console.warn("[assistant] " + code + " is not available here (" + status + ")."); });
})();
`;
}

/** Serves the loader to any origin, uncached, with this deployment's `APP_URL` as the platform origin. */
export async function GET() {
  // Read on each request: prerendered at build, the origin would be the build's, not the deployment's.
  await connection();
  const origin = (env().APP_URL ?? "").replace(/\/$/, "");
  return new Response(loader(origin), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
