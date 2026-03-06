import { Router } from "express";
import {
  getCurrentJackpot,
  getJackpotPublicStats,
  getUserBalance,
  getUserHistory,
  requestWithdraw,
  adminApproveWithdraw,
  adminRejectWithdraw,
} from "../services/jackpotService.js";
import { validate, walletQuerySchema, withdrawSchema } from "../middleware/validate.js";
import { requireAdmin } from "../middleware/adminAuth.js";

export const jackpotRouter = Router();

jackpotRouter.get("/current", async (_req, res, next) => {
  try {
    const data = await getCurrentJackpot();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

jackpotRouter.get("/public-stats", async (_req, res, next) => {
  try {
    const data = await getJackpotPublicStats();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

jackpotRouter.get("/balance", validate(walletQuerySchema), async (req, res, next) => {
  try {
    const wallet = req.validated.query.wallet;
    const data = await getUserBalance(wallet);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

jackpotRouter.get("/history", validate(walletQuerySchema), async (req, res, next) => {
  try {
    const wallet = req.validated.query.wallet;
    const limit = req.validated.query.limit ?? 50;
    const data = await getUserHistory(wallet, limit);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

jackpotRouter.post("/withdraw", validate(withdrawSchema), async (req, res, next) => {
  try {
    const { wallet, amountHex } = req.validated.body;
    const data = await requestWithdraw({ wallet, amountHex });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

jackpotRouter.post("/claims/:id/approve", requireAdmin, async (req, res, next) => {
  try {
    const claimId = String(req.params.id || "").trim();
    if (!claimId) throw new Error("VALIDATION_ERROR");
    const data = await adminApproveWithdraw({ claimId });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

jackpotRouter.post("/claims/:id/reject", requireAdmin, async (req, res, next) => {
  try {
    const claimId = String(req.params.id || "").trim();
    if (!claimId) throw new Error("VALIDATION_ERROR");
    const data = await adminRejectWithdraw({ claimId });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});
