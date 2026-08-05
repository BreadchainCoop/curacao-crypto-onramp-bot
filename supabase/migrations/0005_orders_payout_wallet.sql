-- Pin the payout destination at order-create time. The release reads this
-- column instead of the mutable users.wallet_address, so a wallet change between
-- order creation and release can never redirect an in-flight order's funds.

alter table orders add column if not exists payout_wallet text;
