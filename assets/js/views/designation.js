// Designation detail view (/designation/:id)
import { store } from "../store.js";
import { el, clear, setTitle } from "../util.js";

export function render(root, params) {
  const designation = store.designationsById.get(params.id);
  if (!designation) {
    setTitle("Not found");
    clear(root);
    root.append(el("div", { class: "errorbox", text: `Unknown designation id: ${params.id}` }));
    return;
  }

  setTitle(designation.name);
  clear(root);
  root.append(buildLayout(designation));

  store.addEventListener("track-change", () => render(root, params), { once: true });
}

function buildLayout(designation) {
  const wrap = el("div", { class: "detail" });
  wrap.append(buildMain(designation), buildRail(designation));
  return wrap;
}

function buildMain(designation) {
  const t = store.track;
  const main = el("div", { class: "detail-main" });

  main.append(
    el("nav", { class: "breadcrumb", "aria-label": "Breadcrumb" },
      el("a", { href: "#/designations", text: "Designations" }),
      el("span", { class: "sep", text: "›" }),
      el("span", { text: designation.name })
    ),
    el("h1", { class: "detail-title", text: `Solutions Partner for ${designation.name}` }),
    el("p", { class: "detail-lead", text: designation.tagline || "" })
  );

  const badges = el("div", { class: "detail-badges" });
  badges.append(el("span", { class: "badge", "data-tone": t === "smb" ? "info" : "success", text: t === "smb" ? "SMB track" : "Enterprise track" }));
  badges.append(el("a", { class: "badge", "data-tone": "accent", href: designation.sourceUrl, target: "_blank", rel: "noopener", text: "Source on Microsoft Learn ↗" }));
  main.append(badges);

  // Classification callout
  main.append(el("div", { class: "callout" },
    el("div", {},
      el("strong", { text: "Track classification: " }),
      document.createTextNode(designation.classification)
    )
  ));

  // Scorecard — focused on Skilling
  const skilling = designation.categories.find((c) => c.id === "skilling");
  main.append(el("h2", { text: "Skilling at a glance", style: "font-size: 22px; margin-top: 24px;" }));
  const scorecard = el("div", { class: "scorecard" });
  scorecard.append(el("div", { class: "score-cell", style: `--c: var(--d-${designation.id})` },
    el("div", { class: "label", text: "Min to qualify" }),
    el("div", { class: "num", text: String(designation.minQualifyingScore) }),
    el("div", { class: "sub", text: `out of ${designation.maxScore} possible (overall PCS)` })
  ));
  if (skilling) {
    scorecard.append(el("div", { class: "score-cell", style: `--c: var(--d-${designation.id})` },
      el("div", { class: "label", text: "Skilling cap" }),
      el("div", { class: "num", text: String(skilling.max) }),
      el("div", { class: "sub", text: `${skilling.metrics.length} skilling metric${skilling.metrics.length === 1 ? "" : "s"}` })
    ));
    for (const metric of skilling.metrics) {
      scorecard.append(el("div", { class: "score-cell", style: `--c: var(--d-${designation.id})` },
        el("div", { class: "label", text: metric.name }),
        el("div", { class: "num", text: String(metric.max) }),
        el("div", { class: "sub", text: "pts max" })
      ));
    }
  }
  main.append(scorecard);

  // Skilling certifications — the focus of this site
  main.append(el("h2", { text: "Eligible certifications", style: "font-size: 22px; margin-top: 24px;" }));
  if (designation.skillingNotes) {
    main.append(el("div", { class: "callout", text: designation.skillingNotes }));
  }

  if (skilling) {
    for (const metric of skilling.metrics) {
      main.append(buildMetricSection(designation, metric));
    }
  }

  return main;
}

function buildMetricSection(designation, metric) {
  const t = store.track;
  const block = el("article", { class: "step-section" });
  block.append(el("h3", { text: `${metric.name} — ${metric.max} pts max` }));
  block.append(el("p", { class: "scoring", text: scoringText(metric) }));

  // Group certs by role for this designation+metric
  const all = store.certsForDesignation(designation.id).filter((x) => x.applies.metric === metric.id);
  const byRole = new Map();
  for (const item of all) {
    const r = item.applies.role;
    if (!byRole.has(r)) byRole.set(r, []);
    byRole.get(r).push(item);
  }

  // Render in the order steps logically appear.
  const ROLE_ORDER = ["step1-required", "step2-required", "step2-elective", "step3-elective", "intermediate-pool", "advanced-pool"];
  for (const role of ROLE_ORDER) {
    const items = byRole.get(role);
    if (!items || items.length === 0) continue;
    block.append(el("h4", { text: roleHeading(role, designation, metric, t), style: "margin: 16px 0 6px; font-size: 14px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em;" }));
    const list = el("ul", { class: "cert-list" });
    for (const { cert, applies } of items) {
      const tInfo = applies.tracks?.[t] || {};
      const label = ptsLabel(tInfo);
      const li = el("li", {},
        el("a", { href: `#/cert/${cert.id}`, text: cert.name }),
        label ? el("span", { class: "meta", text: label }) : null
      );
      list.append(li);
    }
    block.append(list);
  }

  if (all.length === 0) {
    block.append(el("p", { class: "empty", style: "padding: 24px;",
      text: "No certifications currently count toward this metric." }));
  }

  return block;
}

function roleHeading(role, designation, metric, track) {
  const isSMB = track === "smb";
  switch (role) {
    case "step1-required":
      return isSMB ? "Step 1 (required) — 4 pts cap" : "Step 1 (required) — gating only, 2 people";
    case "step2-required":
      return isSMB ? "Step 2 (required) — 4 pts cap" : "Step 2 (required) — gating only, 2 people";
    case "step2-elective":
      return "Step 2 — elective certifications";
    case "step3-elective":
      return "Step 3 — elective certifications";
    case "intermediate-pool":
      return "Eligible Intermediate certifications";
    case "advanced-pool":
      return "Eligible Advanced certifications";
    default: return role;
  }
}

function scoringText(metric) {
  if (typeof metric.scoring === "string") return metric.scoring;
  if (metric.scoring && typeof metric.scoring === "object") {
    const t = store.track;
    return metric.scoring[t] || metric.scoring.enterprise || "";
  }
  return "";
}

function ptsLabel(tInfo) {
  if (typeof tInfo.pointsValue === "number") {
    if (tInfo.pointsValue === 0) return "Gating only";
    return `${formatPts(tInfo.pointsValue)} pts/person`;
  }
  return "";
}

function buildRail(designation) {
  const rail = el("aside", { class: "detail-rail", "aria-label": "Designation summary" });

  // Cert count card
  const certs = store.certsForDesignation(designation.id);
  const uniqueCertIds = new Set(certs.map((x) => x.cert.id));
  const intermediateCount = new Set(certs.filter((x) => x.applies.metric === "intermediate").map((x) => x.cert.id)).size;
  const advancedCount = new Set(certs.filter((x) => x.applies.metric === "advanced").map((x) => x.cert.id)).size;

  const statsCard = el("section", { class: "rail-card" },
    el("h4", { text: "Eligible certifications" })
  );
  const statsList = el("ul");
  statsList.append(el("li", { text: `${uniqueCertIds.size} total` }));
  if (intermediateCount > 0) statsList.append(el("li", { text: `${intermediateCount} intermediate` }));
  if (advancedCount > 0) statsList.append(el("li", { text: `${advancedCount} advanced` }));
  statsCard.append(statsList);
  rail.append(statsCard);

  const otherCard = el("section", { class: "rail-card" },
    el("h4", { text: "Other designations" })
  );
  const list = el("ul");
  for (const d of store.designations) {
    if (d.id === designation.id) continue;
    list.append(el("li", {}, el("a", { href: `#/designation/${d.id}`, text: d.name })));
  }
  otherCard.append(list);
  rail.append(otherCard);

  return rail;
}

function formatPts(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
