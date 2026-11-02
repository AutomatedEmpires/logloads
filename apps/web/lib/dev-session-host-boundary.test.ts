import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { decideDevSession, isLoopbackHost } from "./demo-mode"

/**
 * The development-session gate decides on the request's Host header. That
 * header is client-controlled, so the policy alone cannot tell a real loopback
 * request from a LAN peer that sends `Host: localhost:3002`. The enforcing
 * control is therefore the network binding: development servers listen on
 * 127.0.0.1 only, so no non-loopback peer can reach them at all.
 */
const developmentOnLoopback = {
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3002",
  NODE_ENV: "development"
}

describe("development-session Host-header boundary", () => {
  it("refuses a request addressed to the machine's LAN or public address", () => {
    for (const host of ["10.0.0.234:3002", "192.168.1.20:3002", "172.16.4.8", "0.0.0.0:3002", "[fe80::1]:3002", "logloads.com"]) {
      expect(decideDevSession(developmentOnLoopback, host)).toEqual({ demoMode: false, enabled: false, reason: "non-loopback" })
    }
  })

  it("refuses spoof-shaped and malformed Host values instead of guessing", () => {
    for (const host of [
      "localhost.attacker.example",
      "localhost:3002@attacker.example",
      "localhost:3002/evil",
      "localhost:http",
      "[::1]attacker",
      "127.0.0.1\\evil",
      "",
      "   ",
      null,
      undefined
    ]) {
      expect(isLoopbackHost(host)).toBe(false)
      expect(decideDevSession(developmentOnLoopback, host).enabled).toBe(false)
    }
  })

  it("never enables a development session on a hosted or Clerk-backed runtime, even with a loopback Host", () => {
    for (const hosted of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL_URL: "logloads-git-x.vercel.app" }]) {
      expect(decideDevSession({ ...developmentOnLoopback, ...hosted }, "localhost:3002"))
        .toEqual({ demoMode: false, enabled: false, reason: "hosted" })
    }

    expect(decideDevSession({
      ...developmentOnLoopback,
      CLERK_SECRET_KEY: "clerk-secret-fixture",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "clerk-publishable-fixture"
    }, "localhost:3002")).toEqual({ demoMode: false, enabled: false, reason: "clerk" })

    expect(decideDevSession({ ...developmentOnLoopback, NEXT_PUBLIC_APP_URL: "http://10.0.0.234:3002" }, "localhost:3002"))
      .toEqual({ demoMode: false, enabled: false, reason: "non-loopback" })
  })

  it("documents the residual: a forged loopback Host is accepted, so the bind address is the real control", () => {
    expect(decideDevSession(developmentOnLoopback, "localhost:3002")).toEqual({ demoMode: false, enabled: true, reason: "development" })
  })

  it("binds every development server script to 127.0.0.1 on port 3002", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
      scripts: Record<string, string>
    }
    const devScripts = Object.entries(manifest.scripts).filter(([, command]) => /\bnext dev\b/.test(command))

    expect(devScripts.map(([name]) => name).sort()).toEqual(["dev", "dev:webpack"])

    for (const [, command] of devScripts) {
      expect(command).toMatch(/(?:^|\s)(?:-H|--hostname)\s+127\.0\.0\.1(?:\s|$)/)
      expect(command).toMatch(/(?:^|\s)-p\s+3002(?:\s|$)/)
      expect(command).not.toMatch(/0\.0\.0\.0|::(?:\s|$)/)
    }
  })
})
