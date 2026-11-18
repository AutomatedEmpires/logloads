import { TERMS_2026_08_03_PATH, TERMS_2026_11_02_PATH } from "../legal-archive"

import type { LegalDocument } from "./types"

/**
 * Terms of Service, version terms-2026-11-18 (#329), drafted from the outline in docs/legal/2026-11-legal-review.md
 * §8.1. Agent-written and not yet reviewed by a licensed attorney: every "counsel" note is an open point from that
 * review. Changing this text means a new version id and effective date (see ./types.ts), and archiving this one
 * beside the earlier versions in ../legal-archive.ts.
 */
export const termsOfService: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  versionId: "terms-2026-11-18",
  effectiveDate: "November 18, 2026",
  effectiveDateIso: "2026-11-18",
  review: "draft-for-counsel",
  description:
    "The agreement for using LogLoads, the timber-hauling load board: what LogLoads does and does not do, the rules for jobs, profiles and messages, and how these Terms change.",
  intro:
    "These Terms of Service are the agreement between your business and LogLoads for using LogLoads. Section 2 says what LogLoads does not do. Section 4 says how you accept these Terms and how they change.",
  changeNotice: {
    date: "November 18, 2026",
    dateTime: "2026-11-18",
    body: "These Terms were rewritten for the LogLoads load board and replace every earlier version. Section 22 explains what that means for agreements made under an earlier version.",
    link: {
      lead: "Earlier versions stay readable, starting with the",
      href: TERMS_2026_11_02_PATH,
      label: "Terms of Service as changed on November 2, 2026"
    }
  },
  sections: [
    {
      title: "1. Who we are and what LogLoads is",
      body: [
        "LogLoads is operated by AutomatedEmpires (“LogLoads”, “we” or “us”). LogLoads is an online advertising and communication service for timber-hauling work.",
        "Landings are businesses that post timber-hauling jobs because they need log trucks, such as logging contractors, landing operators and mills. Haulers are hauling businesses, from one-truck owner-operators to fleets, that look for that work. A landing and a hauler find each other on LogLoads, talk, and make their own arrangements."
      ],
      counsel: "Confirm the legal name of the operating company, its state of formation and its address for legal notices."
    },
    {
      title: "2. What LogLoads is not",
      body: [
        "LogLoads is not a motor carrier, broker, freight forwarder or dispatcher, and it is not the employer or agent of any user. LogLoads does not arrange transportation, select carriers, negotiate for either side, set rates, handle freight money or become a party to any hauling agreement.",
        "Each user is responsible for its own operating authority, insurance, permits, licences and compliance with the law, including weight limits, cargo securement and road rules."
      ],
      counsel:
        "A transportation attorney should confirm this section against how LogLoads actually works, including targeted invitations and the mix of products hauled, for each state where LogLoads opens."
    },
    {
      title: "3. Who can use LogLoads",
      body: "LogLoads is for businesses. To create an account you must be at least 18, you must be using LogLoads for a business, and you must have the authority to accept these Terms for that business. These Terms then bind both you and the business.",
      points: [
        "Give accurate information about yourself and your business, and keep it current.",
        "Use your own login. Each person on a team has their own account. Do not share a login or let someone else use yours.",
        "Team members act for the organization that added them, within the role it gives them.",
        "Keep your sign-in secure, and tell us at once if you think someone else has used your account."
      ]
    },
    {
      title: "4. Accepting these Terms and changes to them",
      body: [
        "You accept these Terms by ticking the box that says you agree to them, when you create an account or when we ask you to accept a new version. The box is never ticked for you.",
        "Each version of these Terms has a version id and an effective date, shown at the top of this page. If we make a material change, we tell you by email and in LogLoads at least 30 days before it takes effect, and we ask you to accept the new version the next time you sign in after that. Until you accept it, you can still read it and close your account. A change that is not material, such as fixing a typo or a broken link, takes effect when we publish it.",
        "Using LogLoads without accepting a new version does not count as accepting it."
      ],
      counsel: "Confirm which changes count as material, and the 30-day notice period."
    },
    {
      title: "5. Posting jobs",
      body: [
        "If your business posts jobs, the Posting Rules are part of these Terms. In short: every job must be real, current and your own, and must say what it pays and on what basis. You reconfirm each job on schedule. You do not post bait jobs, duplicate jobs, jobs for work outside timber hauling, or jobs recruiting employee drivers.",
        "When you publish a job you confirm three statements, and when you reconfirm it you confirm one. Those statements are part of these Terms, and a false one breaks them."
      ],
      links: [{ href: "/posting-rules", label: "Read the Posting Rules" }]
    },
    {
      title: "6. Rules for haulers and fleets",
      body: [
        "If your business hauls, describe your trucks, equipment, service area and availability accurately, and update your availability when it changes. Availability on LogLoads is what you report. LogLoads does not track trucks or check whether a truck is free.",
        "Your hauler profile is private until you choose to publish it, and you can unpublish it at any time. You can express interest in jobs without publishing a profile.",
        "You alone are responsible for your operating authority, insurance, licences, permits, weight limits and cargo securement, and for deciding whether you can do a job lawfully and safely."
      ]
    },
    {
      title: "7. Your own deals",
      body: [
        "Landings and haulers deal with each other directly. Any agreement to haul is between them, on terms they set, and LogLoads is not a party to it.",
        "LogLoads does not guarantee that a job is real or still open, that a hauler is qualified or available, that anyone will be paid, or how anyone will behave. It does not guarantee road, landing or weather conditions, or any result from using LogLoads. A dispute about a job or a haul, including about pay, damage or delay, is between the users involved. If a posted job turns out not to exist, the claim is against the business that posted it."
      ]
    },
    {
      title: "8. Messages, invitations and contact details",
      body: [
        "Use LogLoads messages, and any phone number or other contact detail another user shares with you, only to discuss the job in question. Do not collect, scrape, copy, sell or republish other users' contact details, send bulk messages, or text, call or email users outside LogLoads to market anything to them.",
        "A landing's phone number is shown to a hauler only after the landing replies to that hauler's interest, and only if the landing has chosen to share it. The landing can stop sharing it at any time.",
        "Targeted invitations go only to haulers who have chosen to receive them, and the landing chooses every hauler it invites.",
        "Authorized LogLoads staff can read messages when a report, a fraud or abuse check, or the law requires it. Each such read is logged. Staff do not read messages for marketing, and do not pass one user's messages on to another user. The Privacy Policy explains more."
      ]
    },
    {
      title: "9. Verification marks and freshness labels",
      body: [
        "A verification mark says what LogLoads reviewed and when, for example “Business identity reviewed by LogLoads · Oct 2026”. It means only that. LogLoads does not check insurance, operating authority, licences, safety records, equipment condition or anyone's ability to do the work. Check these yourself before you agree to a haul. A profile without a mark has simply not been reviewed yet.",
        "Labels such as when a job was last confirmed, or when a truck was reported available, repeat what a user told LogLoads. LogLoads does not confirm them."
      ],
      counsel: "Review the wording of the verification mark and of what this section says the mark does not cover."
    },
    {
      title: "10. Sponsored placement",
      body: "Sponsored placement is not on sale yet. When it is, a promoted job is always labelled Sponsored. Paying buys placement only: it does not promise any number of views, interest, messages or trucks, and it never hides other jobs that match a hauler's search."
    },
    {
      title: "11. Plans and billing",
      body: [
        "Billing is not open. You cannot buy a plan or a Sponsored placement on LogLoads yet. Before any plan or placement goes on sale, we will publish its terms, including the price, renewal, cancellation and refunds, and you will see them before you pay.",
        "For haulers and fleets, finding work, listing trucks and messaging landings will not cost anything. LogLoads will not charge for these core features. We may offer optional paid extras in future, and you would choose whether to buy them."
      ],
      counsel:
        "Draft the full billing terms before any plan is sold, and confirm the wording of the promise that the core hauler and fleet features stay free."
    },
    {
      title: "12. Acceptable use",
      body: "Follow the Acceptable Use Policy, which is part of these Terms. In particular, do not:",
      points: [
        "defraud, mislead or impersonate anyone, including by pretending to be another business",
        "harass, threaten or abuse anyone",
        "use bots, scrapers or other automated tools to access LogLoads or collect its content, apart from search engines that follow our robots rules",
        "test, probe or get around LogLoads' security without our written permission",
        "get around a limit, a hold or a suspension, including by opening another account"
      ],
      links: [{ href: "/acceptable-use", label: "Read the Acceptable Use Policy" }]
    },
    {
      title: "13. Your content and our licence",
      body: [
        "You own what you post: jobs, profiles, photos, messages and other content. You give LogLoads a non-exclusive, worldwide, royalty-free licence to host, store, copy, display and share that content as LogLoads works, for as long as LogLoads keeps it under the Privacy Policy. That includes job share links and the preview cards that link-sharing apps show. We may also use your content to run, secure and improve LogLoads.",
        "You must have the right to post what you post. If you send us feedback or ideas, we may use them without owing you anything."
      ]
    },
    {
      title: "14. Copyright complaints",
      body: [
        "If you believe content on LogLoads infringes your copyright, send a notice to our copyright agent with the details 17 U.S.C. 512(c)(3) requires: your signature, the work, the content and where it is on LogLoads, your contact details, a statement of good-faith belief, and a statement, under penalty of perjury, that the notice is accurate and that you are authorized to act. Send it to support@logloads.com with “Copyright notice” in the subject line.",
        "We remove content when the law requires it, and we close the accounts of users who repeatedly infringe."
      ],
      counsel:
        "Designate the copyright agent with the US Copyright Office under 17 U.S.C. 512(c)(2), and publish the agent's name and address here."
    },
    {
      title: "15. Reports, moderation, suspension and appeals",
      body: [
        "You can report a job, a profile or a message. LogLoads staff review reports. We may hold or remove content, limit features, or suspend or close an account that breaks these Terms or puts other users at risk. When we act on your content or account, we tell you the reason, unless that would put someone at risk or break the law.",
        "You can appeal a decision through the contact page, and a person reviews every appeal. We decide what to act on and when, and we do not promise to act on a particular report within a particular time."
      ]
    },
    {
      title: "16. Disclaimers",
      body: [
        "LogLoads is provided “as is” and “as available”. To the fullest extent the law allows, we disclaim all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, title and non-infringement, and we do not promise that LogLoads will be uninterrupted, error-free or secure.",
        "Maps, distances, routes and weather on LogLoads are estimates from other sources. They are not road, route or safety advice. Confirm road and landing conditions with the business that posted a job before you send a truck."
      ],
      counsel: "Confirm the disclaimer wording for the governing state."
    },
    {
      title: "17. Limit of liability",
      body: [
        "To the fullest extent the law allows, LogLoads is not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, loads, data or goodwill, equipment damage or downtime, arising from or related to LogLoads or these Terms.",
        "To the fullest extent the law allows, LogLoads' total liability for all claims arising from or related to LogLoads or these Terms is limited to the greater of the amount you paid LogLoads in the 12 months before the claim arose and $100.",
        "Nothing in these Terms limits a liability that the law does not allow to be limited."
      ],
      counsel: "Set the fixed floor (this draft uses $100) and the carve-outs the governing state requires."
    },
    {
      title: "18. Indemnity",
      body: "Your business will defend and indemnify LogLoads and its officers, employees and agents against any claim by someone else, and any loss, liability or expense from it, including reasonable legal fees, that arises from your jobs, profiles and other content, your hauling or other work, your dealings with other users, or your breach of these Terms or the law.",
      counsel: "Confirm the scope of the indemnity."
    },
    {
      title: "19. Governing law, venue and disputes",
      body: [
        "Before you start a formal dispute, please contact us through the contact page so we can try to resolve it informally.",
        "The law that governs these Terms, the courts that hear disputes, and whether disputes go to arbitration have not been chosen yet. They will be added to this section after a licensed attorney has reviewed it, as a material change under section 4."
      ],
      counsel:
        "Choose the governing state and the venue, and decide whether to use arbitration and a class-action waiver. If arbitration is used, add an opt-out window and a small-claims exception."
    },
    {
      title: "20. Electronic communications",
      body: [
        "You agree that we can give you notices, agreements and other records electronically, by email or in LogLoads, and that they count as being in writing (15 U.S.C. 7001). Keep the email address on your account current.",
        "Text messages are separate. LogLoads texts you only if you separately agree to receive that kind of text, and the SMS Terms apply to them."
      ],
      links: [{ href: "/sms-terms", label: "Read the SMS Terms" }]
    },
    {
      title: "21. Ending the agreement",
      body: [
        "You can close your account at any time through the contact page. We may suspend or close your account under section 15, or end LogLoads entirely with reasonable notice.",
        "When your account closes, your published jobs and profile come down, and we keep or delete your information as the Privacy Policy describes. Sections 2, 7, 13 (for content we keep), 16, 17, 18, 19, 22 and 23 still apply after this agreement ends."
      ]
    },
    {
      title: "22. Earlier versions",
      body: [
        "These Terms replace the Terms of Service effective August 3, 2026, including the version changed on November 2, 2026, from November 18, 2026. Nothing new accrues under an earlier version after that date, including any fee it described. Agreements made under an earlier version stay on record with the text that applied when they were made.",
        "Accounts that accepted an earlier version are asked to accept these Terms at their next sign-in."
      ],
      links: [
        { href: TERMS_2026_11_02_PATH, label: "Terms of Service as changed on November 2, 2026" },
        { href: TERMS_2026_08_03_PATH, label: "Terms of Service effective August 3, 2026" }
      ],
      counsel:
        "Confirm how these Terms apply to an account that accepted an earlier version until it accepts this one, and whether anything accrued under the per-load fee program that ended on November 2, 2026."
    },
    {
      title: "23. General",
      body: [
        "These Terms, with the Posting Rules, the Acceptable Use Policy and the SMS Terms, are the whole agreement between you and LogLoads about LogLoads. The Privacy Policy explains how we handle information. If a court finds part of these Terms unenforceable, the rest stays in effect. If we do not enforce a term at once, we can still enforce it later.",
        "You may not transfer these Terms without our written consent. We may transfer them to a business that takes over LogLoads.",
        "We send notices to the email address on your account. Send notices to us at support@logloads.com or through the contact page."
      ],
      links: [{ href: "/contact", label: "Contact LogLoads" }]
    }
  ]
}
