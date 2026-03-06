import { pool, withTx } from "../db/pool.js";
import { config } from "../config.js";
import { fromWei, toWei, lower } from "../utils/units.js";

export async function getConfig(client = pool) {
  const { rows } = await client.query("SELECT * FROM jackpot_config WHERE id = 1");
  const row = rows[0];
  return {
    enabled: row?.enabled ?? config.defaults.enabled,
    payoutScale: BigInt(row?.payout_scale ?? config.defaults.payoutScale),
    maxWinPercent: Number(row?.max_win_percent ?? config.defaults.maxWinPercent),
    minPaymentWei: BigInt(row?.min_payment_wei ?? toWei(config.defaults.minPaymentHex)),
    minClaimWei: BigInt(row?.min_claim_wei ?? toWei(config.defaults.minClaimHex)),
    dailyMaxPayoutWei: BigInt(row?.daily_max_payout_wei ?? toWei(config.defaults.dailyMaxPayoutHex)),
  };
}

export async function txExists(txHash, client = pool) {
  const { rowCount } = await client.query("SELECT 1 FROM payments WHERE tx_hash = $1", [txHash]);
  return rowCount > 0;
}

export async function isWhitelistedMerchant(merchantId, client = pool) {
  const { rowCount } = await client.query(
    "SELECT 1 FROM merchant_whitelist WHERE merchant_id = $1 AND active = TRUE",
    [merchantId],
  );
  return rowCount > 0;
}

export async function getMerchantWallet(merchantId, client = pool) {
  const { rows } = await client.query(
    "SELECT merchant_wallet FROM merchant_whitelist WHERE merchant_id = $1 AND active = TRUE",
    [merchantId],
  );
  return rows[0]?.merchant_wallet ? lower(rows[0].merchant_wallet) : null;
}

export async function checkRepeatLimit({ userAddress, limitCount }, client = pool) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS cnt
     FROM payment_rate_limits
     WHERE user_address = $1
       AND created_at >= now() - interval '10 minutes'`,
    [lower(userAddress)],
  );
  return rows[0].cnt < limitCount;
}

export async function getDailyPayoutWei(client = pool) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(approved_wei), 0)::numeric AS total
     FROM jackpot_claims
     WHERE status IN ('approved', 'paid')
       AND approved_at::date = now()::date`,
  );
  return BigInt(rows[0].total || 0);
}

export async function recordRound(payload) {
  return withTx(async (client) => {
    const userAddress = lower(payload.userAddress);

    await client.query(
      `INSERT INTO users(wallet_address)
       VALUES ($1)
       ON CONFLICT(wallet_address) DO NOTHING`,
      [userAddress],
    );

    const paymentRes = await client.query(
      `INSERT INTO payments (
        tx_hash, user_address, merchant_id, amount_hex_wei, fee_hex_wei,
        block_number, paid_at, processed
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
      RETURNING id`,
      [
        payload.txHash,
        userAddress,
        payload.merchantId,
        payload.paymentAmountWei.toString(),
        payload.feeAmountWei.toString(),
        payload.blockNumber,
        payload.paidAt,
      ],
    );

    await client.query(
      `INSERT INTO payment_rate_limits(user_address, merchant_id, tx_hash)
       VALUES ($1,$2,$3)
       ON CONFLICT(tx_hash) DO NOTHING`,
      [userAddress, payload.merchantId, payload.txHash],
    );

    await client.query(
      `INSERT INTO jackpot_rounds (
        payment_id, user_address, contract_balance_wei, jackpot_display_wei,
        random_value, raw_win_wei, max_win_wei, final_win_wei, is_winner
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        paymentRes.rows[0].id,
        userAddress,
        payload.contractBalanceWei.toString(),
        payload.jackpotDisplayWei.toString(),
        payload.randomValue,
        payload.rawWinWei.toString(),
        payload.maxWinWei.toString(),
        payload.finalWinWei.toString(),
        payload.finalWinWei > 0n,
      ],
    );

    if (payload.finalWinWei > 0n) {
      await client.query(
        `INSERT INTO jackpot_wallets(user_address, total_won_wei, claimable_wei)
         VALUES ($1,$2,$2)
         ON CONFLICT(user_address) DO UPDATE
         SET total_won_wei = jackpot_wallets.total_won_wei + EXCLUDED.total_won_wei,
             claimable_wei = jackpot_wallets.claimable_wei + EXCLUDED.claimable_wei,
             updated_at = now()`,
        [userAddress, payload.finalWinWei.toString()],
      );
    } else {
      await client.query(
        `INSERT INTO jackpot_wallets(user_address)
         VALUES ($1)
         ON CONFLICT(user_address) DO NOTHING`,
        [userAddress],
      );
    }
  });
}

export async function getWallet(userAddress, client = pool) {
  const { rows } = await client.query(
    "SELECT * FROM jackpot_wallets WHERE user_address = $1",
    [lower(userAddress)],
  );
  const row = rows[0] || {
    user_address: lower(userAddress),
    total_won_wei: "0",
    total_claimed_wei: "0",
    claimable_wei: "0",
    updated_at: new Date().toISOString(),
  };

  return {
    userAddress: row.user_address,
    totalWonWei: BigInt(row.total_won_wei),
    totalClaimedWei: BigInt(row.total_claimed_wei),
    claimableWei: BigInt(row.claimable_wei),
    totalWonHex: fromWei(row.total_won_wei),
    totalClaimedHex: fromWei(row.total_claimed_wei),
    claimableHex: fromWei(row.claimable_wei),
    updatedAt: row.updated_at,
  };
}

export async function getHistory(userAddress, limit = 50, client = pool) {
  const { rows } = await client.query(
    `SELECT r.id, p.tx_hash, p.merchant_id, p.amount_hex_wei, r.random_value,
            r.raw_win_wei, r.final_win_wei, r.is_winner, r.created_at
     FROM jackpot_rounds r
     JOIN payments p ON p.id = r.payment_id
     WHERE r.user_address = $1
     ORDER BY r.id DESC
     LIMIT $2`,
    [lower(userAddress), limit],
  );

  return rows.map((r) => ({
    id: r.id,
    txHash: r.tx_hash,
    merchantId: r.merchant_id,
    paymentHex: fromWei(r.amount_hex_wei),
    randomValue: r.random_value,
    rawWinHex: fromWei(r.raw_win_wei),
    finalWinHex: fromWei(r.final_win_wei),
    isWinner: r.is_winner,
    createdAt: r.created_at,
  }));
}

export async function createWithdrawRequest({ userAddress, requestedWei }) {
  return withTx(async (client) => {
    const wallet = await getWallet(userAddress, client);
    if (wallet.claimableWei < requestedWei) {
      throw new Error("INSUFFICIENT_CLAIMABLE");
    }

    const inserted = await client.query(
      `INSERT INTO jackpot_claims(user_address, requested_wei)
       VALUES ($1,$2)
       RETURNING id, status, requested_at`,
      [lower(userAddress), requestedWei.toString()],
    );

    return inserted.rows[0];
  });
}

export async function markClaimPaid({ claimId, txHash, approvedWei }) {
  return withTx(async (client) => {
    const claimRes = await client.query(
      `SELECT * FROM jackpot_claims WHERE id = $1 FOR UPDATE`,
      [claimId],
    );
    if (!claimRes.rowCount) throw new Error("CLAIM_NOT_FOUND");
    const claim = claimRes.rows[0];

    if (!["requested", "approved"].includes(claim.status)) {
      throw new Error("INVALID_CLAIM_STATUS");
    }

    await client.query(
      `UPDATE jackpot_claims
       SET status = 'paid',
           approved_wei = $2,
           tx_hash = $3,
           approved_at = now()
       WHERE id = $1`,
      [claimId, approvedWei.toString(), txHash],
    );

    await client.query(
      `UPDATE jackpot_wallets
       SET claimable_wei = claimable_wei - $2,
           total_claimed_wei = total_claimed_wei + $2,
           updated_at = now()
       WHERE user_address = $1`,
      [claim.user_address, approvedWei.toString()],
    );
  });
}

export async function setListenerBlock(blockNumber, client = pool) {
  await client.query(
    `UPDATE listener_state
     SET last_scanned_block = $1, updated_at = now()
     WHERE id = 1`,
    [blockNumber],
  );
}

export async function getListenerBlock(client = pool) {
  const { rows } = await client.query("SELECT last_scanned_block FROM listener_state WHERE id = 1");
  return Number(rows[0]?.last_scanned_block || 0);
}

export async function getClaimById(claimId, client = pool) {
  const { rows } = await client.query("SELECT * FROM jackpot_claims WHERE id = $1", [claimId]);
  return rows[0] || null;
}

export async function markClaimRejected(claimId, reason = "", client = pool) {
  await client.query(
    `UPDATE jackpot_claims
     SET status = 'rejected', approved_at = now(), tx_hash = NULL
     WHERE id = $1`,
    [claimId],
  );
}
export async function getPublicStats(client = pool) {
  const { rows } = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_winner = TRUE)::bigint AS winner_count,
       COALESCE(MAX(final_win_wei), 0)::numeric AS highest_win_wei,
       COALESCE(MAX(created_at), now()) AS last_round_at
     FROM jackpot_rounds`
  );

  const row = rows[0] || { winner_count: 0, highest_win_wei: "0", last_round_at: new Date().toISOString() };
  return {
    winnerCount: Number(row.winner_count || 0),
    highestWinWei: BigInt(row.highest_win_wei || 0),
    lastRoundAt: row.last_round_at,
  };
}