import type { MetadataRoute } from "next"

import { getPublicLoads } from "@/lib/v3"
import { publicLoadHref } from "@/lib/v3-shared"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002"

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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const pages: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    changeFrequency: route.changeFrequency,
    lastModified: now,
    priority: route.priority,
    url: `${BASE_URL}${route.path}`
  }))

  const loadPages: MetadataRoute.Sitemap = getPublicLoads().map((load) => ({
    changeFrequency: "hourly",
    lastModified: now,
    priority: 0.6,
    url: `${BASE_URL}${publicLoadHref(load)}`
  }))

  return [...pages, ...loadPages]
}
