// Entry point: load data, mount router, wire global UI.
import { store } from "./store.js";
import { on, setNotFound, start, navigate, currentPath } from "./router.js";
import { $, $$, el, clear, formatDate } from "./util.js";

import * as certsView from "./views/certs.js";
import * as certView from "./views/cert.js";
import * as designationsView from "./views/designations.js";
import * as designationView from "./views/designation.js";
import * as aboutView from "./views/about.js";

const root = document.getElementById("view-root");

bootstrap();

async function bootstrap() {
  showLoading();

  store.addEventListener("error", (e) => showError(e.detail));
  store.addEventListener("loaded", () => mount());

  await store.load();

  // Track toggle wiring
  $$(".track-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.track === store.track);
    btn.setAttribute("aria-pressed", String(btn.dataset.track === store.track));
    btn.addEventListener("click", () => store.setTrack(btn.dataset.track));
  });
  store.addEventListener("track-change", (e) => {
    $$(".track-btn").forEach((b) => {
      const active = b.dataset.track === e.detail;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", String(active));
    });
  });

  // Footer meta
  const lc = document.getElementById("last-checked");
  const lu = document.getElementById("last-update");
  if (lc && store.meta) lc.textContent = `Last checked: ${formatDate(store.meta.lastChecked)}`;
  if (lu && store.meta) lu.textContent = `Last source update: ${formatDate(store.meta.lastSourceUpdate)}`;
}

function mount() {
  on("/certs", () => certsView.render(root));
  on("/cert/:id", (params) => certView.render(root, params));
  on("/designations", () => designationsView.render(root));
  on("/designation/:id", (params) => designationView.render(root, params));
  on("/about", () => aboutView.render(root));
  setNotFound(() => {
    clear(root);
    root.append(el("div", { class: "errorbox", text: "Page not found." }));
  });
  start();
}

function showLoading() {
  clear(root);
  root.append(el("div", { class: "loading", text: "Loading certification data…" }));
}

function showError(err) {
  clear(root);
  root.append(el("div", { class: "errorbox" },
    el("p", { text: "We couldn’t load the certification data." }),
    el("p", {}, el("small", { text: String(err && err.message ? err.message : err) }))
  ));
}
