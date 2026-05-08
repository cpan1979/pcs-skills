// Tiny hash-based router.
// Routes are registered as { pattern, handler } where pattern is a string
// containing optional :params (e.g. "/cert/:id"). Handler receives the
// matched params object and the raw path.

const routes = [];
let notFound = null;

export function on(pattern, handler) {
  const keys = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$"
  );
  routes.push({ re, keys, handler, pattern });
}

export function setNotFound(handler) { notFound = handler; }

export function navigate(path, replace = false) {
  const target = "#" + (path.startsWith("/") ? path : "/" + path);
  if (replace) location.replace(target);
  else location.hash = target.slice(1);
}

export function start() {
  window.addEventListener("hashchange", dispatch);
  dispatch();
}

function dispatch() {
  const hash = location.hash.replace(/^#/, "") || "/certs";
  for (const { re, keys, handler } of routes) {
    const m = hash.match(re);
    if (m) {
      const params = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      handler(params, hash);
      updateNavActive(hash);
      // Reset focus and scroll
      window.scrollTo({ top: 0, behavior: "instant" });
      const main = document.getElementById("main");
      if (main) main.focus({ preventScroll: true });
      return;
    }
  }
  if (notFound) notFound(hash);
}

function updateNavActive(hash) {
  document.querySelectorAll(".primary-nav a").forEach((a) => {
    const route = a.dataset.route;
    let active = false;
    if (route === "certs" && (hash === "/certs" || hash.startsWith("/cert/"))) active = true;
    if (route === "designations" && (hash === "/designations" || hash.startsWith("/designation/"))) active = true;
    if (route === "about" && hash === "/about") active = true;
    a.classList.toggle("is-active", active);
  });
}

export function currentPath() { return location.hash.replace(/^#/, "") || "/certs"; }
