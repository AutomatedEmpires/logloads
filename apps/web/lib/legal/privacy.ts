import type { LegalDocument } from "./types"

/**
 * Privacy Policy, version privacy-2026-11-18 (#329), drafted from docs/legal/2026-11-legal-review.md §6 and §8.2.
 * Agent-written and not yet reviewed by a licensed attorney. A privacy policy is a public promise (FTC Act §5), so
 * every statement here must stay true of the product: change the product or this text, never only one of them.
 *
 * Statements that depend on work still open before the pilot opens: the retention schedule (#342), the request
 * path (#343), the consent screen and ledger for texts (#291), and verification intake rejecting identity numbers.
 */
export const privacyPolicy: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  versionId: "privacy-2026-11-18",
  effectiveDate: "November 18, 2026",
  effectiveDateIso: "2026-11-18",
  review: "draft-for-counsel",
  description:
    "What LogLoads collects, what is public and what stays private, who we share information with, how long we keep it, and how to ask for a copy or a deletion.",
  intro:
    "This Privacy Policy explains what information LogLoads collects, how we use and share it, how long we keep it, and the choices you have. LogLoads is a timber-hauling load board for businesses, and this policy covers everyone who uses it.",
  sections: [
    {
      title: "Who is responsible",
      body: "AutomatedEmpires operates LogLoads and is responsible for the information described here. Contact us about privacy at support@logloads.com or through the contact page.",
      links: [{ href: "/contact", label: "Contact LogLoads" }],
      counsel: "Confirm the legal name and postal address of the operating company."
    },
    {
      title: "What we collect",
      body: "We collect:",
      points: [
        "Account and organization details: names, email addresses, phone numbers, business names, roles and team membership.",
        "Landings and jobs: landing locations and access details, and job details such as pay and its basis, product, equipment, dates and truck counts.",
        "Equipment and availability: trucks, trailers, service areas and the availability you report.",
        "Interest, messages and reports: what you send other users through LogLoads, and reports you file.",
        "Verification evidence: documents and details you submit so we can review your business identity. We do not ask for Social Security numbers, driver's licence images or bank details. If a document shows one, we reject it and ask you to cover the number and upload it again.",
        "Phone number and text consent: when you add a mobile number, the code that confirms it is yours and the kinds of texts you agreed to receive.",
        "Device and usage data: IP address, browser and device type, pages visited, and records of activity and errors.",
        "Cookies and similar browser storage: to keep you signed in and secure, and for product measurement unless your browser sends Do Not Track or Global Privacy Control.",
        "Support requests: what you tell us when you contact us."
      ]
    },
    {
      title: "What we do not collect",
      body: "LogLoads does not read your device's GPS location, track trucks or loads, or collect scale tickets or freight payments. The locations LogLoads holds are the landings, service areas and search areas that users enter."
    },
    {
      title: "Where information comes from",
      body: "Most of it comes from you. Some comes from your organization, for example when a teammate adds you or edits a shared profile. Some comes from other users, for example an invitation a landing sends you or a report about a job. Some comes from the providers that run LogLoads for us, for example the sign-in details our identity provider confirms."
    },
    {
      title: "What is public and what stays private",
      body: "Who can see something depends on what it is:",
      closing:
        "When you unpublish a job or a profile it comes off LogLoads, but a copy can outlive it elsewhere: someone may have saved or shared a link, a link-sharing app may already have made a preview card, and a search engine may still show a cached copy for a while.",
      points: [
        "Public to anyone, including search engines: published jobs, with the job's approximate area rather than the exact landing location, pay and its basis, product, equipment, dates, truck counts and the posting business's display name.",
        "Shown to other users, and to anyone with a link to it: a hauler profile its business chooses to publish, with the business name, service area, equipment and reported availability. A hauler profile stays private until its business publishes it, and can be unpublished at any time.",
        "Shown only to a hauler a landing has replied to, and only if the landing chooses: that landing's phone number, and the exact location and access details for the job.",
        "Seen only by the businesses in a conversation: interest, replies and messages.",
        "Private to your organization, and to LogLoads staff with a reason: drafts, team membership, verification evidence, your phone number and text consent, and your settings.",
        "Never on any public page: users' phone numbers and email addresses, exact landing locations, gate codes and private road directions."
      ]
    },
    {
      title: "How we use information",
      body: "We use information to:",
      points: [
        "run LogLoads: accounts, jobs, profiles, interest, messages and the notices you ask for",
        "send notifications: email and in-app notices, and texts only if you agreed to them",
        "keep LogLoads safe: reviewing businesses, preventing fraud, spam and contact harvesting, handling reports, and securing accounts",
        "measure and improve LogLoads, using events that carry no names, email addresses, phone numbers or message text",
        "meet our legal duties, enforce our Terms, and respond to valid legal process"
      ]
    },
    {
      title: "Staff access to messages",
      body: "Messages are private to the businesses in the conversation. LogLoads staff with a support or trust role can read them only to investigate a report, to prevent fraud or abuse, or when the law requires it. Each such read is logged. Staff never read messages for marketing, and never pass one user's messages on to another user: someone who reports a message learns the outcome, not the other side's words. We give messages to anyone outside LogLoads only when the law allows it, such as in response to valid legal process."
    },
    {
      title: "Text messages",
      body: [
        "LogLoads does not send text messages yet. When it does, it will text you only the kinds of messages you agreed to, each chosen with its own box that is never ticked for you. Agreeing to texts is never a condition of using LogLoads.",
        "Reply STOP to any LogLoads text to stop all texts, or HELP for help.",
        "Mobile numbers and SMS consent are not shared with third parties for their marketing.",
        "We keep a record of each consent, text and opt-out for 5 years after the last text to that number, even if you close your account, because that record shows each text was wanted."
      ],
      links: [{ href: "/sms-terms", label: "Read the SMS Terms" }]
    },
    {
      title: "Email",
      body: "Some emails are needed to run your account, such as sign-in, security and account notices. Others are optional, such as job alerts and product news. Every optional email has an unsubscribe link that works without signing in, and you can change your email choices in your settings."
    },
    {
      title: "Who we share information with",
      body: "We share information only:",
      closing: "We do not sell personal information, and we do not share it for cross-context advertising.",
      points: [
        "with other users, as you direct: what you publish, and what you send to a business",
        "with the providers that run LogLoads for us, each for its own purpose, listed in the next section",
        "with authorities or other parties when valid legal process or the law requires it, or to protect someone from harm",
        "with a buyer or successor if LogLoads is sold or merged, who must keep to this policy"
      ]
    },
    {
      title: "Our providers",
      body: "These providers handle information for LogLoads, each only to provide its service to us:",
      points: [
        "Clerk: sign-in and account security.",
        "Supabase: our database, and private file storage for documents such as verification evidence.",
        "Vercel: hosting for the LogLoads website.",
        "Resend: sending LogLoads email.",
        "PostHog: product measurement, with no names, email addresses, phone numbers or message text. It does not load in a browser that sends Do Not Track or Global Privacy Control.",
        "Sentry: error monitoring, set up not to collect IP addresses, cookies or the contents of requests.",
        "CARTO: map tiles, drawn from OpenStreetMap data. Your browser loads map tiles straight from CARTO, so CARTO receives your IP address and the map area you view. Where CARTO is not set up, an older map view can load its tiles from Mapbox instead, which then receives the same.",
        "Open-Meteo: weather for a job's area. LogLoads asks for it from our own servers, so Open-Meteo does not receive your IP address or account details.",
        "Stripe: payments, once billing opens, and the payment records of the earlier program described below.",
        "A text-message provider, which we will name here before LogLoads sends its first text."
      ],
      counsel: "Confirm that each provider's terms or data processing agreement limit its use of the information as this section says."
    },
    {
      title: "Email addresses are not for sale",
      body: "LogLoads will not give, sell or otherwise transfer the email addresses it holds to any other party for that party to send, or help others send, email. Our email provider uses addresses only to deliver LogLoads' own email."
    },
    {
      title: "How long we keep information",
      body: "We keep information only as long as this schedule allows:",
      closing:
        "We may keep information longer when the law requires it, to resolve a dispute, or under a legal hold. The section on earlier programs covers the records of the per-load fee program that ended on November 2, 2026.",
      points: [
        "Account and organization profile: while the account is open. Deleted or anonymized 30 days after you ask us to delete it.",
        "Jobs and landings: while the account is open, and a closed job for 24 months after it closes.",
        "Exact landing locations, gate codes and access notes: while the job is active, plus 90 days.",
        "Messages and interest: while both accounts are open, plus 12 months, unless they are part of a report or a legal hold.",
        "Verification documents: 90 days after the review decision. We keep a record of the decision: its type, source, date and reviewer.",
        "Notification records: their contents are cleared 30 days after sending, and the record is deleted after 13 months. An in-app notice you have not dismissed stays until you close your account.",
        "Text consent and text records: 5 years after the last text to that number.",
        "Email unsubscribes and bounces: kept as a one-way code instead of the address itself, for as long as we send email, so we keep honoring them.",
        "Publish and reconfirm confirmations: while the job exists, plus 4 years.",
        "Records of accepting the Terms: while the account is open, plus 6 years.",
        "Records of staff actions: 3 years.",
        "Measurement events: 25 months, after which only totals are kept.",
        "Security logs: 12 months.",
        "Backups: up to 35 days."
      ],
      counsel: "Confirm these periods, in particular the 6 years for records of accepting the Terms."
    },
    {
      title: "Your choices and rights",
      body: [
        "You can ask for a copy of your information, or ask us to correct, export or delete it. You can also unpublish your hauler profile or a job at any time. To ask, email support@logloads.com or use the contact page. We check that a request comes from you, or from someone your organization authorized, before we release or change anything, and we answer within 45 days.",
        "Some information stays after a deletion request: the text and Terms records described above, anything under a report or a legal hold, and records the law requires us to keep.",
        "California residents: LogLoads does not sell or share personal information, as California law uses those words. You can make the requests above wherever you live.",
        "Do Not Track and Global Privacy Control: if your browser sends either signal, LogLoads does not load its measurement tool in that browser."
      ]
    },
    {
      title: "Security",
      body: "We protect information with access controls, encryption in transit, logged staff access and limits on who can see private details. No system is perfectly secure, and we cannot promise that information will never be accessed without permission. If a breach affects your information, we will tell you, and the authorities where the law requires it, without unreasonable delay."
    },
    {
      title: "Earlier programs",
      body: [
        "Until November 2, 2026, LogLoads offered a program in which a landing agreed to pay LogLoads a fee for each completed load. That program has ended. We keep its billing records, including fee agreements and their acceptance, invoices, Stripe payment references and the related security records, so we can account for them, answer disputes, and meet tax and legal duties. Access to them is limited, and they are used for nothing else.",
        "Billing is not open now. If LogLoads starts selling plans or Sponsored placement, Stripe will process the payments, and LogLoads will store payment references and invoice history but never full card numbers."
      ],
      counsel: "Confirm the minimum retention period for these records. Until it is set, none of them is deleted."
    },
    {
      title: "Children",
      body: "LogLoads is for businesses and is not directed at children. Accounts are only for people 18 or older acting for a business. We do not knowingly collect information from anyone under 18, and we delete it if we learn we have."
    },
    {
      title: "Changes to this policy",
      body: "Each version of this policy has a version id and an effective date, shown at the top of this page. If we change it in a way that matters to you, we tell you by email and in LogLoads at least 30 days before the change takes effect."
    }
  ]
}
