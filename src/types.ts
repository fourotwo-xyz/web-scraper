// ── Express Request augmentation (freemium) ─────────────────────────────

declare global {
  namespace Express {
    interface Request {
      freeTier?: boolean;
      freeTierRemaining?: number;
    }
  }
}
