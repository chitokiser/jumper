import { config } from "../config.js";

export function requireAdmin(req, _res, next) {
  if (!config.adminApiKey) {
    return next(new Error("ADMIN_KEY_NOT_CONFIGURED"));
  }

  const token = req.headers["x-admin-key"];
  if (token !== config.adminApiKey) {
    return next(new Error("ADMIN_UNAUTHORIZED"));
  }

  return next();
}
