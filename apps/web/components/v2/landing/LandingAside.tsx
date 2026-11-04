import type { LandingAllowanceSummary } from "@logloads/contracts"
import { Icon } from "@logloads/ui/icons"
import { Section } from "@logloads/ui/layout"

import { activeLandingsLine, invitationsLine, teamLine } from "@/lib/marketplace-v2/landing-workspace"

import styles from "./landing.module.css"

/** The plan's allowances as facts: counts from the store, limits from `LANDING_PLANS`. No checkout, no upsell. */
export function LandingAllowanceFigures({ summary }: { summary: LandingAllowanceSummary }) {
  return (
    <dl className={styles.usage}>
      <div className={styles.usageRow}>
        <dt>Plan</dt>
        <dd>{summary.plan ? summary.plan.name : "None active · billing isn't active yet"}</dd>
      </div>
      <div className={styles.usageRow}>
        <dt>Landings</dt>
        <dd>{activeLandingsLine(summary)}</dd>
      </div>
      <div className={styles.usageRow}>
        <dt>Team</dt>
        <dd>{teamLine(summary)}</dd>
      </div>
      <div className={styles.usageRow}>
        <dt>Invitations</dt>
        <dd>{invitationsLine(summary)}</dd>
      </div>
    </dl>
  )
}

/** B3's aside: which half of a landing haulers see. */
export function WhoSeesWhat() {
  return (
    <Section title="Who sees what">
      <ul className={styles.checklist}>
        <li><Icon aria-hidden name="status.verified" size={16} /><span>Haulers see the landing name and its approximate area on each job.</span></li>
        <li><Icon aria-hidden name="status.verified" size={16} /><span>Your landing team sees everything on a landing&rsquo;s page.</span></li>
        <li><Icon aria-hidden name="status.lock" size={16} /><span>The exact location, gate and access instructions and the site contact are never on a listing or a map.</span></li>
      </ul>
    </Section>
  )
}
