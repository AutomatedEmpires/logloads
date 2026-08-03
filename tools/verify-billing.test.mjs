import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"

const verifier = new URL("./verify-billing.mjs", import.meta.url)

async function runVerifier(environment) {
  const child = spawn(process.execPath, [verifier.pathname], {
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
      ...environment
    },
    stdio: ["ignore", "pipe", "pipe"]
  })
  let stdout = ""
  let stderr = ""

  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  const [code] = await once(child, "close")

  return { code, stderr, stdout }
}

test("redacts a duplicated provider invoice id while naming internal claims", async () => {
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const firstInvoiceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const secondInvoiceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const providerInvoiceId = "in_provider_should_never_print"
  const state = {
    assignments: [],
    hostInvoices: [firstInvoiceId, secondInvoiceId].map((id) => ({
      feeEventIds: [],
      id,
      organizationId,
      periodEnd: "2026-07-01T00:00:00.000Z",
      periodStart: "2026-06-01T00:00:00.000Z",
      status: "void",
      stripeInvoiceId: providerInvoiceId,
      subtotalCents: 0
    })),
    loadPostings: [],
    networkUsageEvents: [],
    organizationBillingAccounts: [],
    organizations: [{ displayName: "Synthetic Host", id: organizationId }],
    organizationSubscriptions: [],
    platformFeeEvents: [],
    tripsV2: []
  }
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(
      JSON.stringify([
        {
          schema_version: 2,
          state,
          updated_at: "2026-08-03T00:00:00.000Z",
          version: 1
        }
      ])
    )
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()

  if (!address || typeof address === "string") {
    server.close()
    throw new Error("The synthetic verifier server did not bind a TCP port")
  }

  try {
    const result = await runVerifier({
      SUPABASE_URL: `http://127.0.0.1:${address.port}`
    })

    assert.equal(result.code, 1)
    assert.match(result.stderr, /One provider invoice is linked to 2 host invoices/)
    assert.match(result.stderr, new RegExp(firstInvoiceId))
    assert.match(result.stderr, new RegExp(secondInvoiceId))
    assert.doesNotMatch(result.stderr, new RegExp(providerInvoiceId))
    assert.doesNotMatch(result.stdout, new RegExp(providerInvoiceId))
  } finally {
    server.close()
    await once(server, "close")
  }
})

test("turns a provider fetch rejection into a fixed URL-free refusal", async () => {
  const privateUrl = "http://127.0.0.1:0/private-provider-path"
  const result = await runVerifier({ SUPABASE_URL: privateUrl })

  assert.equal(result.code, 1)
  assert.equal(
    result.stderr.trim(),
    "Canonical billing read failed before a response."
  )
  assert.doesNotMatch(result.stderr, /private-provider-path/)
  assert.doesNotMatch(result.stderr, /127\.0\.0\.1/)
})
