# Implementation plans

Store accepted plans here when work spans multiple components, changes
architecture, or touches payments, KYC, custody, migrations, secrets, or
deployment.

Use a descriptive kebab-case filename. Record the intended outcome, settled
decisions, affected files, implementation sequence, verification, and explicit
non-goals. Small changes can remain in the issue or review conversation.

Plans describe intent; the current code, tests, `AGENTS.md`, and `SECURITY.md`
remain authoritative.

## Index

| Doc | Kind | Summary |
|---|---|---|
| [privy-operator-custody.md](./privy-operator-custody.md) | Plan | Phase A: bot → backend → Privy operator wallet → Escrow; Phase B gates: role split + Safe. Issues #14, #18, #21, #22, #23. |
| [post-privy-signer-exit.md](./post-privy-signer-exit.md) | Brainstorm | After MVP: swap Privy operator signer for cloud KMS (or similar) via a stable backend adapter seam; Safe/releaser roles stay. |
