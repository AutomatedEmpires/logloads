"use server"

import { answerOperatorQuestion, type AssistantCitation, type AssistantRole } from "@logloads/contracts"

import { captureServerEvent } from "./analytics"
import { buildAssistantGrounding } from "./assistant-data"
import { refineAssistantAnswer } from "./assistant-llm"
import { buildNetworkView } from "./network"
import { getSessionActor } from "./session"
import { serializeError, services } from "./services"

export interface AssistantResult {
  ok: boolean
  error: string | null
  answer: string | null
  citations: AssistantCitation[]
  intent: string | null
}

const ROLES: readonly AssistantRole[] = ["driver", "fleet", "host", "admin"]

/**
 * Read-only assistant endpoint. Identity comes from the session; the answer is
 * grounded strictly in the actor's own network read model, then optionally refined
 * by a model when one is configured. No state is mutated — there is deliberately
 * no commit().
 */
export async function askAssistantAction(input: { question: string; role: string }): Promise<AssistantResult> {
  try {
    const actor = await getSessionActor()

    if (!actor) {
      throw new Error("Sign in to continue")
    }

    const role: AssistantRole = ROLES.includes(input.role as AssistantRole) ? (input.role as AssistantRole) : "driver"

    const network = buildNetworkView(services.state, {
      actorUserId: actor.profile.id,
      kind: "actor",
      organizationId: actor.activeOrganization?.id ?? null
    })

    const grounding = buildAssistantGrounding(network, role, actor.profile.fullName)
    const deterministic = answerOperatorQuestion(grounding, input.question)
    const refined = await refineAssistantAnswer(grounding, input.question, deterministic)

    // Analytics: the resolved intent and cockpit only — never the question text.
    captureServerEvent("assistant_asked", actor.profile.id, { intent: refined.intent, role })

    return { answer: refined.answer, citations: refined.citations, error: null, intent: refined.intent, ok: true }
  } catch (error) {
    return { answer: null, citations: [], error: serializeError(error).error, intent: null, ok: false }
  }
}
