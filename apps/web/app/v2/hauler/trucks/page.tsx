import { notFound } from "next/navigation"

import type { HaulerFleetView } from "@logloads/contracts"
import { fleetCapacity, showsCapacityBoard } from "@logloads/services"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, EmptyState, FormActions, StepIndicator } from "@logloads/ui/primitives"

import styles from "@/components/v2/onboarding/Onboarding.module.css"
import { PageNotice } from "@/components/v2/PageNotice"
import { AddEquipmentForm, AvailabilityForm, CapacityBoard, EquipmentRow } from "@/components/v2/trucks/TrucksForms"
import truckStyles from "@/components/v2/trucks/Trucks.module.css"
import { withV2Reference } from "@/lib/marketplace-v2/error-codes"
import { reportV2Error } from "@/lib/marketplace-v2/error-log"
import { fleetAnswerFromQuery, TRUCKS_PATH } from "@/lib/marketplace-v2/fleet-page"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { HAULER_SETUP_STEPS, PROFILE_PATH, SETUP_DONE_PATH } from "@/lib/marketplace-v2/hauler-profile-form"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { MarketplaceRefusalError } from "@/lib/marketplace-v2/port"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function Refusal({ body, title }: { body: string; title: string }) {
  return (
    <div data-ds-page="hauler-trucks">
      <PageHeader title="My trucks" />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <Section variant="flush">
              <EmptyState actions={<Button href="/v2/work" label="Browse public jobs" size="sm" variant="secondary" />} body={body} title={title} />
            </Section>
          }
        />
      </PageContainer>
    </div>
  )
}

/**
 * `/v2/hauler/trucks` (UX 02 §A4, §A5, A-fleet; #126): the business's own equipment from the LogLoads presets, its
 * self-reported availability per truck type, and from two trucks the capacity board with "Confirm all as shown".
 * Self-reported only: no GPS, driver names, trips, maintenance or schedules. Every form is a plain POST.
 */
export default async function HaulerTrucksPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const query = await searchParams
  const setup = query.setup === "1"
  const resolved = await resolveV2Viewer(setup ? `${TRUCKS_PATH}?setup=1` : TRUCKS_PATH)

  if (!resolved.ok) {
    return <Refusal body={resolved.refusal} title="No business selected" />
  }

  if (!resolved.access.capabilities.includes("interest.express")) {
    return <Refusal body={withBusinessSwitchNote("This business has no hauling profile. My trucks is for hauling businesses.")} title="Not a hauling business" />
  }

  let fleet: HaulerFleetView

  try {
    fleet = await pilotMarketplaceV2.haulerFleet(resolved.viewer)
  } catch (error) {
    // A store refusal keeps its words; anything else is logged, and the page names its reference (#279, K2).
    const failure = reportV2Error(error, "fleet.read")
    const body = error instanceof MarketplaceRefusalError ? error.message : withV2Reference("Your trucks could not be loaded. Try again in a moment.", failure.requestId)
    return <Refusal body={withBusinessSwitchNote(body)} title="Trucks not available" />
  }

  const now = new Date()
  const answer = fleetAnswerFromQuery(query)
  const rows = fleetCapacity(fleet, now)
  const editable = fleet.canEdit
  const trucks = fleet.units.filter((unit) => unit.category === "truck")
  const extras = fleet.units.filter((unit) => unit.category === "attachment")
  const failed = answer.outcome !== null && answer.outcome !== "saved"
  // A field shows the message only when the field is the reason (invalid or refused); "not available" is page-wide.
  const fieldError = answer.outcome === "invalid" || answer.outcome === "refused" ? answer.message : null

  return (
    <div data-ds-page="hauler-trucks">
      <PageHeader
        actions={setup ? undefined : <Button href={PROFILE_PATH} label="Business profile" size="sm" variant="ghost" />}
        description="What you run and when it is free, in your own words. Landings see it with its date; nothing is tracked."
        title={setup ? "Your trucks" : "My trucks"}
      />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <div className={styles.stack}>
              {setup ? <StepIndicator current={2} steps={[...HAULER_SETUP_STEPS]} /> : null}
              <div id="fleet-notice">
                {answer.message ? (
                  <PageNotice role={failed ? "alert" : "status"} tone={failed ? "critical" : "positive"}>{answer.message}</PageNotice>
                ) : null}
              </div>
              {!pilotMarketplaceV2.supportsHaulerFleet && !answer.outcome ? (
                <PageNotice role="note">Saving trucks and availability isn&apos;t available in this preview yet. You can fill in the forms, but nothing will be saved.</PageNotice>
              ) : null}
              {!editable ? <PageNotice role="note">Only an owner, manager or staff member of this business can change its trucks. You can read them here.</PageNotice> : null}
              {editable && !fleet.placed && pilotMarketplaceV2.supportsHaulerFleet ? (
                <PageNotice role="note">
                  Availability is reported for the area around your home base. <a href={PROFILE_PATH}>Add your home base and how far you travel</a> first.
                </PageNotice>
              ) : null}

              <Section description="Self-reported. LogLoads does not inspect equipment." title="Your equipment" variant="surface">
                {fleet.units.length === 0 ? (
                  <p className={truckStyles.empty}>No trucks listed yet. Add what you run below.</p>
                ) : (
                  <ul aria-label="Your equipment" className={truckStyles.units}>
                    {[...trucks, ...extras].map((unit) => (
                      <EquipmentRow disabled={!editable} key={unit.id} posted={answer.count?.unitId === unit.id ? answer.count.count : null} setup={setup} unit={unit} />
                    ))}
                  </ul>
                )}
                <AddEquipmentForm disabled={!editable} error={answer.form === "add" ? fieldError : null} setup={setup} values={answer.add} />
              </Section>

              {rows.length > 0 ? (
                <Section description="Per truck type. It can never be more than you list, and it shows when you last said so." title="Availability" variant="surface">
                  {showsCapacityBoard(fleet) ? <CapacityBoard canConfirm={editable} rows={rows} setup={setup} /> : null}
                  {rows.map((row) => (
                    <AvailabilityForm
                      disabled={!editable}
                      error={answer.form === "availability" && answer.availability?.equipmentCode === row.equipmentCode ? fieldError : null}
                      key={row.equipmentCode}
                      now={now.toISOString()}
                      row={row}
                      setup={setup}
                      values={answer.availability?.equipmentCode === row.equipmentCode ? answer.availability : null}
                    />
                  ))}
                </Section>
              ) : null}

              {setup ? <FormActions primary={<Button href={SETUP_DONE_PATH} label="Finish" />} secondary={<Button href={SETUP_DONE_PATH} label="Skip for now" variant="ghost" />} /> : null}
            </div>
          }
        />
      </PageContainer>
    </div>
  )
}
