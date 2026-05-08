// Single cert detail view (/cert/:id)
import { store } from "../store.js";
import { el, clear, setTitle } from "../util.js";

export function render(root, params) {
  const cert = store.certificationsById.get(params.id);
  if (!cert) {
    setTitle("Not found");
    clear(root);
    root.append(el("div", { class: "errorbox", text: `Unknown certification id: ${params.id}` }));
    return;
  }

  setTitle(cert.name);
  clear(root);
  root.append(buildLayout(cert));

  // Re-render on track change.
  const handler = () => {
    clear(root);
    root.append(buildLayout(cert));
  };
  store.addEventListener("track-change", handler, { once: true });
}

function buildLayout(cert) {
  const wrap = el("div", { class: "detail" });
  wrap.append(buildMain(cert), buildRail(cert));
  return wrap;
}

function buildMain(cert) {
  const main = el("div", { class: "detail-main" });
  main.append(
    el("nav", { class: "breadcrumb", "aria-label": "Breadcrumb" },
      el("a", { href: "#/certs", text: "Certifications" }),
      el("span", { class: "sep", text: "›" }),
      el("span", { text: cert.name })
    ),
    el("h1", { class: "detail-title", text: cert.name })
  );

  const badges = el("div", { class: "detail-badges" });
  badges.append(el("span", { class: "badge", "data-tone": levelTone(cert.level), text: cert.level }));
  if (cert.learnUrl) {
    badges.append(el("a", {
      class: "badge", "data-tone": "accent", href: cert.learnUrl, target: "_blank", rel: "noopener",
      text: "View on Microsoft Learn ↗"
    }));
  }
  main.append(badges);

  if (cert.retirementNote) {
    main.append(el("div", { class: "callout", "data-tone": "warn", text: cert.retirementNote }));
  }

  // Prerequisites
  if (cert.prerequisites && cert.prerequisites.length) {
    main.append(el("div", { class: "callout" },
      el("div", {},
        el("strong", { text: "Prerequisites: " }),
        document.createTextNode(cert.prerequisites.join("; ")),
        el("br"),
        el("small", { text: "Always confirm prerequisites on the credential's Microsoft Learn page before starting." })
      )
    ));
  }

  // Designation blocks
  const apps = store.applicationsFor(cert.id);
  if (apps.length === 0) {
    main.append(el("p", { class: "detail-lead", text: "This certification doesn't currently count toward any Solutions Partner designation." }));
  } else {
    main.append(el("h2", { text: "Where this certification counts", style: "font-size: 22px; margin-top: 24px;" }));
    for (const { designation, applies } of apps) {
      main.append(buildDesignationBlock(designation, applies));
    }
  }

  return main;
}

function buildDesignationBlock(designation, applies) {
  const t = store.track;
  const tInfo = applies.tracks?.[t] || {};
  const block = el("article", { class: "des-block", style: `--c: var(--d-${designation.id})` });

  const head = el("header", { class: "des-block-head" },
    el("span", { class: "badge", style: `background: var(--d-${designation.id}); color: #fff; border-color: transparent;`, text: designation.shortName || designation.name }),
    el("h3", {}, el("a", { href: `#/designation/${designation.id}`, text: designation.name }))
  );
  block.append(head);

  const metaBadges = el("div", { class: "detail-badges", style: "margin: 0 0 12px;" });
  metaBadges.append(el("span", { class: "badge", "data-tone": "accent", text: applies.metric === "intermediate" ? "Intermediate cert" : "Advanced cert" }));
  metaBadges.append(el("span", { class: "badge", text: roleLabel(applies.role) }));
  metaBadges.append(el("span", { class: "badge", "data-tone": t === "smb" ? "info" : "success", text: t === "smb" ? "SMB track" : "Enterprise track" }));
  block.append(metaBadges);

  // Points display
  if (typeof tInfo.pointsValue === "number") {
    const ptsRow = el("div", { class: "points-row" });
    if (tInfo.pointsValue === 0) {
      ptsRow.append(el("span", { class: "num", text: "Gating" }));
      ptsRow.append(el("span", { class: "unit", text: "no points awarded directly" }));
    } else {
      ptsRow.append(el("span", { class: "num", text: formatPts(tInfo.pointsValue) }));
      ptsRow.append(el("span", { class: "unit", text: "pts / certified person" }));
    }
    block.append(ptsRow);
  }
  if (tInfo.pointsRule) {
    block.append(el("p", { class: "points-rule", text: tInfo.pointsRule }));
  }

  // Step diagram if step gating applies
  if (designation.skillingHasStepGating && (applies.role.startsWith("step") || applies.role === "step3-elective")) {
    block.append(buildStepDiagram(designation, applies, t));
  }

  if (applies.notes) {
    block.append(el("div", { class: "callout", text: applies.notes, style: "margin-top: 12px;" }));
  }

  return block;
}

function buildStepDiagram(designation, applies, track) {
  const max = stepMax(designation, applies.metric);
  const current = applies.tracks?.[track]?.step;

  const grid = el("div", { class: "step-diagram", "aria-label": "Step requirement order" });
  for (let i = 1; i <= max; i++) {
    const step = el("div", { class: "step" + (i === current ? " is-current" : "") },
      el("span", { class: "label", text: `Step ${i}` }),
      el("span", { text: stepDescription(designation, applies.metric, i, track) })
    );
    grid.append(step);
  }
  return grid;
}

function stepMax(designation, metric) {
  // Data & AI / Security have a 3-step intermediate gating sequence;
  // Infrastructure & Digital & App Innovation have 2-step sequences.
  if ((designation.id === "data-ai" || designation.id === "security") && metric === "intermediate") return 3;
  return 2;
}

function stepDescription(designation, metric, step, track) {
  const isSMB = track === "smb";
  if (designation.id === "data-ai" && metric === "intermediate") {
    if (step === 1) return isSMB ? "Azure Administrator (4 pts)" : "Azure Administrator (gate × 2)";
    if (step === 2) return isSMB ? "Azure Architect (4 pts)" : "Azure Solutions Architect (gate × 2)";
    return "Elective Data & AI cert (4 pts/person)";
  }
  if (designation.id === "security" && metric === "intermediate") {
    if (step === 1) return isSMB ? "Azure Security (4 pts)" : "Azure Security (gate × 2)";
    if (step === 2) return isSMB ? "Sec Ops Analyst (4 pts)" : "Sec Ops Analyst (gate × 2)";
    return isSMB ? "Elective security cert (8 pts/person)" : "Elective security cert (6.67 pts/person)";
  }
  if (designation.id === "infrastructure" && metric === "intermediate") {
    if (step === 1) return isSMB ? "Azure Administrator (4 pts)" : "Azure Administrator (gate × 2)";
    return "Elective infra cert (4 pts/person)";
  }
  if (designation.id === "infrastructure" && metric === "advanced") {
    if (step === 1) return isSMB ? "Azure Architect (4 pts)" : "Azure Solutions Architect (gate × 2)";
    return "Elective infra cert (4 pts/person)";
  }
  if (designation.id === "digital-app-innovation" && metric === "intermediate") {
    if (step === 1) return isSMB ? "Azure Administrator (4 pts)" : "Azure Administrator (gate × 2)";
    return "Azure Dev / Power Platform Dev (4 pts/person)";
  }
  if (designation.id === "digital-app-innovation" && metric === "advanced") {
    if (step === 1) return isSMB ? "Azure Architect (4 pts)" : "Azure Solutions Architect (gate × 2)";
    return "Azure DevOps / Power Platform / GitHub (4 pts/person)";
  }
  return `Step ${step}`;
}

function buildRail(cert) {
  const rail = el("aside", { class: "detail-rail", "aria-label": "Quick info" });

  // Designation-coverage card
  const coverageCard = el("section", { class: "rail-card" },
    el("h4", { text: "Counts toward" })
  );
  const ul = el("ul");
  const seen = new Set();
  for (const a of cert.appliesTo) {
    if (seen.has(a.designation)) continue;
    seen.add(a.designation);
    const d = store.designationsById.get(a.designation);
    if (!d) continue;
    ul.append(el("li", {}, el("a", { href: `#/designation/${d.id}`, text: d.name })));
  }
  coverageCard.append(ul);
  rail.append(coverageCard);

  // Related certs (sharing at least one designation+metric)
  const myKeys = new Set(cert.appliesTo.map((a) => `${a.designation}:${a.metric}`));
  const related = store.certifications.filter((c) =>
    c.id !== cert.id && c.appliesTo.some((a) => myKeys.has(`${a.designation}:${a.metric}`))
  ).slice(0, 8);
  if (related.length) {
    const card = el("section", { class: "rail-card" },
      el("h4", { text: "Related certifications" })
    );
    const list = el("ul");
    for (const r of related) {
      list.append(el("li", {}, el("a", { href: `#/cert/${r.id}`, text: r.name })));
    }
    card.append(list);
    rail.append(card);
  }

  return rail;
}

function levelTone(level) {
  switch (level) {
    case "Fundamentals": return "info";
    case "Associate":    return "accent";
    case "Specialty":    return "warn";
    case "Expert":       return "danger";
    default:             return null;
  }
}

function roleLabel(role) {
  switch (role) {
    case "step1-required":   return "Step 1 (required)";
    case "step2-required":   return "Step 2 (required)";
    case "step2-elective":   return "Step 2 elective";
    case "step3-elective":   return "Step 3 elective";
    case "intermediate-pool":return "Intermediate pool";
    case "advanced-pool":    return "Advanced pool";
    default: return role;
  }
}

function formatPts(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
