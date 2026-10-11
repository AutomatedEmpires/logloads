"use client"

import Image from "next/image"
import Link from "next/link"
import { Icon } from "@logloads/ui"

import type { DriverProfileShowcaseView, ShowcaseStat } from "@/lib/driver-profile-showcase"
import type { OrgReputationView } from "@/lib/network"
import { ReputationChip } from "./Reputation"

/** The photo tools live inside the "Better matching" disclosure; open it before jumping there. */
function openPhotoTools() {
  document.getElementById("driver-profile-matching")?.setAttribute("open", "")
}

function Stars({ filled }: { filled: number }) {
  return (
    <span aria-hidden className="driver-stat__stars">
      {[0, 1, 2, 3, 4].map((index) => (
        <Icon key={index} name="ops.rating" size={16} weight={index < filled ? "fill" : "regular"} />
      ))}
    </span>
  )
}

function StatTile({ stat }: { stat: ShowcaseStat }) {
  return (
    <Link className={`driver-stat driver-stat--${stat.tone}`} data-testid={`driver-stat-${stat.key}`} href={stat.href}>
      <span aria-hidden className="driver-stat__icon">
        <Icon name={stat.icon} size={24} />
      </span>
      <span className="driver-stat__body">
        <span className="driver-stat__label">{stat.label}</span>
        <span className="driver-stat__value">
          {stat.value}
          {stat.stars !== null ? <Stars filled={stat.stars} /> : null}
        </span>
        <span className="driver-stat__detail">{stat.detail}</span>
      </span>
      <span aria-hidden className="driver-stat__chevron">›</span>
    </Link>
  )
}

export function DriverProfileShowcase({
  organizationReputation,
  view
}: {
  organizationReputation: OrgReputationView
  view: DriverProfileShowcaseView
}) {
  return (
    <section aria-labelledby="driver-showcase-name" className="driver-showcase" data-testid="driver-profile-showcase">
      <div className="driver-showcase__hero">
        {view.cover.photo ? (
          <Image
            alt="Your truck"
            className="driver-showcase__cover"
            height={540}
            priority
            src="/api/media/asset?kind=truck"
            unoptimized
            width={1440}
          />
        ) : (
          // Ridgeline art is pure CSS (::before/::after) for a driver without a truck photo.
          <div aria-hidden className="driver-showcase__cover driver-showcase__cover--empty" />
        )}
        <span
          className={`driver-showcase__clearance${view.clearance.cleared ? " is-cleared" : ""}`}
          data-testid="driver-showcase-clearance"
          title={view.clearance.detail}
        >
          <Icon aria-hidden name={view.clearance.cleared ? "status.assigned" : "status.warning"} size={18} />
          {view.clearance.label}
        </span>
        {view.cover.photo ? (
          <span className="driver-showcase__cover-note">
            {view.cover.sharedWithPartners ? "Truck photo shown to partners" : "Only you see this photo"}
          </span>
        ) : (
          <a className="driver-showcase__cover-note driver-showcase__cover-note--action" href="#driver-photos" onClick={openPhotoTools}>
            Add a truck photo
          </a>
        )}
        <div className="driver-showcase__avatar">
          {view.avatarPhoto ? (
            <Image alt={`${view.driverName}`} height={264} src="/api/media/asset?kind=profile" unoptimized width={264} />
          ) : (
            <span aria-hidden>{view.initials}</span>
          )}
          <span
            aria-label={view.availability.label}
            className={`driver-showcase__presence${view.availability.live ? " is-live" : ""}`}
            role="img"
          />
        </div>
      </div>

      <div className="driver-showcase__headline">
        <div>
          <h2 id="driver-showcase-name">{view.driverName}</h2>
          <p>
            <span>{view.organizationName}</span>
            <ReputationChip reputation={organizationReputation} />
          </p>
        </div>
        <span className={`driver-showcase__availability${view.availability.live ? " is-live" : ""}`}>
          <span aria-hidden />
          {view.availability.label}
        </span>
      </div>

      <ul aria-label="Driver, company, and equipment" className="driver-showcase__identity">
        {view.identity.map((row) => {
          const body = (
            <>
              <span aria-hidden className="driver-showcase__identity-icon">
                <Icon name={row.icon} size={24} />
              </span>
              <span className="driver-showcase__identity-text">
                <span className="driver-showcase__identity-label">{row.label}</span>
                <strong>{row.title}</strong>
                {row.detail ? <small>{row.detail}</small> : null}
              </span>
            </>
          )

          return (
            <li key={row.key}>
              {row.href ? (
                <Link className="driver-showcase__identity-row" href={row.href}>
                  {body}
                </Link>
              ) : (
                <div className="driver-showcase__identity-row">{body}</div>
              )}
            </li>
          )
        })}
      </ul>

      <section aria-labelledby="driver-showcase-photos" className="driver-showcase__card">
        <header className="driver-showcase__card-head">
          <h3 id="driver-showcase-photos">
            <Icon aria-hidden name="ops.photos" size={22} /> Photos
          </h3>
          <a href="#driver-photos" onClick={openPhotoTools}>
            Manage photos <span aria-hidden>→</span>
          </a>
        </header>
        <ul className="driver-showcase__photos">
          {view.photos.map((photo) => (
            <li className={photo.viewable ? undefined : "is-unavailable"} key={photo.kind}>
              {photo.viewable ? (
                <Image alt={`${photo.label} photo`} height={360} src={`/api/media/asset?kind=${photo.kind}`} unoptimized width={480} />
              ) : (
                <span className="driver-showcase__photo-note">
                  <Icon aria-hidden name="ops.photos" size={22} />
                  On file · preview unavailable
                </span>
              )}
              <span className="driver-showcase__photo-label">{photo.label}</span>
            </li>
          ))}
          {view.missingPhotos.map((photo) => (
            <li className="is-missing" key={photo.kind}>
              <a href="#driver-photos" onClick={openPhotoTools}>
                <Icon aria-hidden name="action.upload" size={22} />
                Add {photo.label.toLowerCase()} photo
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="driver-showcase-record" className="driver-showcase__card">
        <header className="driver-showcase__band">
          <h3 id="driver-showcase-record">Track record</h3>
          <p>Built from your LogLoads requests, hauls, host reviews, and approved work records.</p>
        </header>
        <div className="driver-showcase__stats">
          {view.stats.map((stat) => (
            <StatTile key={stat.key} stat={stat} />
          ))}
        </div>
      </section>
    </section>
  )
}
