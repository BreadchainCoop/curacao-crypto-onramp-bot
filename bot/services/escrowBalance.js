// Read-only escrow liquidity reader for the bot.
//
// The bot holds NO signing key (#18). This is a pure *view* call — `balance()`
// on the escrow over a public RPC — used to pre-check that the escrow can cover
// an order BEFORE a Sentoo payment link is minted, so a buyer is never charged
// fiat for USDC the pooled escrow cannot deliver. No key, no signing, no writes.

'use strict';

// Just the view we call. Matches contracts/src/Escrow.sol `balance()`.
const ESCROW_BALANCE_ABI = ['function balance() view returns (uint256)'];
const USDC_DECIMALS = 6;

/**
 * @param {object} opts
 * @param {string} opts.rpcUrl         RPC for the active chain (read-only)
 * @param {string} opts.escrowAddress  escrow contract on the active chain
 * @param {object} [opts.ethers]       injectable; defaults to require('ethers')
 * @returns {() => Promise<number>} getEscrowBalanceUsdc — balance in human USDC
 */
function createEscrowBalanceReader({ rpcUrl, escrowAddress, ethers }) {
  if (!rpcUrl || !escrowAddress) {
    throw new Error('Escrow balance reader requires rpcUrl and escrowAddress');
  }
  const lib = ethers ?? require('ethers');
  const provider = new lib.JsonRpcProvider(rpcUrl);
  const escrow = new lib.Contract(escrowAddress, ESCROW_BALANCE_ABI, provider);

  return async function getEscrowBalanceUsdc() {
    const raw = await escrow.balance();
    return Number(lib.formatUnits(raw, USDC_DECIMALS));
  };
}

module.exports = { createEscrowBalanceReader, ESCROW_BALANCE_ABI };
