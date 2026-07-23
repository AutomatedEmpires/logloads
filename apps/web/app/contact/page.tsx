import type { Metadata } from "next"

import { ContactPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about plans, private carrier networks, verification, or moving a season of timber? Send LogLoads a note with the context needed to follow up."
}

export default function Page() {
  return <ContactPage />
}
