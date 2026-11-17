#!/usr/bin/env node
// The web server for the Playwright suites: the real server command (`next start`) behind a small loopback proxy
// that lets every request the server has fully received run to completion, even when the browser cancels it (#323).
//
// Why. Under `next start`, Next.js 15.5 lends the browser's socket to the mocked response of its internal fetch of a
// local image. When the browser cancels a `/_next/image` request while that size is being generated for the first
// time (a test that navigates on before the page finished loading does this), the generation never settles. Next.js
// coalesces every later request for the same URL onto it, so that image never loads again while the server runs
// (vercel/next.js#98402, fixed in Next.js 16.4). Every later page showing it never fires its `load` event, so each
// remaining test waits out its timeout. In CI that was the logo at `w=64`: one cancelled request at the start of the
// desktop project, then 23 failed journeys and 53 minutes. Behind this proxy Next.js sees the proxy's socket, which
// stays open until the response is written, so the generation completes and later requests are served.
//
// Usage, from `apps/web`:
//
//   node ../../tools/e2e-server.mjs --port 3002 [--log test-results/server.log] -- node node_modules/next/dist/bin/next start -H 127.0.0.1 -p {port}
//
// `{port}` in the command becomes a free loopback port for the real server; the browser only sees `--port`.
// The launcher also:
// - writes the server's stdout and stderr to `--log` (stderr still reaches Playwright, which prints it);
// - names any request still unanswered after 20 s, so a hung route shows up in the log;
// - when the server exits, stops accepting connections and exits with its code, so the remaining tests fail at once
//   on a refused connection instead of each waiting out its timeout.
import { spawn } from "node:child_process"
import { createWriteStream, mkdirSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const LOOPBACK = "127.0.0.1"
const USAGE = "usage: e2e-server.mjs --port <port> [--log <file>] -- <server command, with {port}>"

// Connection-level headers belong to one hop; Node sets its own on each side.
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"])

function endToEndHeaders(headers) {
  const kept = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name) && value !== undefined) kept[name] = value
  }
  return kept
}

export function parseArguments(argv) {
  const separator = argv.indexOf("--")
  if (separator < 0) throw new Error(USAGE)

  const options = argv.slice(0, separator)
  const command = argv.slice(separator + 1)
  let port
  let log

  for (let index = 0; index < options.length; index += 2) {
    const [name, value] = [options[index], options[index + 1]]
    if (name === "--port") port = Number(value)
    else if (name === "--log" && value) log = value
    else throw new Error(`unknown or incomplete option ${name}. ${USAGE}`)
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`--port must be a TCP port. ${USAGE}`)
  if (command.length === 0) throw new Error(`no server command after --. ${USAGE}`)
  if (!command.some((part) => part.includes("{port}"))) throw new Error(`the server command must listen on {port}. ${USAGE}`)

  return { port, log, command }
}

export function substitutePort(command, port) {
  return command.map((part) => part.replaceAll("{port}", String(port)))
}

export function freePort(host = LOOPBACK) {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once("error", reject)
    probe.listen(0, host, () => {
      const { port } = probe.address()
      probe.close(() => resolvePort(port))
    })
  })
}

/**
 * A loopback reverse proxy to `upstreamPort` that never cancels a request the upstream has fully received. When the
 * client goes away first, the upstream response is still read to its end, then dropped. A request whose body the
 * client abandoned part-way is cancelled instead, so the upstream never acts on a truncated body.
 *
 * Requests still unanswered after `slowAfterMs` are reported once through `report`.
 */
export function createAbortSafeProxy({ upstreamPort, upstreamHost = LOOPBACK, slowAfterMs = 20_000, checkEveryMs = 5_000, report = () => {} }) {
  const agent = new http.Agent({ keepAlive: true })
  const inFlight = new Map()
  let nextId = 0

  const server = http.createServer((req, res) => {
    const id = nextId++
    inFlight.set(id, { method: req.method, url: req.url, started: Date.now(), reported: false })
    let upstreamResponse

    const upstream = http.request({
      agent,
      headers: endToEndHeaders(req.headers),
      host: upstreamHost,
      method: req.method,
      path: req.url,
      port: upstreamPort
    })
    upstream.on("close", () => inFlight.delete(id))

    upstream.on("response", (response) => {
      upstreamResponse = response
      if (res.destroyed) {
        response.resume()
        return
      }
      res.writeHead(response.statusCode ?? 502, response.statusMessage, endToEndHeaders(response.headers))
      response.pipe(res)
    })

    upstream.on("error", (error) => {
      if (res.destroyed) return
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
      res.end(`E2E proxy: the server did not answer (${error.code ?? error.message}).\n`)
    })

    // The client went away before its response was written.
    res.on("close", () => {
      if (res.writableFinished) return
      if (!req.complete) {
        upstream.destroy()
        return
      }
      if (upstreamResponse) {
        upstreamResponse.unpipe(res)
        upstreamResponse.resume()
      }
    })

    // Errors on the client side are expected when it cancels; the close handler above decides what happens upstream.
    req.on("error", () => {})
    res.on("error", () => {})
    req.pipe(upstream)
  })

  // A cancelled browser request can leave a half-closed socket behind; it must not take the proxy down.
  server.on("clientError", (_error, socket) => socket.destroy())

  const watch = setInterval(() => {
    const now = Date.now()
    for (const request of inFlight.values()) {
      if (!request.reported && now - request.started >= slowAfterMs) {
        request.reported = true
        report(`still waiting after ${Math.round((now - request.started) / 1000)} s: ${request.method} ${request.url}`)
      }
    }
  }, checkEveryMs)
  watch.unref()

  server.on("close", () => {
    clearInterval(watch)
    agent.destroy()
  })

  return server
}

function openLog(path) {
  const absolute = resolve(path)
  mkdirSync(dirname(absolute), { recursive: true })
  return createWriteStream(absolute, { flags: "w" })
}

async function main() {
  const { port, log, command } = parseArguments(process.argv.slice(2))
  const upstreamPort = await freePort()
  const logStream = log ? openLog(log) : null
  const say = (line) => {
    const text = `[e2e-server] ${line}\n`
    process.stderr.write(text)
    logStream?.write(text)
  }

  const [executable, ...args] = substitutePort(command, upstreamPort)
  const child = spawn(executable === "node" ? process.execPath : executable, args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  })
  child.stdout.on("data", (chunk) => logStream?.write(chunk))
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk)
    logStream?.write(chunk)
  })

  const proxy = createAbortSafeProxy({ upstreamPort, report: say })
  let stopping = false

  proxy.on("error", (error) => {
    say(`cannot listen on ${LOOPBACK}:${port}: ${error.message}`)
    stopping = true
    child.kill()
    process.exitCode = 1
  })
  proxy.listen(port, LOOPBACK, () => say(`http://${LOOPBACK}:${port} -> ${executable} on port ${upstreamPort}`))

  child.on("error", (error) => {
    say(`cannot start ${executable}: ${error.message}`)
    process.exit(1)
  })

  child.on("exit", (code, signal) => {
    if (!stopping) say(`the server exited (${signal ?? `code ${code}`}); refusing further connections`)
    proxy.close()
    proxy.closeAllConnections()
    const status = stopping ? (process.exitCode ?? 0) : (code ?? 1)
    if (logStream) logStream.end(() => process.exit(status))
    else process.exit(status)
  })

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopping = true
      child.kill(signal)
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
    })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[e2e-server] ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
