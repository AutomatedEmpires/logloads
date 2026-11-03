import { redirect } from "next/navigation"

/** The landing context's V2 home (#124). Its overview (UX B8) is a later ticket; until then it opens the job list. */
export default function LandingHome() {
  redirect("/v2/landing/jobs")
}
