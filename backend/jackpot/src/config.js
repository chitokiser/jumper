import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8787),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  CHAIN_ID: z.coerce.number(),
  RPC_URL: z.string().url(),
  PAYMENT_CONTRACT_ADDRESS: z.string().min(42),
  HEX_TOKEN_ADDRESS: z.string().min(42),
  PAYMENT_EVENT_NAME: z.string().default("PaidHex"),
  HEX_DECIMALS: z.coerce.number().default(18),
  CONFIRMATIONS: z.coerce.number().default(1),
  START_BLOCK: z.coerce.number().default(0),
  POLL_INTERVAL_MS: z.coerce.number().default(8000),
  JACKPOT_HMAC_SECRET: z.string().min(16),
  ADMIN_EXCLUDED_ADDRESSES: z.string().default(""),
  SELF_PAYMENT_BLOCK: z.string().default("true"),
  REPEAT_LIMIT_PER_10MIN: z.coerce.number().default(20),
  DEFAULT_ENABLED: z.string().default("true"),
  DEFAULT_PAYOUT_SCALE: z.coerce.number().default(100000),
  DEFAULT_MAX_WIN_PERCENT: z.coerce.number().default(50),
  DEFAULT_MIN_PAYMENT_HEX: z.coerce.number().default(0),
  DEFAULT_MIN_CLAIM_HEX: z.coerce.number().default(30),
  DEFAULT_DAILY_MAX_PAYOUT_HEX: z.coerce.number().default(50000),
  HOT_WALLET_PRIVATE_KEY: z.string().optional(),
  AUTO_APPROVE_WITHDRAW: z.string().default("false"),
  WITHDRAW_GAS_LIMIT: z.coerce.number().default(120000),
  ADMIN_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
const parseBool = (v) => String(v).toLowerCase() === "true";

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  firebase: {
    projectId: env.FIREBASE_PROJECT_ID || "",
    clientEmail: env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    storageBucket: env.FIREBASE_STORAGE_BUCKET || "",
  },
  chainId: env.CHAIN_ID,
  rpcUrl: env.RPC_URL,
  paymentContractAddress: env.PAYMENT_CONTRACT_ADDRESS,
  hexTokenAddress: env.HEX_TOKEN_ADDRESS,
  paymentEventName: env.PAYMENT_EVENT_NAME,
  hexDecimals: env.HEX_DECIMALS,
  confirmations: env.CONFIRMATIONS,
  startBlock: env.START_BLOCK,
  pollIntervalMs: env.POLL_INTERVAL_MS,
  jackpotHmacSecret: env.JACKPOT_HMAC_SECRET,
  adminExcludedAddresses: env.ADMIN_EXCLUDED_ADDRESSES.split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
  selfPaymentBlock: parseBool(env.SELF_PAYMENT_BLOCK),
  repeatLimitPer10Min: env.REPEAT_LIMIT_PER_10MIN,
  defaults: {
    enabled: parseBool(env.DEFAULT_ENABLED),
    payoutScale: BigInt(env.DEFAULT_PAYOUT_SCALE),
    maxWinPercent: Number(env.DEFAULT_MAX_WIN_PERCENT),
    minPaymentHex: Number(env.DEFAULT_MIN_PAYMENT_HEX),
    minClaimHex: Number(env.DEFAULT_MIN_CLAIM_HEX),
    dailyMaxPayoutHex: Number(env.DEFAULT_DAILY_MAX_PAYOUT_HEX),
  },
  hotWalletPrivateKey: env.HOT_WALLET_PRIVATE_KEY,
  autoApproveWithdraw: parseBool(env.AUTO_APPROVE_WITHDRAW),
  withdrawGasLimit: env.WITHDRAW_GAS_LIMIT,
  adminApiKey: env.ADMIN_API_KEY || "",
};
