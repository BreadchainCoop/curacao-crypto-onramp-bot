// Hardhat deploy script for Escrow.sol
// Run: npx hardhat run scripts/deploy.js --network <network>
//   e.g. --network gnosis-chiado   or   --network base-sepolia
//
// Reads RPC_URL and ADMIN_WALLET_PRIVATE_KEY from the root .env (via hardhat.config.js).
// The deployer (admin wallet) becomes the escrow owner — the only address allowed
// to call release() and refund().
//
// USDC resolution: USDC_ADDRESS env > a known canonical address for the chain >
// otherwise deploy a MockUSDC test token and pre-fund the escrow from it.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

// Canonical USDC by chain id (override anytime with USDC_ADDRESS).
const KNOWN_USDC = {
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia (Circle)
};

// Block explorer "address" base URLs, for the deployment record + verify links.
const EXPLORER = {
  84532: 'https://sepolia.basescan.org/address/',
  80002: 'https://amoy.polygonscan.com/address/',
  11142220: 'https://sepolia.celoscan.io/address/',
  5042002: 'https://testnet.arcscan.app/address/',
  8453: 'https://basescan.org/address/',
  137: 'https://polygonscan.com/address/',
  42220: 'https://celoscan.io/address/',
};

// Test USDC to mint into the escrow when we deploy a MockUSDC (human units).
const SEED_USDC = 100_000n;
const USDC_DECIMALS = 6n;

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const { chainId } = await hre.ethers.provider.getNetwork();
  console.log(`Network:  ${hre.network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  // Resolve the USDC token. USE_MOCK_USDC=1 forces a fresh seeded MockUSDC
  // (self-contained testnet demo) — it also ignores the global USDC_ADDRESS so a
  // value set for one chain never leaks onto another.
  const forceMock = process.env.USE_MOCK_USDC === '1' || process.env.USE_MOCK_USDC === 'true';
  let usdc = forceMock ? null : process.env.USDC_ADDRESS || KNOWN_USDC[Number(chainId)];
  let mock = null;
  if (!usdc) {
    console.log('Deploying MockUSDC (test token)…');
    const Mock = await hre.ethers.getContractFactory('MockUSDC');
    mock = await Mock.deploy();
    await mock.waitForDeployment();
    usdc = await mock.getAddress();
    console.log(`MockUSDC:  ${usdc}`);
  }
  console.log(`USDC:     ${usdc}`);

  // Deploy the escrow, owned by the deployer.
  const Escrow = await hre.ethers.getContractFactory('Escrow');
  const escrow = await Escrow.deploy(usdc, deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`Escrow:   ${escrowAddress}`);

  // If we minted our own test token, pre-fund the escrow so it can pay out.
  if (mock) {
    const amount = SEED_USDC * 10n ** USDC_DECIMALS;
    await (await mock.mint(escrowAddress, amount)).wait();
    console.log(`Seeded escrow with ${SEED_USDC} test USDC.`);
  }

  const explorer = EXPLORER[Number(chainId)];
  const explorerUrl = explorer ? `${explorer}${escrowAddress}` : null;

  // Record the deployment so we can build a "Deployed Contracts" grant sheet.
  const recordPath = path.resolve(__dirname, '..', 'deployments.json');
  let record = {};
  try {
    record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  } catch {
    /* first deployment — start fresh */
  }
  record[hre.network.name] = {
    chainId: Number(chainId),
    escrow: escrowAddress,
    usdc,
    mockUsdc: Boolean(mock),
    deployer: deployer.address,
    explorer: explorerUrl,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  console.log(`\nRecorded in ${recordPath}`);

  console.log('\n=== Set these in your .env ===');
  console.log(`ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
  console.log(`USDC_ADDRESS=${usdc}`);
  if (explorerUrl) console.log(`\nExplorer: ${explorerUrl}`);
  console.log(
    `\nVerify (optional): npx hardhat verify --network ${hre.network.name} ${escrowAddress} ${usdc} ${deployer.address}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
