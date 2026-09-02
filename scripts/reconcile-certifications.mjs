#!/usr/bin/env node
// Reconciles data/certifications.json against the live content of the four
// Microsoft Learn Solutions Partner pages, WITHOUT any AI/manual step.
//
// Scope (deliberately narrow): this only touches the *elective/pool*
// certification lists — the parts of each page that grow or change over
// time (e.g. "Step 3: Other certifications", "Eligibility for Intermediate
// certifications metric"). It never touches the one-off *required/gating*
// certifications (e.g. "Azure Administrator Associate" as a Step 1
// requirement) — those are stated in prose, not as a list, are effectively
// static, and are too risky to auto-parse from freeform sentences.
//
// Each of the four pages formats its elective lists completely differently
// (flat lists, nested lists, step-numbered H4 headings, plain bullets under
// bold pseudo-headings). BLOCKS below encodes one extractor per section,
// by hand, based on the current page structure. If Microsoft changes a
// page's structure enough that a block's marker no longer matches, that
// block silently finds zero items — see the report's "no data extracted"
// warnings, which call this out instead of failing silently forever.
//
// Output: patches data/certifications.json in place (new cert entries,
// and safe in-place renames when a cert is matched by learnUrl slug), and
// writes .tmp/reconcile-report.md summarizing what changed. Exits with
// code 0 always; the workflow decides whether to open a PR based on
// whether git sees a diff.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES, fetchNormalizedMarkdown } from "./lib/learn-source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const DATA_DIR = path.join(root, "data");
const TMP_DIR = path.join(root, ".tmp");

// ---------------------------------------------------------------------------
// Generic markdown block extraction helpers
// ---------------------------------------------------------------------------

function headingLevel(line) {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : null;
}

// Returns the text from the first line matching startRegex up to (but not
// including) the next heading whose level is <= the matched heading's level.
// If startRegex doesn't match a heading line, returns null.
function sliceSection(text, startRegex) {
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => startRegex.test(l));
  if (startIdx === -1) return null;
  const level = headingLevel(lines[startIdx]);
  if (level == null) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl != null && lvl <= level) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

// Returns ALL sections whose heading matches startRegex (there can be more
// than one, e.g. an "Enterprise" and an "SMB" copy of the same step).
function sliceAllSections(text, startRegex) {
  const lines = text.split("\n");
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    if (!startRegex.test(lines[i])) continue;
    const level = headingLevel(lines[i]);
    if (level == null) continue;
    let endIdx = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const lvl = headingLevel(lines[j]);
      if (lvl != null && lvl <= level) { endIdx = j; break; }
    }
    sections.push(lines.slice(i, endIdx).join("\n"));
  }
  return sections;
}

// Finds markerRegex (a plain line, not necessarily a heading), then collects
// the bullet list that follows it (possibly nested/indented, possibly
// separated by blank lines), stopping at the first non-bullet, non-blank
// line once at least one bullet has been collected, or at a heading.
//
// If the marker line is itself a bullet (e.g. "-   Certified individuals
// ... must complete at least one of the following certifications:"), only
// bullets indented MORE than the marker count as list items — a sibling
// bullet at the same or shallower indent (e.g. a trailing "Each certified
// individual adds N points..." bullet) ends the list instead of being
// swallowed as an item.
function bulletListAfter(text, markerRegex) {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => markerRegex.test(l));
  if (idx === -1) return null;

  const markerIsBullet = /^\s*-\s+/.test(lines[idx]);
  const markerIndent = markerIsBullet ? lines[idx].match(/^(\s*)-/)[1].length : -1;

  const items = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      if (markerIndent >= 0 && indent <= markerIndent) break; // sibling/uncle bullet — list ended
      items.push(bulletMatch[2].trim());
      continue;
    }
    if (line.trim() === "") continue;
    if (/^#{1,6}\s/.test(line)) break;
    if (items.length > 0) break;
  }
  return items;
}

// Parses one bullet item into { name, url }. Handles:
//   [Display Name](url)  and trailing footnote markers (*, **, ***, #)
//   Plain "Display Name" text with the same footnote markers
function parseItem(raw) {
  const linkMatch = raw.match(/^\[([^\]]+)\]\(([^)]+)\)/);
  let name, url = null;
  if (linkMatch) {
    name = linkMatch[1];
    url = linkMatch[2];
  } else {
    name = raw;
  }
  name = name
    .replace(/^Microsoft Certified:\s*/i, "")
    .replace(/^Microsoft 365 Certified:\s*/i, "")
    .replace(/\s*\(previously known as[^)]*\)/i, "")
    .replace(/[\\*#]+\s*$/g, "")
    .trim();
  return { name, url };
}

function slugFromUrl(url) {
  if (!url) return null;
  const withoutQuery = url.split("?")[0];
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments.length ? segments[segments.length - 1].toLowerCase() : null;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferLevel(name) {
  if (/fundamentals$/i.test(name)) return "Fundamentals";
  if (/specialty$/i.test(name)) return "Specialty";
  if (/expert$/i.test(name)) return "Expert";
  if (/applied skills$/i.test(name)) return "Applied Skills";
  return "Associate";
}

// ---------------------------------------------------------------------------
// Per-source block definitions: which (designation, metric, role) each
// section of each page maps to. Only elective/pool lists are covered — see
// the file header for why required/gating steps are excluded.
// ---------------------------------------------------------------------------

const ELECTIVE_INTRO = /Certified individuals.*must complete at least one of the following certifications:/i;

function extractAzureBlocks(md) {
  const out = [];
  const intermediateSection = sliceSection(md, /^### Intermediate certifications$/);
  const advancedSection = sliceSection(md, /^### Advanced certifications$/);

  const push = (section, headingRegex, designation, metric, role) => {
    if (!section) return;
    const sub = sliceSection(section, headingRegex);
    if (!sub) return;
    const items = bulletListAfter(sub, ELECTIVE_INTRO) || [];
    out.push({ designation, metric, role, items: items.map(parseItem) });
  };

  push(intermediateSection, /^#### Data & AI$/, "data-ai", "intermediate", "step3-elective");
  push(intermediateSection, /^#### Digital & App Innovation$/, "digital-app-innovation", "intermediate", "step2-elective");
  push(intermediateSection, /^#### Infrastructure$/, "infrastructure", "intermediate", "step2-elective");
  push(advancedSection, /^#### Digital & App Innovation$/, "digital-app-innovation", "advanced", "step2-elective");
  push(advancedSection, /^#### Infrastructure$/, "infrastructure", "advanced", "step2-elective");
  // Data & AI has no Advanced metric ("Advanced certifications aren't
  // applicable to the Data & AI solution area") — intentionally no block.

  return out;
}

function extractSecurityBlocks(md) {
  const sections = sliceAllSections(md, /^####\s*STEP\s*3\b.*$/i);
  const items = [];
  for (const sec of sections) {
    const found = bulletListAfter(sec, ELECTIVE_INTRO);
    if (found) items.push(...found);
  }
  return [{ designation: "security", metric: "intermediate", role: "step3-elective", items: items.map(parseItem) }];
}

function extractBusinessApplicationsBlocks(md) {
  const out = [];
  const intermediate = bulletListAfter(md, /^#### Eligibility for Intermediate certifications metric$/);
  if (intermediate) out.push({ designation: "business-applications", metric: "intermediate", role: "intermediate-pool", items: intermediate.map(parseItem) });
  const advanced = bulletListAfter(md, /^#### Eligibility for Advanced certifications metric$/);
  if (advanced) out.push({ designation: "business-applications", metric: "advanced", role: "advanced-pool", items: advanced.map(parseItem) });
  return out;
}

function extractModernWorkBlocks(md) {
  const out = [];
  const intermediate = bulletListAfter(md, /^-\s+Intermediate metric$/);
  if (intermediate) out.push({ designation: "modern-work", metric: "intermediate", role: "intermediate-pool", items: intermediate.map(parseItem) });
  const advanced = bulletListAfter(md, /^-\s+Advanced metric$/);
  if (advanced) out.push({ designation: "modern-work", metric: "advanced", role: "advanced-pool", items: advanced.map(parseItem) });
  return out;
}

const EXTRACTORS = {
  "azure": extractAzureBlocks,
  "security": extractSecurityBlocks,
  "business-applications": extractBusinessApplicationsBlocks,
  "modern-work": extractModernWorkBlocks
};

// ---------------------------------------------------------------------------
// Raw-text output helpers
//
// We never JSON.stringify(certsDoc) back to disk — that reformats every
// line (the file's "tracks" values are hand-formatted single-line objects,
// not what JSON.stringify(..., null, 2) produces) and turns a 10-entry
// change into an 800+ line diff that's unreviewable. Instead we splice
// hand-formatted text for just the new content into specific, located
// positions in the original file text, leaving everything else byte-for-
// byte untouched. Indentation is hardcoded to match this file's existing
// convention (verified against data/certifications.json): cert entries at
// 4 spaces, their properties at 6, appliesTo entries at 8, their
// properties at 10, track values at 12.
// ---------------------------------------------------------------------------

function formatTrackInfo(t) {
  const parts = [];
  if (t.step !== undefined) parts.push(`"step": ${t.step}`);
  if (t.pointsValue !== undefined) parts.push(`"pointsValue": ${JSON.stringify(t.pointsValue)}`);
  if (t.pointsRule !== undefined) parts.push(`"pointsRule": ${JSON.stringify(t.pointsRule)}`);
  return `{ ${parts.join(", ")} }`;
}

function formatAppliesEntry(a, indent) {
  const propIndent = indent + "  ";
  const trackIndent = propIndent + "  ";
  return [
    `${indent}{`,
    `${propIndent}"designation": ${JSON.stringify(a.designation)},`,
    `${propIndent}"metric": ${JSON.stringify(a.metric)},`,
    `${propIndent}"role": ${JSON.stringify(a.role)},`,
    `${propIndent}"tracks": {`,
    `${trackIndent}"enterprise": ${formatTrackInfo(a.tracks.enterprise)},`,
    `${trackIndent}"smb": ${formatTrackInfo(a.tracks.smb)}`,
    `${propIndent}}`,
    `${indent}}`
  ].join("\n");
}

function formatCertEntry(cert, indent) {
  const propIndent = indent + "  ";
  const appliesIndent = propIndent + "  ";
  return [
    `${indent}{`,
    `${propIndent}"id": ${JSON.stringify(cert.id)},`,
    `${propIndent}"name": ${JSON.stringify(cert.name)},`,
    `${propIndent}"level": ${JSON.stringify(cert.level)},`,
    `${propIndent}"learnUrl": ${JSON.stringify(cert.learnUrl)},`,
    `${propIndent}"prerequisites": [],`,
    `${propIndent}"appliesTo": [`,
    cert.appliesTo.map((a) => formatAppliesEntry(a, appliesIndent)).join(",\n"),
    `${propIndent}]`,
    `${indent}}`
  ].join("\n");
}

// Finds the index of the bracket matching the one at openIndex (string-aware,
// handles either {} or []).
function findMatchingClose(text, openIndex) {
  let depth = 0, inString = false, escape = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") { depth--; if (depth === 0) return i; }
  }
  throw new Error("unbalanced brackets in certifications.json");
}

// Inserts formattedItemText as the new last element of the array opening at
// arrayOpenIndex, adding a leading comma if the array already has items.
// eol matches the file's own line ending (detected once, see main()) —
// splicing in "\n" against a CRLF file produces a mixed-EOL file that git
// diffs as if every line changed, so all inserted newlines must match.
function insertIntoArray(text, arrayOpenIndex, formattedItemText, eol) {
  const closeIdx = findMatchingClose(text, arrayOpenIndex);
  const before = text.slice(0, closeIdx);
  const after = text.slice(closeIdx);
  const hasItems = /\S/.test(text.slice(arrayOpenIndex + 1, closeIdx));
  // Split "before" right at the start of the closing bracket's own eol
  // sequence, so that exact original sequence rides untouched into `tail`
  // instead of being reconstructed (which risks dropping the \r of \r\n).
  const lastEolIdx = before.lastIndexOf(eol);
  const head = before.slice(0, lastEolIdx);
  const tail = before.slice(lastEolIdx) + after;
  const itemEol = formattedItemText.replace(/\n/g, eol);
  return `${head}${hasItems ? "," : ""}${eol}${itemEol}${tail}`;
}

function appendAppliesTo(text, certId, entry, eol) {
  const idPos = text.indexOf(`"id": ${JSON.stringify(certId)}`);
  if (idPos === -1) throw new Error(`cert id "${certId}" not found while inserting appliesTo`);
  const appliesKeyPos = text.indexOf('"appliesTo": [', idPos);
  if (appliesKeyPos === -1) throw new Error(`appliesTo array not found for cert "${certId}"`);
  const openBracketPos = text.indexOf("[", appliesKeyPos);
  return insertIntoArray(text, openBracketPos, formatAppliesEntry(entry, "        "), eol);
}

function appendCertification(text, cert, eol) {
  const keyPos = text.indexOf('"certifications": [');
  if (keyPos === -1) throw new Error('"certifications" array not found');
  const openBracketPos = text.indexOf("[", keyPos);
  return insertIntoArray(text, openBracketPos, formatCertEntry(cert, "    "), eol);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

async function readJSON(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

function findSiblingTracks(certs, designation, metric, role) {
  for (const c of certs) {
    const applies = c.appliesTo.find((a) => a.designation === designation && a.metric === metric && a.role === role);
    if (applies) return applies.tracks;
  }
  return null;
}

async function main() {
  const certsPath = path.join(DATA_DIR, "certifications.json");
  const certsDoc = await readJSON(certsPath);
  // certs/existingBySlug are mutated in-memory during matching (to dedupe
  // across sources and to serve as a sibling-tracks source for later
  // items), but are used ONLY for lookups — the file itself is produced by
  // splicing hand-formatted text, never by re-serializing this object.
  const certs = certsDoc.certifications;

  const existingBySlug = new Map();
  for (const c of certs) {
    const slug = slugFromUrl(c.learnUrl);
    if (slug) existingBySlug.set(slug, c);
  }

  const report = { added: [], renamed: [], possibleAliases: [], noDataBlocks: [] };
  const opsNewCerts = [];
  const opsAppliesTo = []; // { certId, entry }

  function ensureAppliesTo(cert, block, sourceId) {
    const has = cert.appliesTo.some((a) => a.designation === block.designation && a.metric === block.metric && a.role === block.role);
    if (has) return;
    const tracks = findSiblingTracks(certs, block.designation, block.metric, block.role);
    if (!tracks) return;
    const entry = { designation: block.designation, metric: block.metric, role: block.role, tracks: JSON.parse(JSON.stringify(tracks)) };
    cert.appliesTo.push(entry); // in-memory only, for dedupe within this run
    opsAppliesTo.push({ certId: cert.id, entry });
    report.added.push(`${cert.name} (${cert.id}) — newly applies to ${sourceId}: ${block.designation}/${block.metric}/${block.role}`);
  }

  for (const source of SOURCES) {
    const extractor = EXTRACTORS[source.id];
    if (!extractor) continue;
    process.stderr.write(`Reconciling ${source.id}…\n`);
    const md = await fetchNormalizedMarkdown(source);
    const blocks = extractor(md);

    for (const block of blocks) {
      if (block.items.length === 0) {
        report.noDataBlocks.push(`${source.id}: ${block.designation}/${block.metric}/${block.role} — no items extracted (page structure may have changed; needs manual look)`);
        continue;
      }

      for (const item of block.items) {
        if (!item.name) continue;
        const slug = slugFromUrl(item.url);

        // 1. Match by learnUrl slug — strongest signal that this is the same
        // credential, so never create a duplicate entry for it. But the
        // page's own display text is inconsistent (casing, whether it
        // includes "Microsoft Certified:", whether it keeps "Associate"),
        // so a name mismatch is reported for a human to apply, never
        // auto-written — auto-renaming here has in practice overwritten a
        // more correct curated name with the page's own inconsistency.
        if (slug && existingBySlug.has(slug)) {
          const existing = existingBySlug.get(slug);
          if (existing.name.toLowerCase() !== item.name.toLowerCase()) {
            report.renamed.push(`"${existing.name}" (${existing.id}) — page now shows "${item.name}" (${source.id}: ${block.designation}/${block.metric}/${block.role}); left untouched, please verify before renaming`);
          }
          ensureAppliesTo(existing, block, source.id);
          continue;
        }

        // 2. Exact case-insensitive name match against existing certs.
        const exact = certs.find((c) => c.name.toLowerCase() === item.name.toLowerCase());
        if (exact) {
          ensureAppliesTo(exact, block, source.id);
          continue;
        }

        // 3. Substring heuristic — likely the same credential referenced by
        // a shortened/alternate name. Report only; never auto-merge or
        // duplicate on a weak signal like this.
        if (item.name.length >= 8) {
          const alias = certs.find((c) =>
            c.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(c.name.toLowerCase())
          );
          if (alias) {
            report.possibleAliases.push(`"${item.name}" (${source.id}: ${block.designation}/${block.metric}/${block.role}) looks like it might be "${alias.name}" (${alias.id}) — left untouched, please verify`);
            continue;
          }
        }

        // 4. Genuinely new certification.
        const tracks = findSiblingTracks(certs, block.designation, block.metric, block.role);
        if (!tracks) {
          report.noDataBlocks.push(`${source.id}: ${block.designation}/${block.metric}/${block.role} — new item "${item.name}" found but no sibling entry to copy scoring from; skipped, needs manual add`);
          continue;
        }
        const newCert = {
          id: slugify(item.name),
          name: item.name,
          level: inferLevel(item.name),
          learnUrl: item.url
            ? new URL(item.url, "https://learn.microsoft.com/").toString()
            : `https://learn.microsoft.com/en-us/credentials/certifications/browse/?terms=${encodeURIComponent(item.name)}`,
          prerequisites: [],
          appliesTo: [{ designation: block.designation, metric: block.metric, role: block.role, tracks: JSON.parse(JSON.stringify(tracks)) }]
        };
        certs.push(newCert); // in-memory only, for dedupe/sibling-lookup within this run
        opsNewCerts.push(newCert);
        const slugForMap = slugFromUrl(newCert.learnUrl);
        if (slugForMap) existingBySlug.set(slugForMap, newCert);
        report.added.push(`${newCert.name} (${newCert.id}) — ${source.id}: ${block.designation}/${block.metric}/${block.role}${item.url ? "" : " [learnUrl is a search-page placeholder; please verify]"}`);
      }
    }
  }

  let text = await fs.readFile(certsPath, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  for (const { certId, entry } of opsAppliesTo) {
    text = appendAppliesTo(text, certId, entry, eol);
  }
  for (const cert of opsNewCerts) {
    text = appendCertification(text, cert, eol);
  }
  if (opsAppliesTo.length > 0 || opsNewCerts.length > 0) {
    await fs.writeFile(certsPath, text, "utf8");
  }

  await fs.mkdir(TMP_DIR, { recursive: true });
  const reportMd = renderReport(report);
  await fs.writeFile(path.join(TMP_DIR, "reconcile-report.md"), reportMd, "utf8");
  process.stdout.write(reportMd);

  const changed = report.added.length > 0;
  await fs.writeFile(path.join(TMP_DIR, "reconcile-changed"), changed ? "true" : "false", "utf8");
}

function renderReport(report) {
  const lines = ["# Certification data reconciliation report", ""];
  lines.push(`Generated: ${new Date().toISOString()}`, "");
  lines.push(`## Added (${report.added.length})`, "");
  lines.push(...(report.added.length ? report.added.map((l) => `- ${l}`) : ["- (none)"]), "");
  lines.push(`## Possible renames — not applied automatically (${report.renamed.length})`, "");
  lines.push(...(report.renamed.length ? report.renamed.map((l) => `- ${l}`) : ["- (none)"]), "");
  lines.push(`## Possible aliases — needs human verification (${report.possibleAliases.length})`, "");
  lines.push(...(report.possibleAliases.length ? report.possibleAliases.map((l) => `- ${l}`) : ["- (none)"]), "");
  lines.push(`## Blocks with no extracted data (${report.noDataBlocks.length})`, "");
  lines.push(...(report.noDataBlocks.length ? report.noDataBlocks.map((l) => `- ${l}`) : ["- (none)"]), "");
  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
