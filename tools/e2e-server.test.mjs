import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import http from "node:http"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { createAbortSafeProxy, freePort, parseArguments, substitutePort } from "./e2e-server.mjs"

const launcher = fileURLToPath(new URL("./e2e-server.mjs", import.meta.url))
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

async function listen(server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return server.address().port
}

async function close(server) {
  server.closeAllConnections?.()
  await new Promise((done) => server.close(done))
}

/** An upstream whose handler is `handler(req, res)`, plus a proxy in front of it. */
async function stack(handler, proxyOptions = {}) {
  const upstream = http.createServer(handler)
  const upstreamPort = await listen(upstream)
  const proxy = createAbortSafeProxy({ upstreamPort, ...proxyOptions })
  const port = await listen(proxy)
  return {
    port,
    async stop() {
      await close(proxy)
      await close(upstream)
    }
  }
}

function request(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolveResponse, reject) => {
    const req = http.request({ headers, host: "127.0.0.1", method, path, port }, (res) => {
      const chunks = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => resolveResponse({ body: Buffer.concat(chunks).toString("utf8"), headers: res.headers, status: res.statusCode }))
    })
    req.on("error", reject)
    req.end(body)
  })
}

/**
 * Sends a request and destroys the client socket once the server has it (`received` resolves), the way a browser
 * cancels an image request that is still being generated.
 */
async function cancelledRequest(port, path, received) {
  const req = http.request({ host: "127.0.0.1", path, port })
  req.on("error", () => {})
  req.end()
  await received
  req.destroy()
}

/**
 * An upstream that answers after `answerAfterMs` and records whether the answer was written before its socket
 * closed. `received` resolves when a request reaches it.
 */
function slowUpstream(answerAfterMs) {
  const outcome = { finished: false, closedFirst: false }
  let markReceived
  const received = new Promise((done) => {
    markReceived = done
  })
  const handler = (_req, res) => {
    markReceived()
    res.on("close", () => {
      if (!res.writableFinished) outcome.closedFirst = true
    })
    setTimeout(() => {
      if (res.destroyed) return
      res.end("optimized image", () => {
        outcome.finished = true
      })
    }, answerAfterMs)
  }
  return { handler, outcome, received }
}

test("without the proxy, a cancelled request closes the server's socket before it answers (the #323 trigger)", async () => {
  const { handler, outcome, received } = slowUpstream(300)
  const upstream = http.createServer(handler)
  const port = await listen(upstream)
  await cancelledRequest(port, "/_next/image?url=%2Fbrand%2Flogloads-logo.jpg&w=64&q=75", received)
  await delay(500)
  await close(upstream)
  assert.equal(outcome.closedFirst, true)
  assert.equal(outcome.finished, false)
})

test("behind the proxy, a request the server fully received is answered after the browser cancels it", async () => {
  const { handler, outcome, received } = slowUpstream(300)
  const { port, stop } = await stack(handler)
  await cancelledRequest(port, "/_next/image?url=%2Fbrand%2Flogloads-logo.jpg&w=64&q=75", received)
  await delay(500)
  await stop()
  assert.equal(outcome.closedFirst, false, "the server's socket closed before it answered")
  assert.equal(outcome.finished, true, "the server never finished its answer")
})

test("the next request for the same URL is answered after a cancelled one", async () => {
  let served = 0
  let markReceived
  const received = new Promise((done) => {
    markReceived = done
  })
  const { port, stop } = await stack((_req, res) => {
    markReceived()
    setTimeout(() => {
      served += 1
      res.end(`answer ${served}`)
    }, 100)
  })
  await cancelledRequest(port, "/_next/image?url=%2Fa.jpg&w=64&q=75", received)
  const followUp = await request(port, { path: "/_next/image?url=%2Fa.jpg&w=64&q=75" })
  await delay(150)
  await stop()
  assert.equal(followUp.status, 200)
  assert.equal(served, 2)
})

test("status, headers, cookies and bodies pass through unchanged", async () => {
  const { port, stop } = await stack((req, res) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      res.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/; HttpOnly"])
      res.setHeader("x-seen-host", req.headers.host)
      res.setHeader("x-seen-cookie", req.headers.cookie ?? "")
      res.writeHead(201, { "content-type": "application/json" })
      res.end(JSON.stringify({ body: Buffer.concat(chunks).toString("utf8"), method: req.method, url: req.url }))
    })
  })
  const response = await request(port, {
    body: "name=North+Pine",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "session=abc" },
    method: "POST",
    path: "/sign-in?next=%2Fhost"
  })
  await stop()
  assert.equal(response.status, 201)
  assert.deepEqual(response.headers["set-cookie"], ["a=1; Path=/", "b=2; Path=/; HttpOnly"])
  assert.equal(response.headers["x-seen-host"], `127.0.0.1:${port}`)
  assert.equal(response.headers["x-seen-cookie"], "session=abc")
  assert.deepEqual(JSON.parse(response.body), { body: "name=North+Pine", method: "POST", url: "/sign-in?next=%2Fhost" })
})

test("a streamed response reaches the client as the server writes it", async () => {
  let secondWritten = false
  const { port, stop } = await stack((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.write("first ")
    setTimeout(() => {
      secondWritten = true
      res.end("second")
    }, 300)
  })
  const firstChunkBeforeSecond = await new Promise((resolveChunk, reject) => {
    http.get({ host: "127.0.0.1", path: "/stream", port }, (res) => {
      res.once("data", () => resolveChunk(!secondWritten))
      res.resume()
    }).on("error", reject)
  })
  await delay(350)
  await stop()
  assert.equal(firstChunkBeforeSecond, true)
})

test("a request whose body the client abandoned part-way is cancelled upstream", async () => {
  const seen = { complete: null }
  const { port, stop } = await stack((req, res) => {
    req.on("data", () => {})
    req.on("close", () => {
      seen.complete = req.complete
    })
    req.on("end", () => res.end("should not happen"))
  })
  const req = http.request({ headers: { "content-length": "100" }, host: "127.0.0.1", method: "POST", path: "/upload", port })
  req.on("error", () => {})
  req.write("only ten b")
  await delay(100)
  req.destroy()
  await delay(200)
  await stop()
  assert.equal(seen.complete, false)
})

test("answers 502 when the server is not listening", async () => {
  const proxy = createAbortSafeProxy({ upstreamPort: await freePort() })
  const port = await listen(proxy)
  const response = await request(port)
  await close(proxy)
  assert.equal(response.status, 502)
  assert.match(response.body, /did not answer/)
})

test("names a request still unanswered after the threshold, once", async () => {
  const reports = []
  const { port, stop } = await stack(
    (_req, res) => {
      setTimeout(() => res.end("late"), 250)
    },
    { checkEveryMs: 20, report: (line) => reports.push(line), slowAfterMs: 60 }
  )
  await request(port, { path: "/_next/image?url=%2Fbrand%2Flogloads-logo.jpg&w=64&q=75" })
  await stop()
  assert.equal(reports.length, 1)
  assert.match(reports[0], /^still waiting after \d+ s: GET \/_next\/image\?url=%2Fbrand%2Flogloads-logo\.jpg&w=64&q=75$/)
})

test("parses the launcher's arguments and refuses incomplete ones", () => {
  assert.deepEqual(parseArguments(["--port", "3002", "--log", "test-results/server.log", "--", "node", "next", "-p", "{port}"]), {
    command: ["node", "next", "-p", "{port}"],
    log: "test-results/server.log",
    port: 3002
  })
  assert.equal(parseArguments(["--port", "3012", "--", "next", "-p={port}"]).log, undefined)
  assert.throws(() => parseArguments(["--port", "3002", "node", "next"]), /usage/)
  assert.throws(() => parseArguments(["--port", "0", "--", "next", "{port}"]), /TCP port/)
  assert.throws(() => parseArguments(["--host", "x", "--", "next", "{port}"]), /unknown or incomplete option --host/)
  assert.throws(() => parseArguments(["--port", "3002", "--"]), /no server command/)
  assert.throws(() => parseArguments(["--port", "3002", "--", "next", "-p", "3002"]), /\{port\}/)
  assert.deepEqual(substitutePort(["next", "-p", "{port}", "--url=http://127.0.0.1:{port}"], 4100), ["next", "-p", "4100", "--url=http://127.0.0.1:4100"])
})

test("the launcher serves through its port, and refuses connections once the server exits", async () => {
  const port = await freePort()
  // A stand-in server that answers until it is asked to exit.
  const server = [
    "const http = require('node:http')",
    "const s = http.createServer((req, res) => { if (req.url === '/exit') { res.end('bye'); setTimeout(() => process.exit(3), 50); return } res.end('ok') })",
    "s.listen(Number(process.argv[1]), '127.0.0.1')"
  ].join(";")
  const child = spawn(process.execPath, [launcher, "--port", String(port), "--", "node", "-e", server, "{port}"], {
    stdio: ["ignore", "ignore", "pipe"]
  })
  let stderr = ""
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  let ready
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    ready = await request(port).catch(() => undefined)
    if (!ready || ready.status !== 200) {
      ready = undefined
      await delay(50)
    }
  }
  assert.equal(ready?.body, "ok", `the launcher never served: ${stderr}`)

  await request(port, { path: "/exit" })
  const [code] = await once(child, "exit")
  assert.equal(code, 3)
  assert.match(stderr, /the server exited \(code 3\); refusing further connections/)
  await assert.rejects(request(port), /ECONNREFUSED/)
})
