/* LogLoads low-signal service worker (#288). Served at /sw.js. */
"use strict"

const CACHE = "logloads-low-signal-v1"
const DOCUMENT_TIMEOUT_MS = 6000
const DROPPED_PARAMS = ["error", "ref", "sent", "updated", "inquiry"]

function isJobDetail(pathname) {
  if (!pathname.startsWith("/v2/work/")) return false
  const slug = pathname.slice("/v2/work/".length)
  return slug.length > 0 && !slug.includes("/")
}

function isCachedDocument(pathname) {
  return pathname === "/" || pathname === "/v2" || pathname === "/v2/work" || isJobDetail(pathname)
}

function isShellAsset(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/v2/_fonts/")
}

function cacheUrl(url) {
  const clean = new URL(url.href)
  clean.hash = ""
  DROPPED_PARAMS.forEach(function (key) {
    clean.searchParams.delete(key)
  })
  return clean.href
}

function shouldStore(url) {
  if (url.searchParams.has("_rsc") || url.searchParams.has("error")) return false
  return isCachedDocument(url.pathname)
}

function isHtml(response) {
  const type = response.headers.get("content-type") || ""
  return type === "" || type.indexOf("text/html") !== -1
}

function sameDocument(request, response) {
  if (!response.redirected) return true
  try {
    return new URL(response.url).pathname === new URL(request.url).pathname
  } catch {
    return false
  }
}

function store(request, response) {
  if (!response || !response.ok || response.type === "opaque") return Promise.resolve()
  const copy = response.clone()
  return caches.open(CACHE).then(function (cache) {
    return cache.put(request, copy)
  }).catch(function () {
    return undefined
  })
}

function storeDocument(request, response) {
  const url = new URL(request.url)
  if (!shouldStore(url) || !isHtml(response) || !sameDocument(request, response)) return Promise.resolve()
  return store(new Request(cacheUrl(url)), response)
}

function fromNetwork(request) {
  return fetch(request)
}

function timedNetwork(request) {
  return new Promise(function (resolve, reject) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      reject(new Error("slow"))
    }, DOCUMENT_TIMEOUT_MS)
    fromNetwork(request).then(function (response) {
      if (shouldStore(new URL(request.url))) storeDocument(request, response)
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(response)
    }, function (error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

function offlineDocument(url) {
  const job = isJobDetail(url.pathname)
  const title = job ? "This job isn't on this phone yet" : "You're offline"
  const body = job
    ? "Open this job once while you have signal. LogLoads then keeps it here so it opens again with no signal."
    : "The board needs a connection. Jobs you already opened stay on this phone."
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>' + title + "</title><main><h1>" + title + "</h1><p>" + body + "</p></main></html>"
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 })
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.add("/").catch(function () {
        return undefined
      })
    }).then(function () {
      return self.skipWaiting()
    })
  )
})

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE
      }).map(function (key) {
        return caches.delete(key)
      }))
    }).then(function () {
      return self.clients.claim()
    })
  )
})

self.addEventListener("fetch", function (event) {
  const request = event.request
  if (request.method !== "GET") return
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.searchParams.has("_rsc")) return

  if (isShellAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) return hit
          return fromNetwork(request).then(function (response) {
            store(request, response)
            return response
          })
        })
      })
    )
    return
  }

  if (request.mode !== "navigate" || !isCachedDocument(url.pathname)) return

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return timedNetwork(request).catch(function () {
        return cache.match(cacheUrl(url)).then(function (hit) {
          return hit || offlineDocument(url)
        })
      })
    })
  )
})
