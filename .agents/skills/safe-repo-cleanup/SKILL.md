---
name: safe-repo-cleanup
description: Verify and remove obsolete ShinaCare files, exports or dependencies during an explicitly requested repository cleanup.
---

# Safe repository cleanup

Record initial HEAD, branch, worktrees and porcelain status. Keep pre-existing changes
outside the cleanup and its commits. Stop conflicting edits by another active agent.

Classify candidates as active, legacy, duplicate, generated, potentially unused or uncertain.
For each deletion, gather positive evidence of replacement or generated provenance, then
check static/dynamic imports, framework routes, Nest registration/decorators, events,
tests/fixtures, Prisma, CI/Docker/scripts, asset URLs and documented future workspace use.
An analyzer's unused warning or an absent literal match is insufficient evidence alone.

Keep migrations, commerce rules, security controls, notification handlers, approved UI,
Business Workspace foundations and legitimate tests. Scratch migration copies may be
verification evidence: inspect their generator and provenance before deletion.
Python `__pycache__/*.pyc` with corresponding `.py` files are generated runtime caches;
ignore them and verify the AI service after removal.

Inspect existing tooling before adding an analyzer. Prefer local deterministic analysis;
do not send source, credentials or environment files to an indexing service.
Dependency removals must update the active manifest and applicable locks consistently;
retain candidates if multiple package-manager workflows make provenance unclear.

Make small batches, run checks chosen by `lean-testing`, review deleted paths and diff,
and explicitly stage only owned files. Keep repository cleanup and developer tooling
in separate commits. Report deletion evidence and uncertain paths retained.
