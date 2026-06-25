// Calls the Escrow smart contract release() function via ethers.js
// Reads ESCROW_CONTRACT_ADDRESS and ADMIN_WALLET_PRIVATE_KEY from env — never hardcode
//
// release(recipient, amountUsdc) sends USDC from the escrow to the buyer. The
// owner (admin wallet) is the only address allowed to call release() on-chain.

// Minimal ABI — just the function we call. Matches contracts/src/Escrow.sol.
const ESCROW_ABI = ['function release(address recipient, uint256 amount)'];

// USDC has 6 decimals.
const USDC_DECIMALS = 6;

/**
 * @param {object} opts
 * @param {string} opts.rpcUrl
 * @param {string} opts.privateKey   admin wallet (contract owner)
 * @param {string} opts.contractAddress
 * @param {object} [opts.ethers]     injectable; defaults to require('ethers')
 */
function createEscrowService({ rpcUrl, privateKey, contractAddress, ethers }) {
  if (!rpcUrl || !privateKey || !contractAddress) {
    throw new Error('Escrow service requires rpcUrl, privateKey, and contractAddress');
  }
  const lib = ethers ?? require('ethers');
  const provider = new lib.JsonRpcProvider(rpcUrl);
  const wallet = new lib.Wallet(privateKey, provider);
  const contract = new lib.Contract(contractAddress, ESCROW_ABI, wallet);

  /** Release `amountUsdc` (human units, e.g. 100.5) to `recipient`. Returns tx hash. */
  async function release(recipient, amountUsdc) {
    const amount = lib.parseUnits(String(amountUsdc), USDC_DECIMALS);
    const tx = await contract.release(recipient, amount);
    const receipt = await tx.wait();
    return (receipt && receipt.hash) || tx.hash;
  }

  return { release };
}

function escrowFromEnv(env = process.env) {
  return createEscrowService({
    rpcUrl: env.RPC_URL,
    privateKey: env.ADMIN_WALLET_PRIVATE_KEY,
    contractAddress: env.ESCROW_CONTRACT_ADDRESS,
  });
}

module.exports = { createEscrowService, escrowFromEnv, ESCROW_ABI };
