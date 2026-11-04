import { landingPlanCards } from "@logloads/contracts"
import { Section } from "@logloads/ui/layout"

import { PageNotice } from "../PageNotice"
import styles from "./landing.module.css"

/** The sentence the preview shows in place of any payment step (UX 02 §B2, #127 criterion 2). */
export const BILLING_INACTIVE_NOTE = "Billing isn't active yet. You can set up landings and draft jobs."

/**
 * B2: the three landing plans, every fact worded from `LANDING_PLANS` in packages/contracts (never typed here). There
 * is no plan choice, price selection or checkout: billing is not active, and V2 is off in production.
 */
export function LandingPlanCards() {
  return (
    <Section description="Every plan has unlimited job posts, inquiries and replies." title="Plans">
      <div className={styles.stack} id="plans">
        <ul aria-label="Landing plans" className={styles.plans}>
          {landingPlanCards().map((card) => (
            <li className={styles.plan} key={card.code}>
              <h3 className={styles.planName}>{card.name}</h3>
              <p className={styles.note}>{card.positioning}</p>
              <p className={styles.planPrice}>{card.price}</p>
              <ul className={styles.planFacts}>
                <li>{card.activeLandings}</li>
                <li>{card.teamMembers}</li>
                <li>{card.invitations}</li>
              </ul>
              <p className={styles.note}>Unlimited job posts, inquiries and replies.</p>
            </li>
          ))}
        </ul>
        <PageNotice role="note">
          <p>
            <strong>{BILLING_INACTIVE_NOTE}</strong> No plan can be bought here, and nothing on this page charges you.
          </p>
        </PageNotice>
      </div>
    </Section>
  )
}
