#!/usr/bin/env node
// Fetches the four Microsoft Learn source pages, normalizes them to
// markdown, compares against `snapshots/{id}.md`, and emits a unified diff
// for any pages whose normalized content has changed.
//
// Output modes:
//   default  — exits 0 with a JSON report on stdout describing changes; the
//              workflow consumes this.
//   --print  — also writes diffs to stdout for human reading.
//   --write-snapshots — overwrites snapshots with the latest fetched content.
//                       Used by the manual refresh workflow only.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTwoFilesPatch } from "diff";
import TurndownService from "turndown";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SNAP_DIR = path.join(root, "snapshots");

const SOURCES = [
  { id: "business-applications", url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-business" },
  { id: "azure",                  url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-azure" },
  { id: "security",               url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-security" },
  { id: "modern-work",            url: "https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-modern-work" }
];

const FLAGS = new Set(process.argv.slice(2));
const PRINT = FLAGS.has("--print");
const WRITE = FLAGS.has("--write-snapshots");

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "PCSSkills-content-monitor/1.0 (+https://github.com/)",
      "Accept": "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.text();
}

// Strip HTML chrome to focus on the article body. Microsoft Learn pages put
// the main article inside <main id="main"> with a <article> child.
function extractMainHtml(html) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let body = mainMatch ? mainMatch[1] : html;

  // Remove side nav, breadcrumbs, feedback widgets, "additional resources"
  body = body
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    // Strip "Microsoft Build" promo blocks and feedback footers
    .replace(/<section[^>]*class="[^"]*feedback[^"]*"[\s\S]*?<\/section>/gi, "")
    .replace(/<section[^>]*data-bi-name="[^"]*feedback[^"]*"[\s\S]*?<\/section>/gi, "");

  return body;
}

function normalizeMarkdown(md) {
  return md
    // Drop "Last updated on …" line — Microsoft updates this without
    // semantic content changes.
    .replace(/^.*Last updated on .*$/gim, "")
    // Drop the "Summarize this article for me" widget text
    .replace(/^Summarize this article for me.*$/gim, "")
    // Drop generic Learn footer / cookie text snippets
    .replace(/^.*Manage cookies.*$/gim, "")
    .replace(/^.*Microsoft Build 2026.*$/gim, "")
    .replace(/^.*Dismiss alert.*$/gim, "")
    .replace(/^.*Skip to main content.*$/gim, "")
    .replace(/^.*Ask Learn.*$/gim, "")
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, "\n\n")
    // Trim trailing whitespace per line
    .split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n")
    .trim() + "\n";
}

function htmlToMarkdown(html) {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced"
  });
  td.remove(["script", "style", "noscript", "iframe"]);
  return td.turndown(html);
}

async function readIfExists(p) {
  try { return await fs.readFile(p, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

async function main() {
  await fs.mkdir(SNAP_DIR, { recursive: true });

  const report = { changedAt: new Date().toISOString(), sources: [] };

  for (const src of SOURCES) {
    process.stderr.write(`Checking ${src.id}…\n`);
    let entry = { id: src.id, url: src.url, status: "unchanged", error: null };
    try {
      const html = await fetchHtml(src.url);
      const main = extractMainHtml(html);
      const md = normalizeMarkdown(htmlToMarkdown(main));
      const snapPath = path.join(SNAP_DIR, `${src.id}.md`);
      const prev = await readIfExists(snapPath);

      if (WRITE) {
        await fs.writeFile(snapPath, md, "utf8");
        entry.status = prev == null ? "created" : (prev === md ? "unchanged" : "rewritten");
        entry.bytes = md.length;
      } else if (prev == null) {
        entry.status = "missing-snapshot";
        entry.diff = `(no prior snapshot; ${md.length} bytes fetched)`;
      } else if (prev !== md) {
        entry.status = "changed";
        entry.diff = createTwoFilesPatch(
          `snapshots/${src.id}.md`,
          `live/${src.id}.md`,
          prev,
          md,
          "previous",
          "current"
        );
      }
    } catch (err) {
      entry.status = "error";
      entry.error = err.message;
    }
    report.sources.push(entry);
    if (PRINT && entry.diff) process.stderr.write(entry.diff + "\n");
  }

  // Stdout = machine-readable JSON for the workflow.
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
