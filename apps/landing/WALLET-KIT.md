# wallet-kit.bundle.js

A pre-built browser bundle of the **Stellar Wallets Kit** (multi-wallet connect:
Freighter, Lobstr, xBull, Albedo, Rabet, Hana, HOT, WalletConnect…) plus the
stellar-sdk pieces used by `trustline.html`. It is committed because the landing
site is a no-build static site and the kit's transitive deps don't load cleanly
from a CDN in a plain `<script type="module">`.

Versions are pinned to match what **CoopStable** (`BreadchainCoop/coopstable-client`)
ships in its lockfile: `@creit.tech/stellar-wallets-kit@1.9.5` + `@stellar/stellar-sdk@14.4.2`.

## Rebuild
```bash
mkdir wkbuild && cd wkbuild && npm init -y
npm i @creit.tech/stellar-wallets-kit@1.9.5 @stellar/stellar-sdk@14.4.2 \
      esbuild @esbuild-plugins/node-globals-polyfill @esbuild-plugins/node-modules-polyfill
# entry.mjs: re-export StellarWalletsKit, WalletNetwork, allowAllModules,
#   FREIGHTER_ID, XBULL_ID, ALBEDO_ID, RABET_ID, LOBSTR_ID, HANA_ID (kit)
#   and Asset, Operation, TransactionBuilder, BASE_FEE, Networks, Horizon (sdk)
# build with esbuild: format=esm, minify, target es2020,
#   banner: 'var global=globalThis;var process=globalThis.process||(globalThis.process={env:{}});'
#   plugins: NodeGlobalsPolyfillPlugin({buffer:true,process:true}), NodeModulesPolyfillPlugin()
```
Copy the output to `apps/landing/wallet-kit.bundle.js` and bump the `?v=` query in `trustline.html`.
