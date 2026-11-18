import { createContext, runInContext, type Context } from "node:vm"

import { describe, expect, it } from "vitest"

import { serviceWorkerScript } from "@/app/sw"

const ORIGIN = "http://127.0.0.1:3002"

interface FakeRequest {
  method: string
  mode: string
  url: string
}

function html(body: string, status = 200): Response {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" }, status })
}

function boot(fetchImpl: (request: FakeRequest) => Promise<Response>) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const entries = new Map<string, Response>()
  const deleted: string[] = []
  let skipped = false
  let claimed = false
  const cache = {
    add(url: string) {
      entries.set(new URL(url, ORIGIN).href, html("shell"))
      return Promise.resolve()
    },
    match(request: Request | string) {
      const key = typeof request === "string" ? new URL(request, ORIGIN).href : request.url
      return Promise.resolve(entries.get(key) ?? undefined)
    },
    put(request: Request, response: Response) {
      entries.set(request.url, response)
      return Promise.resolve()
    }
  }
  const caches = {
    delete(key: string) {
      deleted.push(key)
      return Promise.resolve(true)
    },
    keys: () => Promise.resolve(["logloads-low-signal-v1", "logloads-old"]),
    open: () => Promise.resolve(cache)
  }
  const self = {
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => listeners.set(type, fn),
    clients: { claim: () => { claimed = true; return Promise.resolve() } },
    location: { origin: ORIGIN },
    skipWaiting: () => { skipped = true; return Promise.resolve() }
  }
  const context: Context = createContext({ Promise, Request, Response, URL, caches, clearTimeout, fetch: fetchImpl, self, setTimeout })
  runInContext(serviceWorkerScript(), context)

  return {
    claimed: () => claimed,
    deleted,
    entries,
    async emit(type: string, event: Record<string, unknown>) {
      let waited: Promise<unknown> = Promise.resolve()
      let responded: Promise<unknown> | undefined
      listeners.get(type)?.({
        ...event,
        respondWith: (pending: Promise<unknown>) => { responded = pending },
        waitUntil: (pending: Promise<unknown>) => { waited = pending }
      })
      await waited
      return responded ? await responded : null
    },
    skipped: () => skipped
  }
}

function navigate(pathname: string): FakeRequest {
  return { method: "GET", mode: "navigate", url: `${ORIGIN}${pathname}` }
}

describe("service worker", () => {
  it("installs the shell and drops a previous cache when it activates", async () => {
    const worker = boot(async () => html("unused"))
    await worker.emit("install", {})
    await worker.emit("activate", {})

    expect(worker.skipped()).toBe(true)
    expect(worker.claimed()).toBe(true)
    expect(worker.deleted).toEqual(["logloads-old"])
    expect(await worker.entries.get(`${ORIGIN}/`)?.text()).toBe("shell")
  })

  it("keeps the last Find Work list and opens it when the network fails", async () => {
    let online = true
    const worker = boot(async () => {
      if (!online) throw new Error("offline")
      return html("pine jobs")
    })
    const first = await worker.emit("fetch", { request: navigate("/v2/work?product=saw") }) as Response
    expect(await first.text()).toBe("pine jobs")

    online = false
    const offline = await worker.emit("fetch", { request: navigate("/v2/work?product=saw") }) as Response
    expect(await offline.text()).toBe("pine jobs")
  })

  it("opens a job that was visited, and says so when that job was never opened", async () => {
    let online = true
    const worker = boot(async () => {
      if (!online) throw new Error("offline")
      return html("Pine ridge, $400 a load")
    })
    await worker.emit("fetch", { request: navigate("/v2/work/pine-ridge") })
    online = false
    const job = await worker.emit("fetch", { request: navigate("/v2/work/pine-ridge") }) as Response
    const missing = await worker.emit("fetch", { request: navigate("/v2/work/never-opened") }) as Response
    const missingText = await missing.text()

    expect(await job.text()).toBe("Pine ridge, $400 a load")
    expect(missingText).toContain("isn't on this phone yet")
    expect(missingText).toContain("<h1>")
  })

  it("does not replace a saved job with the error page from a failed send", async () => {
    const worker = boot(async (request) => html(request.url.includes("error=") ? "error page" : "the job"))
    await worker.emit("fetch", { request: navigate("/v2/work/pine-ridge") })
    await worker.emit("fetch", { request: navigate("/v2/work/pine-ridge?error=busy") })
    const saved = worker.entries.get(`${ORIGIN}/v2/work/pine-ridge`)

    expect(await saved?.text()).toBe("the job")
  })

  it("leaves inquiries, posts and other APIs to the network", async () => {
    const worker = boot(async () => html("should not be used"))
    const inquiries = await worker.emit("fetch", { request: navigate("/v2/inquiries") })
    const post = await worker.emit("fetch", { request: { method: "POST", mode: "navigate", url: `${ORIGIN}/v2/work` } })
    const health = await worker.emit("fetch", { request: { method: "GET", mode: "cors", url: `${ORIGIN}/api/health` } })
    const flight = await worker.emit("fetch", { request: navigate("/v2/work?_rsc=abc") })

    expect(inquiries).toBeNull()
    expect(post).toBeNull()
    expect(health).toBeNull()
    expect(flight).toBeNull()
    expect(worker.entries.has(`${ORIGIN}/v2/work`)).toBe(false)
  })

  it("serves a shell asset from the phone after it has been fetched once", async () => {
    let online = true
    const worker = boot(async () => {
      if (!online) throw new Error("offline")
      return new Response("bundle", { headers: { "Content-Type": "application/javascript" }, status: 200 })
    })
    const asset = { method: "GET", mode: "same-origin", url: `${ORIGIN}/_next/static/chunks/app.js` }
    expect(await ((await worker.emit("fetch", { request: asset })) as Response).text()).toBe("bundle")
    online = false
    expect(await ((await worker.emit("fetch", { request: asset })) as Response).text()).toBe("bundle")
  })

  it("does not cache a sign-in redirect or a failed response over the job", async () => {
    const worker = boot(async () => {
      const response = html("sign-in")
      Object.defineProperty(response, "redirected", { value: true })
      Object.defineProperty(response, "url", { value: `${ORIGIN}/sign-in` })
      return response
    })
    await worker.emit("fetch", { request: navigate("/v2/work/pine-ridge") })
    expect(worker.entries.has(`${ORIGIN}/v2/work/pine-ridge`)).toBe(false)

    const errors = boot(async () => html("nope", 503))
    await errors.emit("fetch", { request: navigate("/v2/work") })
    expect(errors.entries.has(`${ORIGIN}/v2/work`)).toBe(false)
  })
})
