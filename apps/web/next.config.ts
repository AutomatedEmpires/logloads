import type { NextConfig } from "next"

/**
 * Baseline response headers for every route (HF-13, #187).
 *
 * The CSP carries only `frame-ancestors`, so no LogLoads page can be framed by
 * another site, while scripts, styles, workers and connections stay as they
 * are for the map, Clerk, Stripe, PostHog and Sentry. A full CSP is a separate
 * follow-up. `X-Frame-Options` covers browsers without `frame-ancestors`.
 * `Permissions-Policy` turns off device features LogLoads does not use and
 * keeps geolocation for LogLoads itself only.
 */
const securityHeaders = [
	{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{
		key: "Permissions-Policy",
		value: "camera=(), microphone=(), usb=(), browsing-topics=(), geolocation=(self)"
	}
]

const nextConfig: NextConfig = {
	transpilePackages: ["@logloads/contracts", "@logloads/db", "@logloads/services", "@logloads/ui"],
	async headers() {
		return [{ source: "/:path*", headers: securityHeaders }]
	}
}

export default nextConfig
