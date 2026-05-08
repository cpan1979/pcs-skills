// Cert grid view (/certs)
import { store } from "../store.js";
import { el, clear, setTitle, escapeHtml } from "../util.js";

const STATE = {
  query: "",
  designationFilter: new Set(), // empty = show all
  levelFilter: new Set()
};

const LEVELS = ["Fundamentals", "Associate", "Specialty", "Expert", "Applied Skills"];

export function render(root) {
  setTitle("Certifications");
  clear(root);

  root.append(buildHero());
  const sectionHead = el("div", { class: "section-head" },
    el("h2", { text: "All certifications" }),
    el("span", { class: "count", id: "cert-count" })
  );
  root.append(sectionHead);

  const grid = el("div", { class: "cert-grid", id: "cert-grid" });
  root.append(grid);

  paint();

  // Listen for track changes so cards refresh their per-track summaries.
  store.addEventListener("track-change", paint);
}

function buildHero() {
  const hero = el("section", { class: "hero" });
  hero.append(
    el("h1", { text: "Find the right certifications for your designation." }),
    el("p", { class: "hero-lead",
      text: "A certification-centric guide to the Microsoft Partner Capability Score (PCS). Toggle SMB or Enterprise in the header — point values, gating callouts, and thresholds update everywhere on the page." })
  );

  const controls = el("div", { class: "hero-controls" });
  const search = el("div", { class: "search" },
    el("input", {
      type: "search",
      placeholder: "Search certifications by name…",
      "aria-label": "Search certifications",
      value: STATE.query,
      oninput: (e) => { STATE.query = e.target.value; paint(); }
    })
  );
  controls.append(search);
  hero.append(controls);

  const desRow = el("div", { class: "chip-row", "aria-label": "Filter by designation" });
  for (const d of store.designations) {
    const chip = el("button", {
      type: "button",
      class: "chip",
      "aria-pressed": "false",
      onclick: () => {
        if (STATE.designationFilter.has(d.id)) STATE.designationFilter.delete(d.id);
        else STATE.designationFilter.add(d.id);
        chip.classList.toggle("is-active", STATE.designationFilter.has(d.id));
        chip.setAttribute("aria-pressed", String(STATE.designationFilter.has(d.id)));
        paint();
      }
    },
      el("span", { class: "dot", style: `--c: var(--d-${d.id})` }),
      d.shortName || d.name
    );
    desRow.append(chip);
  }
  hero.append(desRow);

  const levelRow = el("div", { class: "chip-row", "aria-label": "Filter by level" });
  for (const lvl of LEVELS) {
    const chip = el("button", {
      type: "button",
      class: "chip",
      "aria-pressed": "false",
      onclick: () => {
        if (STATE.levelFilter.has(lvl)) STATE.levelFilter.delete(lvl);
        else STATE.levelFilter.add(lvl);
        chip.classList.toggle("is-active", STATE.levelFilter.has(lvl));
        chip.setAttribute("aria-pressed", String(STATE.levelFilter.has(lvl)));
        paint();
      }
    }, lvl);
    levelRow.append(chip);
  }
  hero.append(levelRow);

  return hero;
}

function paint() {
  const grid = document.getElementById("cert-grid");
  const count = document.getElementById("cert-count");
  if (!grid || !count) return;
  clear(grid);

  const q = STATE.query.trim().toLowerCase();
  const desFilter = STATE.designationFilter;
  const lvlFilter = STATE.levelFilter;

  const matches = store.certifications.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (lvlFilter.size && !lvlFilter.has(c.level)) return false;
    if (desFilter.size) {
      const ids = new Set(c.appliesTo.map((a) => a.designation));
      let has = false;
      for (const d of desFilter) if (ids.has(d)) { has = true; break; }
      if (!has) return false;
    }
    return true;
  });

  count.textContent = `${matches.length} certification${matches.length === 1 ? "" : "s"}`;

  if (matches.length === 0) {
    grid.append(el("div", { class: "empty",
      text: "No certifications match your filters. Try clearing some chips or your search query." }));
    return;
  }

  for (const cert of matches) grid.append(buildCard(cert));
}

function buildCard(cert) {
  const designations = store.designations;
  const appliedIds = new Set(cert.appliesTo.map((a) => a.designation));

  const card = el("a", {
    class: "cert-card",
    href: `#/cert/${encodeURIComponent(cert.id)}`,
    "aria-label": `${cert.name} — view details`
  });
  card.append(
    el("header", { class: "cert-card-head" },
      el("span", { class: "cert-level", "data-level": cert.level, text: cert.level }),
      el("h3", { class: "cert-name", text: cert.name })
    )
  );

  const coverage = el("div", { class: "cert-coverage" });
  for (const d of designations) {
    if (!appliedIds.has(d.id)) continue;
    coverage.append(
      el("span", { class: "coverage-pip", title: d.name },
        el("span", { class: "dot", style: `background: var(--d-${d.id})` }),
        d.shortName || d.name
      )
    );
  }
  card.append(coverage);

  // Summary: pick the most informative pointsRule for the active track.
  const summary = pickSummary(cert);
  card.append(el("p", { class: "cert-summary", text: summary }));

  card.append(
    el("footer", { class: "cert-card-foot" },
      el("span", { class: "cert-points", text: pickPointsLabel(cert) }),
      el("span", { class: "cert-cta", text: "View details →" })
    )
  );

  return card;
}

function pickSummary(cert) {
  // Prefer a Step 3/elective rule for the active track if any; else first applies entry.
  const t = store.track;
  const apps = cert.appliesTo;
  const elective = apps.find((a) => a.role === "step3-elective" || a.role === "step2-elective" ||
                                    a.role === "intermediate-pool" || a.role === "advanced-pool");
  const chosen = elective || apps[0];
  if (!chosen) return "";
  return chosen.tracks?.[t]?.pointsRule || chosen.tracks?.enterprise?.pointsRule || "";
}

function pickPointsLabel(cert) {
  const t = store.track;
  const numeric = cert.appliesTo
    .map((a) => a.tracks?.[t]?.pointsValue)
    .filter((v) => typeof v === "number" && v > 0);
  if (numeric.length === 0) return "Variable";
  const max = Math.max(...numeric);
  const min = Math.min(...numeric);
  if (max === min) return `${formatPts(max)} pt${max === 1 ? "" : "s"} / person`;
  return `${formatPts(min)}–${formatPts(max)} pts / person`;
}

function formatPts(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
