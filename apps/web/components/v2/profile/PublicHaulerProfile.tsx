import type { HaulerPublicProfileView } from "@logloads/contracts"
import { OperatingRegion, VerificationIndicator } from "@logloads/ui/marketplace"
import type { ReactNode } from "react"

import styles from "./HaulerProfile.module.css"

function units(count: number): string {
  return `${count} ${count === 1 ? "unit" : "units"}`
}

/**
 * A hauling business as a landing operator sees it (UX 02 §5.1). It takes only the public view
 * (`publicHaulerProfile`), so a private field cannot reach this markup: the profile page's preview and any public
 * page render exactly this. `headingLevel` places it under the page's own heading (2) or as the page heading (1).
 * Everything here is what the business itself stated; nothing is verified unless the verification line says so.
 */
export function PublicHaulerProfile({ profile, headingLevel = 2 }: { profile: HaulerPublicProfileView; headingLevel?: 1 | 2 }) {
  const Name = headingLevel === 1 ? "h1" : "h2"
  const Part = headingLevel === 1 ? "h2" : "h3"
  const listed = profile.equipment.reduce((total, line) => total + line.units, 0)
  const figures: Array<{ label: string; value: ReactNode }> = [
    { label: "Equipment listed", value: listed > 0 ? units(listed) : "None yet" },
    { label: "Travels", value: profile.serviceRadiusMiles ? `Up to ${profile.serviceRadiusMiles} mi` : "Not stated" }
  ]

  return (
    <article aria-labelledby="public-profile-name" className={styles.profile} data-public-profile="">
      <div className={styles.identity}>
        <Name className={styles.name} id="public-profile-name">
          {profile.businessName}
        </Name>
        <p className={styles.meta}>
          <span>Hauling business</span>
          <span>{profile.homeBase ? `Based in ${profile.homeBase}` : "Home base not stated"}</span>
        </p>
        {profile.verification ? (
          <p className={styles.meta}>
            <VerificationIndicator verification={profile.verification} />
          </p>
        ) : null}
      </div>

      <dl className={styles.figures}>
        {figures.map((figure) => (
          <div className={styles.figure} key={figure.label}>
            <dt className={styles.figureLabel}>{figure.label}</dt>
            <dd className={styles.figureValue}>{figure.value}</dd>
          </div>
        ))}
      </dl>

      <section className={styles.part}>
        <Part className={styles.partTitle}>About</Part>
        {profile.about ? <p className={styles.partText}>{profile.about}</p> : <p className={styles.partEmpty}>The business has not written a description yet.</p>}
      </section>

      <section className={styles.part}>
        <Part className={styles.partTitle}>Equipment</Part>
        {profile.equipment.length > 0 ? (
          <>
            <ul className={styles.equipmentList}>
              {profile.equipment.map((line) => (
                <li key={line.label}>
                  <span className={styles.units}>{line.units} ×</span> {line.label}
                </li>
              ))}
            </ul>
            <p className={styles.source}>Listed by the business itself. LogLoads does not inspect equipment.</p>
          </>
        ) : (
          <p className={styles.partEmpty}>No equipment listed yet.</p>
        )}
      </section>

      <section className={styles.part}>
        <Part className={styles.partTitle}>Where they work</Part>
        <OperatingRegion areas={[]} homeBase={profile.homeBase ?? "Not stated"} radiusMiles={profile.serviceRadiusMiles} />
      </section>
    </article>
  )
}
