import type { Metadata } from "next"

import { ContactPage } from "@/components/v3"

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about plans, private carrier networks, verification, or moving a season of timber? Send a note — we read every message."
}

export default function Page() {
  return <ContactPage />
}
