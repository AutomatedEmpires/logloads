import type { LegalDocument } from "./types"

/**
 * Posting Rules, version posting-rules-2026-11-18 (#329). They replace the Marketplace Rules of July 6, 2026, which
 * told users to "commit through LogLoads" (legal review §8.0 item 2), and are part of the Terms (§8.1 section 5).
 *
 * The confirmation statements and the reconfirmation days are written out here, because this is versioned text,
 * and a test pins them to `@logloads/contracts` (ATT-2 and the #308 cadence). If either side changes, change both
 * and publish a new version.
 */
export const postingRules: LegalDocument = {
  slug: "posting-rules",
  title: "Posting Rules",
  versionId: "posting-rules-2026-11-18",
  effectiveDate: "November 18, 2026",
  effectiveDateIso: "2026-11-18",
  review: "draft-for-counsel",
  description:
    "The rules for posting a job on LogLoads: real, current timber-hauling work, with its pay and basis stated, reconfirmed on schedule.",
  intro:
    "These rules apply to every job posted on LogLoads, and they are part of the Terms of Service. They keep the job list worth reading: real work, stated plainly, kept current.",
  sections: [
    {
      title: "Post only real jobs",
      body: "Every job must be real, current and your own: work your business needs trucks for now, at a landing your business runs or is authorized to recruit for.",
      points: [
        "No bait jobs: never post a job to collect interest or contact details for some other purpose.",
        "No duplicate jobs: post each job once, and edit it when it changes.",
        "No jobs for another business, unless that business authorized you to recruit for it."
      ]
    },
    {
      title: "Timber hauling only",
      body: "Post only timber-hauling work: moving saw logs, hardwood logs, pulpwood, poles and pilings, chips, hog fuel and biomass, and other forest products by truck. Do not post other freight, or work that is not hauling timber.",
      points: [
        "If your product is not on the list, choose Other and describe it.",
        "LogLoads only advertises the job. You and the hauler are responsible for any operating authority the haul needs."
      ]
    },
    {
      title: "No employee driver jobs",
      body: "LogLoads lists work for hauling businesses: owner-operators and fleets that bring their own trucks. Do not post a job to hire an employee driver, such as a W-2 driver position, or for any other employment. This rule stays until the law on employment advertising has been reviewed for LogLoads."
    },
    {
      title: "State the pay and its basis",
      body: "Every job must say what it pays and on what basis, for example per load, per ton, per mile or per hour. If the pay is negotiable, say how it is set. Pay, equipment and dates must be accurate when you publish and stay accurate while the job is open. If they change, edit the job."
    },
    {
      title: "Confirm what you publish",
      body: "When you publish a job, you confirm these three statements. Each is a promise to the haulers who read the job, and to LogLoads:",
      points: [
        "This is a real job at [landing name], which is recruiting now.",
        "Pay, equipment and dates are accurate today.",
        "We'll update or pause it when we no longer need trucks."
      ],
      closing: "Publishing is subject to these Posting Rules. A false statement breaks the Terms of Service."
    },
    {
      title: "Reconfirm on schedule",
      body: [
        "A job stays in Find Work only while you keep confirming it. LogLoads reminds you on day 5 after your last confirmation. From day 7, haulers see when you last confirmed the job. After 14 days without a confirmation, the job leaves Find Work and takes no new interest until you confirm it again with this statement: “I confirm this job is currently available as described.”",
        "When the job no longer needs trucks, pause or close it."
      ]
    },
    {
      title: "Keep private details private",
      body: "Do not put phone numbers, email addresses, links, gate codes or exact directions in a job's public text. Keep access details in the landing's private details. A hauler sees them only after you reply to that hauler and choose to share them."
    },
    {
      title: "When a job breaks these rules",
      body: "LogLoads may hold or remove a job that breaks these rules, and may limit or suspend the business that posted it, as the Terms of Service describe. Repeated or evasive reposting can put a hold on all of a business's publishing. The business is told the reason, and can appeal through the contact page.",
      links: [{ href: "/terms", label: "Read the Terms of Service" }]
    }
  ]
}
