import type { NextConfig } from "next"

type Environment = Readonly<Record<string, string | undefined>>

/*
 * The full Content-Security-Policy, sent in report-only mode (HF-13, #187).
 *
 * The browser checks every page against it and logs each violation to the
 * console, but blocks nothing. There is no `report-uri` or `report-to`, so no
 * report leaves the browser. The enforcement plan is in `docs/SECURITY.md` §2.1.
 *
 * The allowed origins are what LogLoads actually loads in the browser:
 * - Next.js: its own bundles, plus inline bootstrap scripts and inline styles.
 *   A static header cannot carry a per-request nonce, so `'unsafe-inline'`
 *   stays until the policy moves into middleware (enforcement step 3).
 * - Fonts: `next/font/google` downloads Inter and Archivo at build time and
 *   serves them from `/_next/static/media`, so Google's font hosts are never
 *   contacted from the browser. The V2 IBM Plex fonts are self-hosted too.
 * - Maps: MapLibre's worker is served from `/vendor`, and the CARTO basemap
 *   (style, tiles, sprites, glyphs) is fetched from `*.basemaps.cartocdn.com`.
 *   Map canvases use `blob:` and `data:` images. The legacy Mapbox renderer
 *   starts `blob:` workers, and its hosts are allowed only when its token is set.
 * - Clerk: the Frontend API host (read from the publishable key) serves
 *   clerk-js and its API, `img.clerk.com` its images, and Cloudflare Turnstile
 *   its bot check.
 * - Stripe: Stripe.js and the Payment Element's frames, for card setup.
 * - Supabase Storage: signed uploads go from the browser straight to the media
 *   project. The host is a wildcard so the project reference is not published
 *   in a header on every anonymous response.
 * - PostHog: the ingestion host, only when analytics is configured. PostHog's
 *   external scripts are switched off (`disable_external_dependency_loading`).
 * - Sentry runs on the server only, so it needs no browser origin.
 *
 * Next.js computes these headers when it builds, so the Clerk, PostHog and
 * Mapbox entries come from the build environment.
 */
const STRIPE_SCRIPT_ORIGINS = ["https://js.stripe.com", "https://*.js.stripe.com"]
const STRIPE_FRAME_ORIGINS = ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"]
const CARTO_ORIGINS = ["https://basemaps.cartocdn.com", "https://*.basemaps.cartocdn.com"]
const MAPBOX_ORIGINS = ["https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com"]
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com"
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"

/** Clerk's Frontend API origin. A publishable key is `pk_<env>_` + base64 of `<host>$`. */
export function clerkFrontendApiOrigin(publishableKey: string | undefined): string | null {
	const encoded = /^pk_(?:test|live)_([A-Za-z0-9+/=]+)$/.exec(publishableKey?.trim() ?? "")?.[1]

	if (!encoded) {
		return null
	}

	const decoded = Buffer.from(encoded, "base64").toString("utf8")
	const host = decoded.endsWith("$") ? decoded.slice(0, -1).toLowerCase() : ""

	return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ? `https://${host}` : null
}

function httpsOrigin(value: string | undefined): string | null {
	try {
		const url = new URL(value ?? "")

		return url.protocol === "https:" ? url.origin : null
	} catch {
		return null
	}
}

export function contentSecurityPolicyReportOnly(environment: Environment = process.env): string {
	const development = environment.NODE_ENV === "development"
	const clerk = clerkFrontendApiOrigin(environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
	const posthog = environment.NEXT_PUBLIC_POSTHOG_KEY?.trim()
		? httpsOrigin(environment.NEXT_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST)
		: null
	const mapbox = environment.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ? MAPBOX_ORIGINS : []

	const directives: Array<[string, Array<string | null | false>]> = [
		["default-src", ["'self'"]],
		["base-uri", ["'self'"]],
		["object-src", ["'none'"]],
		["frame-ancestors", ["'none'"]],
		["form-action", ["'self'"]],
		[
			"script-src",
			[
				"'self'",
				"'unsafe-inline'",
				// `next dev` evaluates its modules; a production build does not.
				development && "'unsafe-eval'",
				...STRIPE_SCRIPT_ORIGINS,
				clerk,
				clerk && TURNSTILE_ORIGIN
			]
		],
		["style-src", ["'self'", "'unsafe-inline'"]],
		["img-src", ["'self'", "data:", "blob:", clerk && "https://img.clerk.com"]],
		["font-src", ["'self'", "data:"]],
		[
			"connect-src",
			[
				"'self'",
				// `next dev` hot reload.
				development && "ws:",
				development && "wss:",
				...CARTO_ORIGINS,
				...mapbox,
				"https://*.supabase.co",
				"https://api.stripe.com",
				clerk,
				clerk && "https://clerk-telemetry.com",
				posthog
			]
		],
		["worker-src", ["'self'", "blob:"]],
		["child-src", ["'self'", "blob:"]],
		["frame-src", [...STRIPE_FRAME_ORIGINS, clerk && TURNSTILE_ORIGIN]],
		["manifest-src", ["'self'"]]
	]

	return directives
		.map(([name, sources]) =>
			[name, ...sources.filter((source): source is string => Boolean(source))].join(" ")
		)
		.join("; ")
}

/**
 * Baseline response headers for every route (HF-13, #187).
 *
 * The enforced CSP carries only `frame-ancestors`, so no LogLoads page can be
 * framed by another site, while scripts, styles, workers and connections stay
 * as they are. The full policy rides alongside it in report-only mode.
 * `X-Frame-Options` covers browsers without `frame-ancestors`.
 * `Permissions-Policy` turns off device features LogLoads does not use and
 * keeps geolocation for LogLoads itself only.
 */
const securityHeaders = [
	{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
	{ key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicyReportOnly() },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{
		key: "Permissions-Policy",
		value: "camera=(), microphone=(), usb=(), browsing-topics=(), geolocation=(self)"
	}
]

const nextConfig: NextConfig = {
	// postgres.js (the normalized marketplace store, lib/marketplace-v2/normalized-db.ts) is loaded from node_modules
	// rather than bundled. Bundled, the minified server build renames its PostgresError class, whose `name` is how the
	// adapter tells a database refusal ("This job is no longer accepting interest") from a failure, so every refusal
	// reached the page as the generic "could not complete this request" (found by the #140 loop under `next start`).
	serverExternalPackages: ["postgres"],
	transpilePackages: ["@logloads/contracts", "@logloads/db", "@logloads/services", "@logloads/ui"],
	async headers() {
		return [{ source: "/:path*", headers: securityHeaders }]
	}
}

export default nextConfig
