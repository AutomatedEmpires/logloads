import type { Metadata } from "next"

import { ContactPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about host onboarding, the 5% completed-load fee, driver access, verification, or moving a season of timber? Send LogLoads the context needed to follow up."
}

export default function Page() {
  return <ContactPage />
}
