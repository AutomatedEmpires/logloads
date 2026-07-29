import type { MetadataRoute } from "next"

import { resolvePublicAppUrl } from "@/lib/app-url"
import { getPublicLoads } from "@/lib/v3"
import { publicLoadHref } from "@/lib/v3-shared"

const staticRoutes: Array<{ path: string; priority: number; changeFrequency: "hourly" | "daily" | "weekly" | "monthly" }> = [
  { changeFrequency: "hourly", path: "/", priority: 1 },
  { changeFrequency: "hourly", path: "/loads", priority: 0.9 },
  { changeFrequency: "monthly", path: "/how-it-works", priority: 0.8 },
  { changeFrequency: "monthly", path: "/for-haulers", priority: 0.8 },
  { changeFrequency: "monthly", path: "/for-fleets", priority: 0.8 },
  { changeFrequency: "monthly", path: "/for-landings", priority: 0.8 },
  { changeFrequency: "monthly", path: "/pricing", priority: 0.7 },
  { changeFrequency: "monthly", path: "/about", priority: 0.5 },
  { changeFrequency: "monthly", path: "/trust", priority: 0.5 },
  { changeFrequency: "monthly", path: "/contact", priority: 0.5 },
  { changeFrequency: "monthly", path: "/terms", priority: 0.3 },
  { changeFrequency: "monthly", path: "/privacy", priority: 0.3 },
  { changeFrequency: "monthly", path: "/marketplace-rules", priority: 0.3 },
  { changeFrequency: "monthly", path: "/acceptable-use", priority: 0.3 }
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const baseUrl = resolvePublicAppUrl()

  const pages: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    changeFrequency: route.changeFrequency,
    lastModified: now,
    priority: route.priority,
    url: `${baseUrl}${route.path}`
  }))

  const loadPages: MetadataRoute.Sitemap = (await getPublicLoads()).map((load) => ({
    changeFrequency: "hourly",
    lastModified: now,
    priority: 0.6,
    url: `${baseUrl}${publicLoadHref(load)}`
  }))

  return [...pages, ...loadPages]
}
