---
name: ce-plan
description: Produces a reviewable implementation plan grounded in this repository. Use before multi-file, security-sensitive, payment, KYC, custody, migration, or deployment changes.
license: MIT
---

# Plan

Convert an agreed outcome into an implementation sequence. Do not implement the
change while planning.

## Workflow

1. Read `AGENTS.md`, relevant tests, and any matching `docs/solutions/` notes.
2. Trace the current behavior through code and data boundaries.
3. Separate implemented safeguards from documentation or aspirational controls.
4. Resolve choices that materially affect behavior, compatibility, or safety.
5. List the exact files and responsibilities that will change.
6. Break work into small, independently reviewable units.
7. Attach focused verification to each unit and a final regression check.
8. Identify explicit non-goals and risky operations requiring human approval.

Plans for money, KYC, custody, database, secrets, and mainnet paths must preserve
the invariants in `AGENTS.md` and require human review.

## Output

Write accepted plans under `docs/plans/` when the work is substantial enough to
benefit future contributors. Keep a simple change plan in chat for small work.
