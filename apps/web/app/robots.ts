import type { MetadataRoute } from "next"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        allow: "/",
        disallow: [
          "/admin",
          "/api",
          "/driver",
          "/fleet",
          "/host",
          "/onboarding",
          "/sign-in",
          "/sign-up",
          "/support"
        ],
        userAgent: "*"
      }
    ],
    sitemap: `${BASE_URL}/sitemap.xml`
  }
}
