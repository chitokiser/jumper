import { z } from "zod";

export function validate(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse({
      query: req.query,
      body: req.body,
      params: req.params,
      headers: req.headers,
    });

    if (!parsed.success) {
      const err = new Error("VALIDATION_ERROR");
      err.details = parsed.error.flatten();
      return next(err);
    }

    req.validated = parsed.data;
    return next();
  };
}

export const walletQuerySchema = z.object({
  query: z.object({
    wallet: z.string().min(42),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }),
  body: z.any(),
  params: z.any(),
  headers: z.any(),
});

export const withdrawSchema = z.object({
  query: z.any(),
  params: z.any(),
  headers: z.any(),
  body: z.object({
    wallet: z.string().min(42),
    amountHex: z.union([z.number(), z.string()]),
  }),
});
