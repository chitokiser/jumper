import { runListenerOnce } from "./listener.js";
import { logger } from "../utils/logger.js";

runListenerOnce()
  .then(() => {
    logger.info("listener once completed");
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "listener once failed");
    process.exit(1);
  });
