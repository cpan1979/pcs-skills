#!/usr/bin/env node
// Reads the drift report from .tmp/report.json and opens or updates a
// GitHub issue per changed source via the `gh` CLI. Designed to run inside
// a GitHub Actions workflow with GH_TOKEN exported.
import fs from "node:fs/promises";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SOURCE_NAMES = {
  "business-applications": "Business Applications",
  "azure": "Azure (Data & AI / Infrastructure / Digital & App Innovation)",
  "security": "Security",
  "modern-work": "Modern Work"
};

function getExistingLabels(repo) {
  try {
    const labels = JSON.parse(execSync(
      `gh label list --repo ${repo} --json name --limit 100`,
      { encoding: "utf8" }
    ));
    return new Set(labels.map((label) => label.name));
  } catch (error) {
    console.warn(`Could not list labels (${error.message}); continuing without label checks.`);
    return new Set(["content-drift", "copilot"]);
  }
}

async function main() {
  const reportPath = process.env.REPORT_PATH || path.join(root, ".tmp", "report.json");
  const repo = process.env.REPO;
  if (!repo) throw new Error("REPO env var is required");
  const existingLabels = getExistingLabels(repo);
  const hasContentDriftLabel = existingLabels.has("content-drift");
  const labelsToApply = ["content-drift", "copilot"].filter((label) => existingLabels.has(label));

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const template = await fs.readFile(path.join(root, "scripts", "templates", "issue-body.md"), "utf8");

  const changed = report.sources.filter((s) => s.status === "changed" || s.status === "missing-snapshot");
  if (changed.length === 0) {
    console.log("No drift detected — no issues created.");
    return;
  }

  // Search once for all open issues with the content-drift label.
  const searchArgs = ["issue", "list", "--repo", repo, "--state", "open", "--json", "number,title", "--limit", "50"];
  if (hasContentDriftLabel) {
    searchArgs.push("--label", "content-drift");
  }
  const search = JSON.parse(execSync(`gh ${searchArgs.join(" ")}`, { encoding: "utf8" }));

  await fs.mkdir(path.join(root, ".tmp"), { recursive: true });

  for (const s of changed) {
    const titlePrefix = `chore(content): Learn page changed — ${s.id}`;
    const existing = search.find((i) => i.title.startsWith(titlePrefix));

    let diff = s.diff || "(no diff available)";
    // Cap diff length so the issue body stays under GitHub's 65k char limit.
    if (diff.length > 50000) diff = diff.slice(0, 50000) + "\n... [diff truncated; see workflow artifact for full diff]";

    const body = template
      .replaceAll("{{SOURCE_ID}}", s.id)
      .replaceAll("{{SOURCE_NAME}}", SOURCE_NAMES[s.id] || s.id)
      .replaceAll("{{SOURCE_URL}}", s.url)
      .replaceAll("{{DETECTED_AT}}", report.changedAt)
      .replaceAll("{{DIFF}}", diff);

    const tmpFile = path.join(root, ".tmp", `issue-${s.id}.md`);
    await fs.writeFile(tmpFile, body, "utf8");

    if (existing) {
      console.log(`Commenting on existing issue #${existing.number} for ${s.id}`);
      runGh(["issue", "comment", String(existing.number), "--repo", repo, "--body-file", tmpFile]);
    } else {
      const title = `${titlePrefix} (${report.changedAt.slice(0, 10)})`;
      console.log(`Opening new issue for ${s.id}: ${title}`);
      // Try to assign to the Copilot coding agent. The login may be
      // "Copilot" or "@copilot" depending on the repo configuration; if
      // assignment fails we still create the issue so the human reviewer
      // can pick it up.
      const args = [
        "issue", "create",
        "--repo", repo,
        "--title", title,
        "--body-file", tmpFile,
        "--assignee", "Copilot"
      ];
      for (const label of labelsToApply) {
        args.push("--label", label);
      }
      const result = spawnSync("gh", args, { encoding: "utf8" });
      if (result.status !== 0) {
        console.warn(`Failed with --assignee Copilot (${result.stderr.trim()}); retrying without assignment.`);
        const fallback = spawnSync("gh", args.filter((a, i, arr) => a !== "--assignee" && arr[i - 1] !== "--assignee"), { encoding: "utf8", stdio: "inherit" });
        if (fallback.status !== 0) throw new Error("Failed to create issue.");
      } else {
        process.stdout.write(result.stdout);
      }
    }
  }
}

function runGh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", stdio: "inherit" });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
