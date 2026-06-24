// Hardhat deploy script for Escrow.sol
// Run: npx hardhat run scripts/deploy.js --network base-sepolia
//
// Reads RPC_URL and ADMIN_WALLET_PRIVATE_KEY from the root .env (via hardhat.config.js).
// The deployer (admin wallet) becomes the contract owner — the only address allowed
// to call release() and refund().
const hre = require('hardhat');

// Circle's USDC on Base Sepolia. Override with USDC_ADDRESS in .env if needed.
const DEFAULT_BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

async function main() {
  const usdc = process.env.USDC_ADDRESS || DEFAULT_BASE_SEPOLIA_USDC;
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Network:  ${hre.network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`USDC:     ${usdc}`);

  const Escrow = await hre.ethers.getContractFactory('Escrow');
  const escrow = await Escrow.deploy(usdc, deployer.address);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log(`\nEscrow deployed to: ${address}\n`);
  console.log('Next steps:');
  console.log(`  1. Add to your .env:   ESCROW_CONTRACT_ADDRESS=${address}`);
  console.log(
    `  2. Verify on Basescan: npx hardhat verify --network ${hre.network.name} ${address} ${usdc} ${deployer.address}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
