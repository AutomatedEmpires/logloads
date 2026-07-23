import { describe, expect, it } from "vitest"

import { decideDevSession, hostnameFromHostHeader, isLoopbackAppUrl, isLoopbackHost } from "./demo-mode"

describe("local demo and development session policy", () => {
  it("recognizes only exact loopback hosts", () => {
    expect(hostnameFromHostHeader("127.0.0.1:3002")).toBe("127.0.0.1")
    expect(hostnameFromHostHeader("[::1]:3002")).toBe("::1")
    expect(isLoopbackHost("localhost:3002")).toBe(true)
    expect(isLoopbackHost("127.0.0.1.attacker.example")).toBe(false)
    expect(isLoopbackHost("127.0.0.1, attacker.example")).toBe(false)
    expect(isLoopbackAppUrl(undefined)).toBe(false)
    expect(isLoopbackAppUrl("http://127.0.0.1:3002")).toBe(true)
    expect(isLoopbackAppUrl("https://logloads.example")).toBe(false)
  })

  it("allows the founder demo only on a loopback request and app URL", () => {
    expect(decideDevSession({
      LOGLOADS_DEMO_MODE: "true",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3002",
      NODE_ENV: "development"
    }, "127.0.0.1:3002")).toEqual({ demoMode: true, enabled: true, reason: "demo" })

    expect(decideDevSession({
      LOGLOADS_DEMO_MODE: "true",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3002",
      NODE_ENV: "development"
    }, "demo.logloads.example")).toEqual({ demoMode: false, enabled: false, reason: "non-loopback" })
  })

  it("allows explicit loopback CI while denying Vercel, Clerk, and hosted app URLs", () => {
    const localProduction = {
      LOGLOADS_DEMO_MODE: "true",
      LOGLOADS_ENABLE_DEV_LOGIN: "true",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3002",
      NODE_ENV: "production"
    }

    expect(decideDevSession({ ...localProduction, CI: "true" }, "127.0.0.1:3002"))
      .toEqual({ demoMode: true, enabled: true, reason: "demo" })
    expect(decideDevSession({ ...localProduction, VERCEL: "1" }, "127.0.0.1:3002").enabled).toBe(false)
    expect(decideDevSession({ ...localProduction, CI: "true", VERCEL: "1" }, "127.0.0.1:3002").enabled).toBe(false)
    expect(decideDevSession({
      ...localProduction,
      NEXT_PUBLIC_APP_URL: "https://logloads.example"
    }, "127.0.0.1:3002").enabled).toBe(false)
    expect(decideDevSession({
      ...localProduction,
      CLERK_SECRET_KEY: "secret",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "publishable"
    }, "127.0.0.1:3002").enabled).toBe(false)
  })

  it("fails closed when the configured app URL is missing even with a spoofed loopback Host", () => {
    expect(decideDevSession({
      LOGLOADS_DEMO_MODE: "true",
      NODE_ENV: "development"
    }, "127.0.0.1:3002")).toEqual({ demoMode: false, enabled: false, reason: "non-loopback" })
  })

  it("keeps loopback production-build login available only behind its explicit flag", () => {
    expect(decideDevSession({
      LOGLOADS_ENABLE_DEV_LOGIN: "true",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3002",
      NODE_ENV: "production"
    }, "127.0.0.1:3002")).toEqual({ demoMode: false, enabled: true, reason: "local-production" })

    expect(decideDevSession({
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3002",
      NODE_ENV: "production"
    }, "127.0.0.1:3002")).toEqual({ demoMode: false, enabled: false, reason: "not-enabled" })
  })
})
