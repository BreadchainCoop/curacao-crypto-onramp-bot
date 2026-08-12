---
name: javascript-node-commonjs
description: Guides JavaScript changes in this Node 20 CommonJS monorepo. Use when editing bot or backend .js files, asynchronous services, Express routes, Grammy flows, or native Node tests.
license: MIT
---

# JavaScript and Node

Follow the existing package and file conventions rather than migrating the
repository to another module system, language, framework, or test runner.

## Conventions

- Use CommonJS `require` and `module.exports`; do not introduce ESM or TypeScript
  piecemeal.
- Prefer `const`, small functions, early returns, and explicit dependency
  boundaries.
- Await every operation whose completion affects state, money movement, replies,
  or error handling.
- Run independent work concurrently only when ordering and partial failure are
  safe.
- Catch errors at process, route, flow, or integration boundaries. Preserve
  retry semantics and sanitize messages before logging or showing them to users.
- Inject provider clients, repositories, clocks, fetch implementations, and
  notifiers so tests do not contact live services.
- Reuse existing services and domain modules before adding abstractions or
  dependencies.

## Package boundaries

- `bot/` owns Telegram interaction and user/admin flows.
- `backend/` owns public webhooks, expiry, and automatic escrow release.
- `chains.js` is shared by both processes.
- The root package is tooling only; dependencies belong to the package that uses
  them.

## Tests

Use `node:test` with `node:assert/strict`. Follow existing test placement and
factory/fake patterns. Assert observable behavior, including failure, duplicate,
retry, and race cases where relevant. Avoid sleeps and shared mutable fixtures.

Run:

```bash
cd bot && npm test
cd backend && npm test
```

Read `AGENTS.md` and the relevant domain skill before changing KYC, payments,
wallets, secrets, or deployment behavior.
