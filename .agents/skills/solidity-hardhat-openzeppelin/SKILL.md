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
