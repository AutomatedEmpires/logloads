import { auth } from "@clerk/nextjs/server"
import { createInMemoryDatabase } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"

export const services = createLogLoadsServices(createInMemoryDatabase())

export interface RequestActorContext {
	actorUserId: string
	organizationId: string
	clerkUserId: string | null
	source: "clerk" | "development-fallback"
}

export async function getRequestActorContext(options: {
	devActorUserId?: unknown
	requestedOrganizationId?: string | null
} = {}): Promise<RequestActorContext> {
	let clerkUserId: string | null = null

	try {
		const session = await auth()
		clerkUserId = session.userId ?? null
	} catch {
		clerkUserId = null
	}

	const profileFromClerk = clerkUserId
		? services.state.profiles.find((profile) => profile.clerkUserId === clerkUserId)
		: undefined
	const allowSeedActorFallback = process.env.NODE_ENV !== "production" || process.env.LOGLOADS_ENABLE_DEMO_ACTORS === "true"
	const devActorUserId = allowSeedActorFallback && typeof options.devActorUserId === "string"
		? options.devActorUserId
		: undefined

	if (!profileFromClerk && !allowSeedActorFallback) {
		throw new Error("Authentication required")
	}

	const actorUserId = profileFromClerk?.id ?? devActorUserId ?? services.DEFAULT_ACTOR_USER_ID
	const memberships = services.getOrganizationMemberships(actorUserId)

	if (options.requestedOrganizationId) {
		const requestedMembership = memberships.find((membership) => membership.organizationId === options.requestedOrganizationId)

		if (!requestedMembership) {
			throw new Error(`User ${actorUserId} is not an active member of organization ${options.requestedOrganizationId}`)
		}

		return {
			actorUserId,
			clerkUserId,
			organizationId: requestedMembership.organizationId,
			source: profileFromClerk ? "clerk" : "development-fallback"
		}
	}

	return {
		actorUserId,
		clerkUserId,
		organizationId: memberships[0]?.organizationId ?? services.DEFAULT_ORGANIZATION_ID,
		source: profileFromClerk ? "clerk" : "development-fallback"
	}
}

export function serializeError(error: unknown): { error: string } {
	if (error instanceof Error) {
		return { error: error.message }
	}

	return { error: "Unknown error" }
}
