import type { Metadata } from "next"

import { ContactPage } from "@/components/v3"
import { contactInterestFromQuery } from "@/lib/contact-intent"

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about host onboarding, the 5% completed-load fee, driver access, verification, or moving a season of timber? Send LogLoads the context needed to follow up."
}

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ role?: string | string[]; topic?: string | string[] }>
}) {
  const params = await searchParams

  return (
    <ContactPage
      initialInterest={contactInterestFromQuery(params.topic, params.role)}
    />
  )
}
