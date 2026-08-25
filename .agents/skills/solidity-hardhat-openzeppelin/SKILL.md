---
name: solidity-hardhat-openzeppelin
description: Guides Solidity escrow and deployment work using Hardhat, ethers v6, and OpenZeppelin Contracts v5. Use when editing contracts, contract tests, deployment scripts, or chain interaction code.
license: MIT
---

# Solidity, Hardhat, and OpenZeppelin

Treat contract and signing changes as custody-sensitive. Read `AGENTS.md`,
`SECURITY.md`, `contracts/src/Escrow.sol`, and existing tests before editing.

## Contract rules

- Keep the existing Solidity pragma and inspect the installed OpenZeppelin v5
  source before relying on an API or override point.
- Prefer imported OpenZeppelin components over custom access control, token
  transfer, or reentrancy logic.
- Preserve checks before external token transfers and use `SafeERC20`.
- Keep owner-only fund movement and `nonReentrant` protection unless an approved
  design explicitly replaces them.
- Validate zero addresses, zero amounts, and available balances; emit events
  after successful effects.
- Do not imply the pooled escrow provides per-order on-chain accounting.
- Avoid upgradeability, assembly, unchecked arithmetic, and new dependencies
  unless the requirement and review justify them.

## Interface-first contract standards

Adopt the contract *standards* from Wonderland's Foundry boilerplate
(interface-first, complete NatSpec, events on state changes, custom errors on the
interface) **without** migrating to Foundry. Stay on Hardhat + ethers v6 +
OpenZeppelin v5. The Wonderland brand/tooling is not the point — the standards
are. Do **not** copy Foundry CI, remappings, `forge` commands, Bulloak, or
lintspec.

- **Interface-first.** The public API lives on an interface (e.g. `IEscrow`):
  events, custom errors, external function signatures, and their NatSpec. The
  implementation is declared `contract Escrow is IEscrow, ...`.
- **`@inheritdoc`.** Implemented functions carry `/// @inheritdoc IEscrow` rather
  than repeating the doc comment; NatSpec is authored once, on the interface.
- **Events on every state change.** Every state-changing function emits an event
  **after** its effects (checks-effects-interactions). Declare events on the
  interface.
- **Complete NatSpec.** `@notice` on every function/event describing purpose;
  `@param` for every parameter; `@return` for every return value, **including
  public getters**.
- **Custom errors on the interface**, named `Escrow_Reason`
  (e.g. `Escrow_OnlyOperator`, `Escrow_ZeroAddress`, `Escrow_ZeroAmount`). Prefer
  them over `require` strings; revert with the typed error.
- Keep `ReentrancyGuard` + `SafeERC20`. Do not add Foundry or new dependencies.

Layout: put the interface at `contracts/src/interfaces/IEscrow.sol` and the
implementation at `contracts/src/Escrow.sol`.

## Hardhat and ethers v6

- Follow the network definitions in `contracts/hardhat.config.js` and shared
  metadata in `chains.js`.
- Use ethers v6 APIs (`waitForDeployment`, `getAddress`, bigint values); do not
  copy ethers v5 examples using `.address`, `.deployed()`, or `ethers.utils`.
- Keep testnet mock-token behavior separate from mainnet deployment paths.
- Never print, persist, or hardcode a signer private key.
- Do not run a deployment script without explicit user authorization; mainnet
  scripts additionally require the gates in `SECURITY.md`.

## Tests

Extend `contracts/test/Escrow.test.js` for access control, transfer failures,
balance boundaries, events, and reentrancy-sensitive behavior. Use fixtures
where they improve isolation without hiding setup.

Run:

```bash
cd contracts
npx hardhat test
npm run compile
```

An ordinary test or review does not constitute an independent smart-contract
audit or establish mainnet readiness.
