// Designations index view (/designations)
import { store } from "../store.js";
import { el, clear, setTitle } from "../util.js";

export function render(root) {
  setTitle("Solutions Partner designations");
  clear(root);

  const hero = el("section", { class: "hero" },
    el("h1", { text: "Solutions Partner designations" }),
    el("p", { class: "hero-lead",
      text: "Six designations across the Microsoft Cloud. Pick one to see its scoring envelope, classification rules, and the certifications that count toward its Skilling category." })
  );
  root.append(hero);

  const grid = el("div", { class: "designation-grid" });
  for (const d of store.designations) {
    const tInfo = pickTrackPoints(d);
    const card = el("a", {
      class: "designation-card",
      href: `#/designation/${d.id}`,
      style: `--c: var(--d-${d.id})`
    },
      el("span", { class: "badge", style: `background: var(--d-${d.id}); color: #fff; border-color: transparent; align-self: flex-start;`, text: d.shortName || d.name }),
      el("h3", { text: d.name }),
      el("p", { text: d.tagline || "" }),
      el("div", { class: "meta-row" },
        el("span", { text: `${countSkillingCerts(d.id)} certifications` }),
        el("span", { text: tInfo })
      )
    );
    grid.append(card);
  }
  root.append(grid);

  store.addEventListener("track-change", () => render(root), { once: true });
}

function countSkillingCerts(designationId) {
  const ids = new Set();
  for (const c of store.certifications) {
    for (const a of c.appliesTo) if (a.designation === designationId) ids.add(c.id);
  }
  return ids.size;
}

function pickTrackPoints(designation) {
  const t = store.track;
  const skilling = designation.categories.find((c) => c.id === "skilling");
  if (!skilling) return "";
  return `Skilling cap: ${skilling.max} pts`;
}
