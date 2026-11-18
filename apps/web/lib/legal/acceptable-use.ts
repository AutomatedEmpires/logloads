import type { LegalDocument } from "./types"

/**
 * Acceptable Use Policy, version acceptable-use-2026-11-18 (#329). It replaces the July 6, 2026 text, which called
 * LogLoads "timber hauling coordination" and referred to "active hauls" (legal review §3.3 item 6). It is part of the
 * Terms (§8.1 section 12).
 */
export const acceptableUsePolicy: LegalDocument = {
  slug: "acceptable-use",
  title: "Acceptable Use Policy",
  versionId: "acceptable-use-2026-11-18",
  effectiveDate: "November 18, 2026",
  effectiveDateIso: "2026-11-18",
  review: "draft-for-counsel",
  description:
    "The floor for behavior on LogLoads: honest jobs and profiles, accurate field information, and respectful messages between businesses.",
  intro:
    "LogLoads is for lawful timber-hauling work and honest, respectful messages between businesses. This policy is part of the Terms of Service and sets the floor.",
  sections: [
    {
      title: "Not allowed",
      body: "Do not use LogLoads for:",
      points: [
        "fraud, scams, phishing or misleading anyone, including fake jobs, fake trucks or fake availability",
        "pretending to be another person or business, or submitting false verification evidence",
        "harassment, threats, hate or abusive messages",
        "spam, bulk messages, or collecting other users' contact details",
        "bots, scrapers or other automated access, or testing LogLoads' security without written permission",
        "getting around a limit, a hold or a suspension",
        "anything illegal, including illegal transport work"
      ]
    },
    {
      title: "Accurate field information",
      body: "Do not post directions, road or landing conditions, weights or equipment requirements that you know are wrong or unsafe. Update them when they change, and say plainly when a restriction affects trucks."
    },
    {
      title: "Review and enforcement",
      body: "LogLoads staff review reports, and safety problems are handled first. Depending on how serious a problem is, we may remove content, limit features, or suspend or close an account. You can appeal a decision through the contact page.",
      links: [{ href: "/terms", label: "Read the Terms of Service" }]
    }
  ]
}
