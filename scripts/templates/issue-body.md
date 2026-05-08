## Microsoft Learn content drift detected — {{SOURCE_ID}}

The daily monitor detected a meaningful change on the Microsoft Learn source page for the **{{SOURCE_NAME}}** designation.

- **Source URL:** {{SOURCE_URL}}
- **Detected at:** {{DETECTED_AT}}

### Diff (previous → current)

<details>
<summary>Click to expand</summary>

```diff
{{DIFF}}
```

</details>

### Action requested (assigned to @copilot)

Please reconcile the changes above into the data layer. **Do not edit `snapshots/`** — those files are owned by a separate manual workflow and refreshing them now would obscure future drift detection.

Suggested workflow:

1. Read the diff above and identify which certification(s), designation(s), or scoring rule(s) changed.
2. Update the affected entries in:
   - [`data/certifications.json`](../blob/main/data/certifications.json) — for cert-level changes (new certs, retirements, point-rule shifts, prereq changes)
   - [`data/designations.json`](../blob/main/data/designations.json) — for category/metric scoring envelope changes, classification rules, or step-gating semantics
3. Update `data/meta.json` `lastSourceUpdate` to today's ISO date.
4. Run `npm run validate` locally and confirm it passes (CI will run it on the PR too).
5. Open a PR linking back to this issue. After it merges, a maintainer will manually trigger the **Refresh content snapshots** workflow to reset the snapshot baseline.

### Reviewer checklist (for the human approver)

- [ ] Changes faithfully reflect the diff above (no scope creep).
- [ ] All `appliesTo.designation` values still resolve to a known designation.
- [ ] `npm run validate` passed in CI.
- [ ] Spot-checked at least one affected cert detail page in a local preview.
