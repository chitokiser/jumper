-- Jackpot off-chain schema (PostgreSQL)
-- IMPORTANT: contract logic is untouched; all jackpot logic stays in server + DB.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  tx_hash TEXT NOT NULL UNIQUE,
  user_address TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  amount_hex_wei NUMERIC(78,0) NOT NULL,
  fee_hex_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  block_number BIGINT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user_address ON payments(user_address);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at DESC);

CREATE TABLE IF NOT EXISTS jackpot_rounds (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  user_address TEXT NOT NULL,
  contract_balance_wei NUMERIC(78,0) NOT NULL,
  jackpot_display_wei NUMERIC(78,0) NOT NULL,
  random_value INTEGER NOT NULL CHECK (random_value >= 0 AND random_value <= 9999),
  raw_win_wei NUMERIC(78,0) NOT NULL,
  max_win_wei NUMERIC(78,0) NOT NULL,
  final_win_wei NUMERIC(78,0) NOT NULL,
  is_winner BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_final_not_over_jackpot CHECK (final_win_wei <= jackpot_display_wei),
  CONSTRAINT chk_final_not_over_half CHECK (final_win_wei <= max_win_wei)
);
CREATE INDEX IF NOT EXISTS idx_rounds_user_address ON jackpot_rounds(user_address);
CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON jackpot_rounds(created_at DESC);

CREATE TABLE IF NOT EXISTS jackpot_wallets (
  user_address TEXT PRIMARY KEY,
  total_won_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  total_claimed_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  claimable_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_wallet_non_negative CHECK (
    total_won_wei >= 0 AND total_claimed_wei >= 0 AND claimable_wei >= 0
  )
);

CREATE TABLE IF NOT EXISTS jackpot_claims (
  id BIGSERIAL PRIMARY KEY,
  user_address TEXT NOT NULL,
  requested_wei NUMERIC(78,0) NOT NULL,
  approved_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'requested', -- requested/approved/rejected/paid/failed
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  CONSTRAINT chk_claim_non_negative CHECK (requested_wei >= 0 AND approved_wei >= 0)
);
CREATE INDEX IF NOT EXISTS idx_claims_user_address ON jackpot_claims(user_address);
CREATE INDEX IF NOT EXISTS idx_claims_status ON jackpot_claims(status);

CREATE TABLE IF NOT EXISTS jackpot_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  payout_scale BIGINT NOT NULL DEFAULT 100000,
  max_win_percent NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  min_payment_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  min_claim_wei NUMERIC(78,0) NOT NULL DEFAULT 30000000000000000000,
  daily_max_payout_wei NUMERIC(78,0) NOT NULL DEFAULT 50000000000000000000000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_max_win_percent CHECK (max_win_percent >= 0 AND max_win_percent <= 50)
);

INSERT INTO jackpot_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS merchant_whitelist (
  merchant_id TEXT PRIMARY KEY,
  merchant_wallet TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_rate_limits (
  id BIGSERIAL PRIMARY KEY,
  user_address TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rl_user_created ON payment_rate_limits(user_address, created_at DESC);

CREATE TABLE IF NOT EXISTS listener_state (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  last_scanned_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO listener_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
