import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { signedDocumentUrl, tripDocumentTarget } from "@/lib/media"
import { services } from "@/lib/services"

/**
 * Delivers a trip document to a participant in that trip.
 *
 * The document id is looked up first, but it grants nothing: authorization runs
 * against the trip the document belongs to, so guessing an id off another haul
 * resolves to that haul's rule and refuses there.
 */
export async function GET(request: NextRequest) {
  try {
    const { actor, organizationId } = await requireApiActor()
    const documentId = request.nextUrl.searchParams.get("documentId")

    if (!documentId) {
      throw new ApiError("A document is required", 422)
    }

    const document = services.state.tripDocuments.find((candidate) => candidate.id === documentId)

    if (!document) {
      throw new ApiError("Document not found", 404)
    }

    // Authorization comes from the trip on the record, never from the caller.
    // Reading proof is not operating the haul: the role that settles a delivery
    // holds `assign_capacity` and need not hold `progress_trip`.
    tripDocumentTarget(services.state, actor, organizationId, document.tripId, "read")

    // Records written before uploads were wired name a file that was never
    // stored. They stay on the haul's history as the account of what was
    // claimed; there is simply nothing to hand back.
    if (!document.media) {
      throw new ApiError("This record has no stored file", 404)
    }

    // Signed outside the try: building the URL needs Cloudinary credentials, and
    // their absence is a 503 configuration fact. Catching it alongside the fetch
    // would report an unconfigured environment as a provider blip.
    const url = signedDocumentUrl(document.media)
    let response: Response

    try {
      response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new ApiError("The document is temporarily unavailable", 502)
    }

    if (!response.ok || !response.body) {
      throw new ApiError("The document is temporarily unavailable", 502)
    }

    return new NextResponse(response.body, {
      headers: {
        // Not cached, not merely private. Trip access is re-checked on every
        // request, and a cached copy would keep answering for five minutes after
        // a membership was revoked or a shared cab tablet was signed out of.
        // This is evidence in a settlement; one extra fetch per click is cheap.
        "Cache-Control": "private, no-store",
        // RFC 6266 extended form: the driver's own filename survives spaces and
        // non-ASCII intact, and percent-encoding it keeps quotes and newlines
        // from breaking out of the header.
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        "Content-Type": response.headers.get("content-type") ?? document.contentType,
        "X-Content-Type-Options": "nosniff"
      },
      status: 200
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
