import { permanentRedirect } from "next/navigation"

// The Posting Rules replace the Marketplace Rules of July 6, 2026, which told users to "commit through LogLoads"
// (legal review §8.0 item 2, #329). Old links and bookmarks keep working through a permanent (308) redirect.
export default function Page(): never {
  permanentRedirect("/posting-rules")
}
