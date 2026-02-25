/**
 * Freemium Gate Middleware
 *
 * ── How it works ────────────────────────────────────────────────────────
 *
 *   Every caller is identified by the `x-wallet-address` header that
 *   x402-enabled clients send automatically.
 *
 *   The first FREE_TIER_LIMIT calls (default: 2) from any unique wallet
 *   bypass the x402 payment middleware entirely — the idea is to let
 *   potential customers taste the product before paying.
 *
 *   After the free quota is exhausted the request falls through to the
 *   next middleware, which is the x402 paymentMiddleware that will
 *   return a 402 Payment Required response if no valid payment header
 *   is attached.
 *
 *   We use an in-process Map as the store.  This is intentional:
 *   - It resets on restart → users get new free credits periodically.
 *   - No external dependency (Redis, DB) needed for a v1.
 */

import type { Request, Response, NextFunction } from "express";

type MiddlewareFn = (req: Request, res: Response, next: NextFunction) => void;

const FREE_TIER_LIMIT = 2;
const walletUsage = new Map<string, number>();

export function freemiumGate(paymentMiddlewareFn: MiddlewareFn): MiddlewareFn {
  return (req: Request, res: Response, next: NextFunction) => {
    const wallet = ((req.headers["x-wallet-address"] as string) ?? "").toLowerCase().trim();

    // Fall back to IP when no wallet header is present (e.g. browser calls)
    const callerId = wallet || req.ip || req.socket.remoteAddress || "unknown";

    const used = walletUsage.get(callerId) ?? 0;

    if (used < FREE_TIER_LIMIT) {
      walletUsage.set(callerId, used + 1);
      req.freeTier = true;
      req.freeTierRemaining = FREE_TIER_LIMIT - used - 1;
      return next();
    }

    return paymentMiddlewareFn(req, res, next);
  };
}
