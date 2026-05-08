// Static About view (/about)
import { store } from "../store.js";
import { el, clear, setTitle, formatDate } from "../util.js";

export function render(root) {
  setTitle("About");
  clear(root);

  const meta = store.meta || {};
  const wrap = el("section", { class: "prose" },
    el("h1", { class: "detail-title", text: "About this site" }),
    el("p", { class: "detail-lead",
      text: "An unofficial, certification-centric guide to the Microsoft Partner Capability Score (PCS) for Solutions Partner designations. The site is open source and continuously reconciled against Microsoft Learn." }),

    el("h2", { text: "How it works" }),
    el("ul", {},
      el("li", { text: "All content is sourced from four pages on Microsoft Learn (linked in the footer). Whenever those pages change in a meaningful way, a GitHub Actions workflow opens an issue with the diff and assigns it to a coding agent for reconciliation." }),
      el("li", { text: "Toggle SMB or Enterprise in the header at any time. Point values, gating callouts, and threshold tables update everywhere on the page; your preference is remembered." }),
      el("li", { text: "Each certification has a detail page that lists every Solutions Partner designation it counts toward, along with the per-track scoring rules and any prerequisites." }),
      el("li", { text: "Each designation has a page showing the scoring envelope, classification criteria, and the certifications that count toward its Skilling category, organized by Step or pool." })
    ),

    el("h2", { text: "Source pages" }),
    el("ul", {},
      ...(meta.sources || []).map((s) =>
        el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.url }))
      )
    ),

    el("h2", { text: "Data freshness" }),
    el("p", {
      text: `Last automated check against Microsoft Learn: ${formatDate(meta.lastChecked)}. Last reconciled source change: ${formatDate(meta.lastSourceUpdate)}.`
    }),

    el("h2", { text: "Disclaimer" }),
    el("p", {
      text: "This is a community-maintained navigation aid; it is not produced by Microsoft. Always verify scoring details on Microsoft Learn and in Partner Center before making business or training-investment decisions."
    })
  );

  root.append(wrap);
}
