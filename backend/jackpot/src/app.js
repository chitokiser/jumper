import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { jackpotRouter } from "./routes/jackpotRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logger } from "./utils/logger.js";
import { db } from "./db/firestore.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
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

  app.get("/health", async (_req, res) => {
    let firestoreOk = false;
    let firestoreError = null;
    try {
      await db.collection("jackpot_config").doc("default").get();
      firestoreOk = true;
    } catch (e) {
      firestoreError = e.message || String(e);
    }
    res.json({ ok: firestoreOk, firestore: firestoreOk ? "ok" : "error", firestoreError });
  });

  app.use(errorHandler);

  return app;
}
