import { RouteSkeleton } from "@/components/v3/RouteSkeleton"

// The legacy workspaces keep the branded loading skeleton; why it is not at the app root: RouteSkeleton (#174).
export default function Loading() {
  return <RouteSkeleton />
}
