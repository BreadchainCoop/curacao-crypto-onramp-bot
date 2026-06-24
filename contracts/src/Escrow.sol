// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Escrow
/// @notice Holds USDC pre-funded by the operator and releases it to buyers once
///         the operator (owner) confirms an off-chain fiat payment via Sentoo.
/// @dev    Deployed on Base Sepolia for the MVP. The owner is the admin wallet
///         whose private key is loaded from env at deploy time — never hardcoded.
///         Funds are pooled (not per-order): the backend tracks order↔payout
///         mapping off-chain and calls `release` for each confirmed payment.
contract Escrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The stablecoin held in escrow (USDC).
    IERC20 public immutable token;

    event Deposited(address indexed from, uint256 amount);
    event Released(address indexed recipient, uint256 amount);
    event Refunded(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);

    /// @param usdc         Address of the USDC token contract.
    /// @param initialOwner Admin wallet that may call `release` and `refund`.
    constructor(address usdc, address initialOwner) Ownable(initialOwner) {
        if (usdc == address(0)) revert ZeroAddress();
        token = IERC20(usdc);
    }

    /// @notice Operator pre-funds the escrow with USDC.
    /// @dev    Caller must `approve` this contract for `amount` first. Anyone may
    ///         deposit, but only the owner can move funds out.
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Releases USDC to a buyer after a confirmed fiat payment. Owner-only.
    function release(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = token.balanceOf(address(this));
        if (amount > available) revert InsufficientBalance(amount, available);
        token.safeTransfer(recipient, amount);
        emit Released(recipient, amount);
    }

    /// @notice Returns USDC from the escrow to the operator (owner). Owner-only.
    function refund(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = token.balanceOf(address(this));
        if (amount > available) revert InsufficientBalance(amount, available);
        token.safeTransfer(owner(), amount);
        emit Refunded(owner(), amount);
    }

    /// @notice Current USDC balance held in escrow.
    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
