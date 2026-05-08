# Snapshots

This directory holds normalized markdown of the four Microsoft Learn source pages. They are the **diff baseline** for the `Check Microsoft Learn for content drift` workflow.

Files in this directory are written exclusively by the **Refresh content snapshots** workflow (and by `npm run snapshots:refresh` for local testing). Do **not** edit them by hand or as part of a content-reconciliation PR — that would erase the diff signal the next daily run depends on.
