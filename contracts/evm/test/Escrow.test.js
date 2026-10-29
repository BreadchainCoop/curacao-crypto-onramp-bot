const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Escrow', function () {
  let escrow, usdc;
  let owner, operator, buyer, other;
  const amount = 1_000_000n; // 1 USDC (6 decimals)

  beforeEach(async function () {
    [owner, operator, buyer, other] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory('MockUSDC');
    usdc = await Mock.deploy();

    const Escrow = await ethers.getContractFactory('Escrow');
    escrow = await Escrow.deploy(await usdc.getAddress(), owner.address);

    // Fund the operator and approve the escrow to pull USDC.
    await usdc.mint(operator.address, amount * 10n);
    await usdc.connect(operator).approve(await escrow.getAddress(), amount * 10n);
  });

  describe('deployment', function () {
    it('sets the token and owner', async function () {
      expect(await escrow.token()).to.equal(await usdc.getAddress());
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it('reverts if deployed with a zero token address', async function () {
      const Escrow = await ethers.getContractFactory('Escrow');
      await expect(Escrow.deploy(ethers.ZeroAddress, owner.address))
        .to.be.revertedWithCustomError(escrow, 'ZeroAddress');
    });
  });

  describe('deposit', function () {
    it('pulls USDC into the escrow and emits Deposited', async function () {
      await expect(escrow.connect(operator).deposit(amount))
        .to.emit(escrow, 'Deposited')
        .withArgs(operator.address, amount);
      expect(await escrow.balance()).to.equal(amount);
    });

    it('reverts on a zero amount', async function () {
      await expect(escrow.connect(operator).deposit(0))
        .to.be.revertedWithCustomError(escrow, 'ZeroAmount');
    });
  });

  describe('release', function () {
    beforeEach(async function () {
      await escrow.connect(operator).deposit(amount);
    });

    it('lets the owner release USDC to a buyer', async function () {
      await expect(escrow.connect(owner).release(buyer.address, amount))
        .to.emit(escrow, 'Released')
        .withArgs(buyer.address, amount);
      expect(await usdc.balanceOf(buyer.address)).to.equal(amount);
      expect(await escrow.balance()).to.equal(0n);
    });

    it('reverts when a non-owner calls release', async function () {
      await expect(escrow.connect(other).release(buyer.address, amount))
        .to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount')
        .withArgs(other.address);
    });

    it('reverts when releasing more than the balance', async function () {
      await expect(escrow.connect(owner).release(buyer.address, amount + 1n))
        .to.be.revertedWithCustomError(escrow, 'InsufficientBalance')
        .withArgs(amount + 1n, amount);
    });

    it('reverts on a zero recipient', async function () {
      await expect(escrow.connect(owner).release(ethers.ZeroAddress, amount))
        .to.be.revertedWithCustomError(escrow, 'ZeroAddress');
    });

    it('reverts on a zero amount', async function () {
      await expect(escrow.connect(owner).release(buyer.address, 0))
        .to.be.revertedWithCustomError(escrow, 'ZeroAmount');
    });
  });

  describe('refund', function () {
    beforeEach(async function () {
      await escrow.connect(operator).deposit(amount);
    });

    it('lets the owner refund USDC back to the owner', async function () {
      const before = await usdc.balanceOf(owner.address);
      await expect(escrow.connect(owner).refund(amount))
        .to.emit(escrow, 'Refunded')
        .withArgs(owner.address, amount);
      expect(await usdc.balanceOf(owner.address)).to.equal(before + amount);
      expect(await escrow.balance()).to.equal(0n);
    });

    it('reverts when a non-owner calls refund', async function () {
      await expect(escrow.connect(other).refund(amount))
        .to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount')
        .withArgs(other.address);
    });

    it('reverts when refunding more than the balance', async function () {
      await expect(escrow.connect(owner).refund(amount + 1n))
        .to.be.revertedWithCustomError(escrow, 'InsufficientBalance')
        .withArgs(amount + 1n, amount);
    });
  });
});
