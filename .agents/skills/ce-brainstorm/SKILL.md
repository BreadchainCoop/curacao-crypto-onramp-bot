---
name: ce-brainstorm
description: Clarifies an uncertain feature or problem before implementation. Use when requirements, scope, constraints, or user outcomes still need to be explored.
license: MIT
---

# Brainstorm

Turn an ambiguous request into a small, testable problem statement. Do not edit
files during this workflow.

## Workflow

1. Read `AGENTS.md` and the smallest relevant set of repository files.
2. State the user outcome and why it matters.
3. Identify constraints, assumptions, affected users, and sensitive paths.
4. Offer at most three materially different approaches with concrete tradeoffs.
5. Ask only questions whose answers would change scope or architecture.
6. Record settled decisions, rejected options, and explicit non-goals.
7. Hand off a concise requirements brief to `ce-plan`.

Keep the scope proportional to this repository. Prefer extending existing
patterns over introducing infrastructure, abstractions, or dependencies.

## Completion

The brainstorm is complete when the desired outcome, boundaries, acceptance
criteria, and unresolved decisions are clear enough to plan without guessing.
