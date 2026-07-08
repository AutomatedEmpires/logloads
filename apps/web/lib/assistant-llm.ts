import "server-only"

import type { AssistantAnswer, AssistantGrounding } from "@logloads/contracts"

/**
 * The assistant is LLM-OPTIONAL. Without a model key configured it is fully
 * functional on the deterministic grounded engine alone. When `ANTHROPIC_API_KEY`
 * is present, a model may rephrase the already-correct grounded answer for tone —
 * but it is given ONLY that answer as source material, must not invent facts, and
 * any error/timeout falls straight back to the deterministic text. Nothing here
 * runs unless a key is set, so the default deployment makes no external calls.
 */
export function isAssistantLlmEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const SYSTEM_PROMPT = [
  "You are a logistics operations assistant inside a freight-hauling coordination app.",
  "Rephrase the provided grounded answer to be warm, clear, and concise.",
  "Use ONLY the facts in the grounded answer — never invent loads, numbers, names, availability, or advice.",
  "Preserve any bullet list. Never state a numeric match score.",
  "Reply with the rephrased answer only, no preamble."
].join(" ")

interface AnthropicContentBlock {
  type?: string
  text?: string
}

export async function refineAssistantAnswer(
  _grounding: AssistantGrounding,
  question: string,
  deterministic: AssistantAnswer
): Promise<AssistantAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return deterministic
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      body: JSON.stringify({
        max_tokens: 500,
        messages: [
          {
            content: `Question: ${question}\n\nGrounded answer to rephrase:\n${deterministic.answer}`,
            role: "user"
          }
        ],
        model: process.env.ASSISTANT_MODEL ?? "claude-haiku-4-5-20251001",
        system: SYSTEM_PROMPT
      }),
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      method: "POST",
      signal: AbortSignal.timeout(8000)
    })

    if (!response.ok) {
      return deterministic
    }

    const data = (await response.json()) as { content?: AnthropicContentBlock[] }
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim()

    return text ? { ...deterministic, answer: text } : deterministic
  } catch {
    // Any provider/network failure degrades gracefully to the grounded answer.
    return deterministic
  }
}
