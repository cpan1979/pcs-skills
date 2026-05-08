# Partner Capability Score — Skilling

A certification-centric, Microsoft Learn–styled guide to the Microsoft Partner Capability Score (PCS) for Solutions Partner designations. Built as a static site for GitHub Pages, with a daily GitHub Actions workflow that watches the four Microsoft Learn source pages and opens an issue (delegated to the Copilot coding agent) whenever a meaningful change is detected.

> ⚠️ This is a community-maintained navigation aid. Always verify scoring details on Microsoft Learn and in Partner Center before making business or training-investment decisions.

## What it does

- Browse all certifications that count toward any Solutions Partner designation, filterable by designation and level.
- Drill into a certification to see every designation it counts for, the per-track scoring rule, prerequisites, and where it sits in the Step 1 / Step 2 / Step 3 gating sequence.
- Drill into a designation to see its full scoring envelope, classification rules, and the certifications that count toward each metric.
- **Toggle SMB ↔ Enterprise** in the header at any time. Point values, gating callouts, and threshold language update everywhere; your preference is remembered.

Source pages (the canonical truth for all content):

- [Solutions Partner for Business Applications](https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-business)
- [Solutions Partner for Data & AI / Infrastructure / Digital & App Innovation](https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-azure)
- [Solutions Partner for Security](https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-security)
- [Solutions Partner for Modern Work](https://learn.microsoft.com/en-us/partner-center/membership/solutions-partner-modern-work)

## Architecture

```
index.html                  # SPA shell (header, track toggle, view container, footer)
assets/
  css/styles.css            # Microsoft Learn-inspired design tokens & components
  js/
    app.js                  # Entry point: loads data, mounts router, wires header
    store.js                # Reactive store (data + track preference)
    router.js               # Hash router (#/certs, #/cert/:id, #/designation/:id, #/about)
    util.js                 # Tiny DOM helpers
    views/{certs,cert,designations,designation,about}.js
data/
  certifications.json       # SOURCE OF TRUTH for cert metadata + designation mapping
  designations.json         # SOURCE OF TRUTH for scoring envelopes, classification rules
  meta.json                 # Last-checked / last-source-update timestamps
schemas/
  certifications.schema.json
  designations.schema.json
scripts/
  validate.mjs              # JSON Schema + cross-reference validation
  check-updates.mjs         # Fetch Learn pages, normalize, diff against snapshots (--write-snapshots refreshes baseline)
  open-drift-issues.mjs     # Convert drift report into GitHub issues
  templates/issue-body.md   # Template used when opening drift issues
snapshots/                  # Normalized markdown of each Learn page (workflow-owned)
.github/workflows/
  check-learn-updates.yml   # Daily drift check (cron + manual)
  update-snapshots.yml      # Manual snapshot baseline refresh
  validate.yml              # PR validation
.nojekyll                   # Pages serves files literally (no Jekyll)
```

There is **no build step**. GitHub Pages serves the committed files exactly. All view code uses native ES modules.

## Local development

```bash
# Install dev dependencies (only needed for validate / drift scripts)
npm ci

# Validate the data layer
npm run validate

# Run a local preview at http://localhost:4173
npm run serve
```

You can also just open `index.html` directly via any static server (Live Server, `python -m http.server`, etc.). A static server is required — opening the file via `file://` will block the `fetch()` calls that load the JSON.

## Adding or updating a certification

Edit [`data/certifications.json`](data/certifications.json). Each entry looks like:

```jsonc
{
  "id": "azure-administrator-associate",       // stable slug; never change
  "name": "Azure Administrator Associate",
  "level": "Associate",                          // Fundamentals|Associate|Specialty|Expert|Applied Skills
  "learnUrl": "https://learn.microsoft.com/...",
  "prerequisites": [],                           // free-text strings
  "appliesTo": [                                 // one entry per (designation × metric × role)
    {
      "designation": "data-ai",                  // must match an id in designations.json
      "metric": "intermediate",
      "role": "step1-required",
      "tracks": {
        "enterprise": { "step": 1, "pointsValue": 0, "pointsRule": "Gating only — 2 people required." },
        "smb":        { "step": 1, "pointsValue": 4, "pointsRule": "4 pts (capped) when at least 1 person is certified." }
      }
    }
  ]
}
```

Run `npm run validate` to confirm the schema and cross-references still resolve.

## How the drift detector works

A daily cron job (`.github/workflows/check-learn-updates.yml`) runs `scripts/check-updates.mjs`, which:

1. Fetches each of the four Microsoft Learn source pages.
2. Strips chrome (nav, footer, cookie banner, "Microsoft Build" promo, feedback widget) so only the article body remains.
3. Converts the article body to markdown with [Turndown](https://github.com/mixmark-io/turndown) and normalizes (strips the "Last updated on" line, collapses whitespace, etc.).
4. Compares the normalized result against `snapshots/{id}.md`.
5. Emits a unified diff for any page whose normalized content has changed.

A second step (`scripts/open-drift-issues.mjs`) then opens or updates a GitHub issue per changed page:

- Title: `chore(content): Learn page changed — {id} (YYYY-MM-DD)`
- Labels: `content-drift`, `copilot`
- Assignee: `Copilot` (the coding agent — falls back to no assignee if the login is unavailable)
- Body: the diff, plus a checklist instructing the agent which JSON files to update and what NOT to touch.

**Snapshots are intentionally not auto-refreshed.** That would let the agent silently rubber-stamp Microsoft Learn changes without anyone reconciling them into the data layer. After a reconciliation PR merges, a maintainer manually runs **Refresh content snapshots** (`update-snapshots.yml`), which regenerates the snapshot baseline and opens a small follow-up PR.

### Manual checks

```bash
# What would the daily run see right now? (does not write or open issues)
npm run check

# Refresh the snapshot baseline locally (for testing only)
npm run snapshots:refresh
```

## Deploying to GitHub Pages

1. Push the repo to GitHub.
2. Repository → **Settings → Pages**, set **Source** to **Deploy from a branch**, **Branch: `main` / `/ (root)`**.
3. Wait ~1 minute for the first build. The site is then served from `https://<user>.github.io/<repo>/`.

The `.nojekyll` file is required so Pages serves the `assets/` directory literally instead of running Jekyll. No further configuration is needed.

## License

MIT — see [`LICENSE`](LICENSE).
