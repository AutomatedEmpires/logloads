import { createInMemoryDatabase } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"

export const services = createLogLoadsServices(createInMemoryDatabase())

export function serializeError(error: unknown): { error: string } {
	if (error instanceof Error) {
		return { error: error.message }
	}

	return { error: "Unknown error" }
}