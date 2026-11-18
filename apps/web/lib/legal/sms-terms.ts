import type { LegalDocument } from "./types"

/**
 * SMS Terms, version sms-terms-2026-11-18 (#329), from docs/legal/2026-11-legal-review.md §4 and §8.1. The send
 * budget is capped at 0 (founder decision, 2026-11-10), so no text is sent; this page exists first because carrier
 * registration needs a public SMS terms page and the consent screen (#291) links it.
 *
 * Before the first text: the weekly limit for each kind of text must be stated, the text-message provider named in
 * the Privacy Policy, and counsel's sign-off recorded (legal review §4.4 items 8 and 9).
 */
export const smsTerms: LegalDocument = {
  slug: "sms-terms",
  title: "SMS Terms",
  versionId: "sms-terms-2026-11-18",
  effectiveDate: "November 18, 2026",
  effectiveDateIso: "2026-11-18",
  review: "draft-for-counsel",
  description:
    "How LogLoads Alerts text messages work: the kinds you can choose, how often they come, and how to stop them with STOP or get help with HELP.",
  intro:
    "These terms cover text messages from LogLoads, and they are part of the Terms of Service. LogLoads does not send text messages yet. These terms apply from the first text it sends.",
  sections: [
    {
      title: "The program",
      body: "The program is LogLoads Alerts, run by AutomatedEmpires, the operator of LogLoads. It texts you about your LogLoads account, and only the kinds of texts you agree to. The kinds are:",
      points: [
        "Verification codes: one text each time you ask to confirm your phone number.",
        "Conversation alerts: when a landing replies to you, or a hauler is interested in your job.",
        "Listing and availability reminders: reminders to reconfirm a job or your trucks' availability, sometimes with a link that confirms it in one tap.",
        "Job alerts: new jobs that match a search you saved.",
        "Targeted invitations: a job that a landing invited your business to look at.",
        "News: occasional news about LogLoads."
      ]
    },
    {
      title: "How you agree",
      body: "You agree to each kind of text separately, by ticking its box when you add your mobile number. The boxes are never ticked for you, and agreeing is not a condition of using LogLoads or of buying anything. You can change your choices in your settings at any time.",
      counsel:
        "Before the first text is sent, confirm the consent wording, whether job alerts and targeted invitations need written consent, and any registration or bond duty in each state where LogLoads opens."
    },
    {
      title: "How often texts come",
      body: [
        "Message frequency varies with your activity and the kinds of texts you choose. Each kind has a weekly limit, which LogLoads will state here and beside its box before the first text is sent. LogLoads never sends more than three job alerts, invitations or news texts in any 24 hours.",
        "Job alerts, invitations and news arrive only between 9 a.m. and 8 p.m. in your time zone. Other texts arrive between 8 a.m. and 9 p.m., unless you choose an earlier start for conversation alerts."
      ]
    },
    {
      title: "Costs",
      body: "Msg & data rates may apply. Your mobile carrier's message and data rates apply to texts LogLoads sends you and to texts you send to LogLoads."
    },
    {
      title: "Stop and help",
      body: [
        "Reply STOP to any LogLoads text to stop all texts from LogLoads to that number. LogLoads also treats QUIT, END, REVOKE, OPT OUT, CANCEL and UNSUBSCRIBE, in capital or small letters, as STOP. You get one text confirming that you are unsubscribed, and no more texts after it. To start again, reply START or turn texts back on in your settings.",
        "Reply HELP for help. The reply names the program, tells you how to reach support, and tells you how to stop texts."
      ]
    },
    {
      title: "Carriers",
      body: "Mobile carriers are not liable for delayed or undelivered messages."
    },
    {
      title: "Your number and your privacy",
      body: [
        "Mobile numbers and SMS consent are not shared with third parties for their marketing. The Privacy Policy explains how LogLoads handles your number and keeps a record of your consent.",
        "If you change or give up your number, remove it from your LogLoads account, so that texts do not go to the next person who gets it."
      ],
      links: [{ href: "/privacy", label: "Read the Privacy Policy" }]
    },
    {
      title: "Support",
      body: "For help with texts, reply HELP, email support@logloads.com, or use the contact page.",
      links: [{ href: "/contact", label: "Contact LogLoads" }]
    }
  ]
}
