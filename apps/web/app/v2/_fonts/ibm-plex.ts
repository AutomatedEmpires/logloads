import localFont from "next/font/local"

/**
 * IBM Plex for the V2 design system only (#148 criterion 5; 06_DESIGN_SYSTEM.md typography), self-hosted from
 * files committed next to this module. They are IBM's own Latin-1 subsets, unmodified, copied from the copyright
 * holder's npm packages @ibm/plex-sans 1.1.0, @ibm/plex-sans-condensed 2.0.0 and @ibm/plex-mono 2.5.0
 * (`fonts/split/woff2/*-Latin1.woff2`); LICENSE.txt is the SIL Open Font License 1.1 they ship with. The packages
 * themselves are not dependencies (each runs a telemetry postinstall), and nothing is fetched at build or run time.
 *
 * Only `app/v2/layout.tsx` imports this module, so legacy pages neither declare nor download these faces. next/font
 * hashes the files into /_next/static/media and adds size-adjusted fallback faces, which keeps layout shift small
 * while a face loads. Weights follow the design system: Sans 400–700, Condensed 600 and 700, Mono 500 and 600.
 * Glyphs outside Latin-1 fall through to the system stack in tokens.css.
 */

export const plexSans = localFont({
  display: "swap",
  // next/font preloads per family, so the body face is preloaded and the display and label faces are not.
  preload: true,
  src: [
    { path: "./IBMPlexSans-Regular-Latin1.woff2", style: "normal", weight: "400" },
    { path: "./IBMPlexSans-Medium-Latin1.woff2", style: "normal", weight: "500" },
    { path: "./IBMPlexSans-SemiBold-Latin1.woff2", style: "normal", weight: "600" },
    { path: "./IBMPlexSans-Bold-Latin1.woff2", style: "normal", weight: "700" }
  ]
})

export const plexSansCondensed = localFont({
  display: "swap",
  preload: false,
  src: [
    { path: "./IBMPlexSansCondensed-SemiBold-Latin1.woff2", style: "normal", weight: "600" },
    { path: "./IBMPlexSansCondensed-Bold-Latin1.woff2", style: "normal", weight: "700" }
  ]
})

export const plexMono = localFont({
  // A metric-matched Arial is not a monospace face; fall back to the mono stack in tokens.css instead.
  adjustFontFallback: false,
  display: "swap",
  preload: false,
  src: [
    { path: "./IBMPlexMono-Medium-Latin1.woff2", style: "normal", weight: "500" },
    { path: "./IBMPlexMono-SemiBold-Latin1.woff2", style: "normal", weight: "600" }
  ]
})

/**
 * Sets the faces tokens.css reads (`--ll-font-*-face`) on every `.ll-theme` root: the AppShell and any Dialog
 * portalled to <body>, which a class on the shell would not reach. Zero specificity, like the token layer.
 */
export const plexFaceDeclarations = `:where(.ll-theme){--ll-font-sans-face:${plexSans.style.fontFamily};--ll-font-display-face:${plexSansCondensed.style.fontFamily};--ll-font-mono-face:${plexMono.style.fontFamily}}`
