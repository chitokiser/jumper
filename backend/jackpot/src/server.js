import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "jackpot api started");
});

function shutdown(signal) {
  logger.info({ signal }, "graceful shutdown start");
  server.close(() => {
    logger.info("server closed");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
