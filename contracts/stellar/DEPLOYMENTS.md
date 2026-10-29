# Stellar deployments

Addresses for KambioEscrow (`contracts/stellar/escrow`). Testnet only; there is no mainnet
deployment. Runbook and proof transactions: [`../../docs/stellar/TESTNET.md`](../../docs/stellar/TESTNET.md).

## Testnet (current)

| Item | Value |
| --- | --- |
| KambioEscrow v0.2.0 | `CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5` |
| Explorer | https://stellar.expert/explorer/testnet/contract/CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5 |
| Wasm hash (sha256) | `d0516bf3b5867a563ce1f12f5a33fee812fbd3976eb95baaa2f07b92058d856f` |
| Source | commit `fdc49c2`, tag `stellar-escrow-v0.2.0`, attested release `stellar-escrow-v0.2.0_contracts_stellar_escrow_pkg0.2.0_cli28.1.0` |
| Owner / operator | `GBSU6Q7LPCCLENKZZYNVM5C6A55MECOPBHUE6IGPC5WWLTJOJPM2M5GX` |
| USDC token (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| USDC issuer (Circle testnet) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Deploy tx | `d07468110a983073e42ded05d8df8e5ff5ec4a361fdcdd97cfefe323c6a56e49` |
| Deployed | 2026-10-30 |

## Testnet (previous)

| Contract | Notes |
| --- | --- |
| `CAKKY5WKDXZRQVGD2UR72AV4FMZOS7EW3UGRET4CMQSX3QMWQTNEALJT` | v0.1.0 of the old `stellar-stablecoin-onramp-bot` repo (SDK 22, public `init`, `refund`). Different interface. Source-verified on StellarExpert. 2026-10-21 |
| `CBGXBSIUEJYWDUA5UJNTP37NOEZN2FYNIOTME5S6N5LJWCPRTVRP5BL3` | First local build, unverified |

## Mainnet

None. Mainnet needs the audit, a multisig or KMS-backed owner and the CBCS sandbox admission
first (see `SECURITY.md`).
