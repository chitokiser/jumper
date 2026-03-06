# Jumper Jackpot Backend (Off-chain)

This backend runs jackpot logic off-chain without modifying existing smart contracts.

## Guarantees
- No smart contract changes
- On-chain usage only for payment event detection and HEX transfers
- Jackpot logic, win calculation, accrual, and withdrawal flow are server-side
- Math constraints are enforced:
  - `finalWin <= jackpot`
  - `finalWin <= jackpot * 0.5`

## Stack
- Node.js (ESM)
- Express
- Firestore (Firebase Admin SDK)
- ethers.js

## Main files
- `src/db/firestore.js`: Firestore initialization
- `src/db/bootstrap.js`: create default config documents
- `src/chain/listener.js`: payment event listener loop
- `src/chain/listenerOnce.js`: one-shot listener run for Cloud Run Job
- `src/services/jackpotMath.js`: random and payout math
- `src/services/jackpotRepo.js`: Firestore persistence
- `src/services/jackpotService.js`: API service layer
- `src/routes/jackpotRoutes.js`: HTTP routes

## Local setup
```bash
cd backend/jackpot
cp .env.example .env
npm install
npm run bootstrap
npm start
```

Run listener in separate process:
```bash
npm run listener
```

## API
- `GET /jackpot/current`
- `GET /jackpot/public-stats`
- `GET /jackpot/balance?wallet=0x...`
- `GET /jackpot/history?wallet=0x...&limit=50`
- `POST /jackpot/withdraw`

## Firestore collections
- `jackpot_config/default`
- `listener_state/main`
- `merchant_whitelist/{merchantId}`
- `payments/{txHash}`
- `jackpot_rounds/{txHash}`
- `jackpot_wallets/{wallet}`
- `jackpot_claims/{claimId}`
- `payment_rate_limits/{txHash}`
- `users/{wallet}`

## Production deploy
Use Cloud Run + Cloud Scheduler guide:
- `deploy/gcp/README.md`

## Notes
- Set real RPC URL, contract addresses, and secrets in `.env`.
- Register merchant whitelist docs before enabling listener.
- Replace example ABI signature if your payment contract event differs.
