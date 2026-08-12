---
name: ce-code-review
description: Reviews a change for correctness, regressions, security, and missing tests. Use before merging or when the user asks for a code or pull-request review.
license: MIT
---

# Code review

Review the actual diff and repository behavior. Findings are more important than
a general summary.

## Workflow

1. Read `AGENTS.md`, the diff, affected code, and relevant tests.
2. Trace success, failure, retry, duplicate, and race paths.
3. Check changed contracts between bot, backend, providers, database, and chain.
4. Apply heightened scrutiny to payments, KYC, custody, keys, migrations, and
   deployment.
5. Verify tests assert behavior rather than implementation details.
6. Report only actionable findings supported by concrete evidence.

Order findings by severity. For each finding, cite the path/line, explain the
failure scenario and impact, and suggest the smallest safe correction. Distinguish
must-fix defects from optional improvements.

Explicitly say when no findings remain, but note any checks that could not be
run. Do not claim an audit, compliance approval, or mainnet readiness from an
ordinary code review.
