import { db, Timestamp } from "./firestore.js";
import { config } from "../config.js";
import { toWei } from "../utils/units.js";
import { logger } from "../utils/logger.js";

async function bootstrap() {
  await db.collection("jackpot_config").doc("default").set(
    {
      enabled: config.defaults.enabled,
      payoutScale: config.defaults.payoutScale.toString(),
      maxWinPercent: config.defaults.maxWinPercent,
      minPaymentWei: toWei(config.defaults.minPaymentHex).toString(),
      minClaimWei: toWei(config.defaults.minClaimHex).toString(),
      dailyMaxPayoutWei: toWei(config.defaults.dailyMaxPayoutHex).toString(),
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );

  await db.collection("listener_state").doc("main").set(
    {
      lastScannedBlock: 0,
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );

  logger.info("firestore bootstrap completed");
}

bootstrap().catch((err) => {
  logger.error({ err }, "firestore bootstrap failed");
  process.exit(1);
});
