export interface MarketplaceV2Environment {
  LOGLOADS_MARKETPLACE_V2?: string
  VERCEL_ENV?: string
}

/**
 * Marketplace V2 (the Blueprint v1.0 load board) is an explicit development preview. It renders only
 * when `LOGLOADS_MARKETPLACE_V2=enabled`, and never on a hosted production deployment, so the pilot
 * keeps working unchanged until V2 is deliberately launched.
 */
export function marketplaceV2Enabled(
  environment: MarketplaceV2Environment = {
    LOGLOADS_MARKETPLACE_V2: process.env.LOGLOADS_MARKETPLACE_V2,
    VERCEL_ENV: process.env.VERCEL_ENV
  }
): boolean {
  return environment.LOGLOADS_MARKETPLACE_V2?.trim().toLowerCase() === "enabled" && environment.VERCEL_ENV !== "production"
}
