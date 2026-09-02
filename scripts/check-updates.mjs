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
import { SOURCES, fetchHtml, extractMainHtml, normalizeMarkdown, htmlToMarkdown } from "./lib/learn-source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SNAP_DIR = path.join(root, "snapshots");

const FLAGS = new Set(process.argv.slice(2));
const PRINT = FLAGS.has("--print");
const WRITE = FLAGS.has("--write-snapshots");

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
