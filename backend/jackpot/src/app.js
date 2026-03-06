import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { jackpotRouter } from "./routes/jackpotRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logger } from "./utils/logger.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({ logger })
  );

  app.use(
    "/jackpot",
    rateLimit({ windowMs: 60 * 1000, limit: 120 }),
    jackpotRouter,
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(errorHandler);

  return app;
}
