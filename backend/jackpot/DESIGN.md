# Jackpot Logic Summary

## Event Processing Flow
1. Listen payment event from existing payment contract.
2. Validate tx receipt success and confirmations.
3. Enforce security rules (whitelist, anti-self-payment, rate limit, admin exclusion).
4. Read HEX balance from contract.
5. `jackpot = contract_balance / 2`.
6. Generate random: `HMAC_SHA256(secret, txHash + userAddress + paymentAmount + blockNumber) % 10000`.
7. Compute payout:
   - `rawWin = jackpot * paymentAmount * random / 1,000,000 / payoutScale`
   - `maxWin = jackpot * maxWinPercent`
   - `finalWin = min(rawWin, maxWin, jackpot)`
8. Store payment + round + wallet updates in PostgreSQL transaction.

## Hard Constraints
- Smart contract is not modified.
- `finalWin <= jackpot`
- `finalWin <= jackpot * 0.5`

## Withdrawal Flow
1. User requests withdraw.
2. Server checks claimable balance + min claim.
3. Auto-approve or admin approve.
4. Server sends HEX transfer from hot wallet.
5. DB updates claim + wallet totals.
