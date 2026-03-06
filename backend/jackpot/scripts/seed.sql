-- Example seed
INSERT INTO merchant_whitelist (merchant_id, merchant_wallet, active)
VALUES
('merchant-001', '0x0000000000000000000000000000000000000001', TRUE)
ON CONFLICT (merchant_id) DO UPDATE
SET merchant_wallet = EXCLUDED.merchant_wallet,
    active = EXCLUDED.active;
