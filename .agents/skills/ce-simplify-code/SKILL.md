---
name: ce-simplify-code
description: Simplifies a completed change without altering behavior. Use after implementation when the diff contains avoidable complexity, duplication, or indirection.
license: MIT
---

# Simplify code

Reduce complexity only where the current diff justifies it.

## Workflow

1. Read `AGENTS.md`, the current diff, and tests covering changed behavior.
2. Remove dead code, redundant branches, unnecessary wrappers, and duplication.
3. Prefer repository conventions and direct code over new abstractions.
4. Preserve public behavior, error semantics, logging safety, and data ordering.
5. Do not combine simplification with unrelated cleanup or dependency changes.
6. Re-run focused tests after each meaningful simplification.
7. Revert a simplification if equivalence is uncertain or verification weakens.

Never simplify away compare-and-set transitions, authoritative provider
re-fetches, payout-wallet pinning, constant-time secret checks, RLS safeguards,
or explicit chain/deployment gates.

## Completion

Summarize what became simpler and the evidence that behavior did not change. If
the existing implementation is already the clearest safe form, make no edits.
