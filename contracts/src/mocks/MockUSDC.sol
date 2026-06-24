// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Minimal 6-decimal ERC20 used only for local tests. NOT for deployment.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    /// @dev USDC uses 6 decimals, unlike the ERC20 default of 18.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open mint for test setup only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
