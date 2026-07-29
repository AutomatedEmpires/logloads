import type { MetadataRoute } from "next"

import { resolvePublicAppUrl } from "@/lib/app-url"

export default function robots(): MetadataRoute.Robots {
  const baseUrl = resolvePublicAppUrl()

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
    sitemap: `${baseUrl}/sitemap.xml`
  }
}
