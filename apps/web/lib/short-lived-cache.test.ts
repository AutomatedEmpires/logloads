import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { shortLivedCache } from "./short-lived-cache"

/** HF-09 (#187): the per-instance window behind the anonymous reads. */
describe("shortLivedCache", () => {
  let clock = 0
  const now = () => clock

  beforeEach(() => {
    clock = 1_000
  })

  it("serves one load for every caller inside the window", async () => {
    const load = vi.fn(async () => ({ value: clock }))
    const cache = shortLivedCache(10_000, load, now)

    const first = await cache.get()
    clock += 9_999
    const second = await cache.get()

    expect(load).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it("loads again once the window has passed", async () => {
    const load = vi.fn(async () => clock)
    const cache = shortLivedCache(10_000, load, now)

    await cache.get()
    clock += 10_000

    await expect(cache.get()).resolves.toBe(11_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("shares one in-flight load between concurrent callers", async () => {
    let resolve: (value: string) => void = () => undefined
    const load = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    const cache = shortLivedCache(10_000, load, now)

    const callers = [cache.get(), cache.get(), cache.get()]
    resolve("board")

    await expect(Promise.all(callers)).resolves.toEqual(["board", "board", "board"])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("keeps no failed load, so the next caller retries", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("state unavailable"))
      .mockResolvedValueOnce("board")
    const cache = shortLivedCache(10_000, load, now)

    await expect(cache.get()).rejects.toThrow("state unavailable")
    await expect(cache.get()).resolves.toBe("board")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("forgets the cached value when cleared", async () => {
    const load = vi.fn(async () => "board")
    const cache = shortLivedCache(10_000, load, now)

    await cache.get()
    cache.clear()
    await cache.get()

    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe("shortLivedCache default clock", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reads the current time on every call, so a faked clock applies", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T12:00:00.000Z"), toFake: ["Date"] })
    const load = vi.fn(async () => "board")
    const cache = shortLivedCache(10_000, load)

    await cache.get()
    vi.setSystemTime(new Date("2026-11-03T12:00:10.000Z"))
    await cache.get()

    expect(load).toHaveBeenCalledTimes(2)
  })
})
