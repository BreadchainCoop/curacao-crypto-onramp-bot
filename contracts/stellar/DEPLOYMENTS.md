# Stellar deployments

Addresses for KambioEscrow (`contracts/stellar/escrow`). Testnet only. Dates are UTC.

## Testnet

"Verified" means StellarExpert matched the wasm to its source commit. It isn't an audit.

| Item | Value |
| --- | --- |
| KambioEscrow v0.3.0 | `CARXCXWNW5NF4ZLLM6S3VPY7DXNPSUNRYNXVVS2BALU3X6IJALDYHTJY` |
| Explorer | https://stellar.expert/explorer/testnet/contract/CARXCXWNW5NF4ZLLM6S3VPY7DXNPSUNRYNXVVS2BALU3X6IJALDYHTJY |
| StellarExpert source | Verified |
| Wasm hash (sha256) | `cf10f911b9ccf4eede47e60282af00412e40ead238f06ca93c4a3fd5b67e07dd` |
| Source | commit `f709288`, tag `stellar-escrow-v0.3.0`, attested release `stellar-escrow-v0.3.0_contracts_stellar_escrow_pkg0.3.0_cli28.1.0` |
| Owner / operator | `GBSU6Q7LPCCLENKZZYNVM5C6A55MECOPBHUE6IGPC5WWLTJOJPM2M5GX` |
| USDC token (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| USDC issuer (Circle testnet) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Deploy tx | `18d5e59a1f2cc568192412ed3f93e961e35c906f2bdefdafbb05f612ef1ddbc2` |
| Deployed | 2026-10-31 |

## Retired

Same owner and token as above. No longer in use.

| Item | Value |
| --- | --- |
| KambioEscrow v0.2.0 | `CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5` |
| Explorer | https://stellar.expert/explorer/testnet/contract/CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5 |
| StellarExpert source | Not verified |
| Wasm hash (sha256) | `d0516bf3b5867a563ce1f12f5a33fee812fbd3976eb95baaa2f07b92058d856f` |
| Source | commit `fdc49c2`, tag `stellar-escrow-v0.2.0`, attested release `stellar-escrow-v0.2.0_contracts_stellar_escrow_pkg0.2.0_cli28.1.0` |
| Deploy tx | `d07468110a983073e42ded05d8df8e5ff5ec4a361fdcdd97cfefe323c6a56e49` |
| Deployed | 2026-10-29 |
| Drained | 2026-10-31: 9 USDC moved to v0.3.0 (withdraw tx `06d406ac50922caa3ee90c72437c8920266a081f1836567bb9b9e0318c7deb75`, deposit tx `d0acdb3e2350a33f022949cc3aec646c981013791665fd73480b82e5676a9500`) |
