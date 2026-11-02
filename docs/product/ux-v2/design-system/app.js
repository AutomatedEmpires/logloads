/*
 * LogLoads prototype: components and pages.
 * Each function in C mirrors one proposed React component in component-api.ts: props in, markup out, no data
 * fetching, no entitlement or permission logic. Pages compose components. State lives in one store (S).
 * SIMULATED: sending interest, sending messages, confirming availability and reconfirming jobs only change
 * this page. Nothing is saved or sent.
 */
(() => {
  const D = window.LL_DATA;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* ---------------- icons ---------------- */
  const svg = (d, w = 1.6) => `<svg class="ll-i" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>', 1.7),
    chev: svg('<path d="m4 6 4 4 4-4"/>'),
    check: svg('<path d="m3 8.5 3.2 3L13 4.5"/>', 2),
    dash: svg('<path d="M4 8h8"/>', 1.8),
    seal: svg('<path d="M8 1.5 2.5 3.5v4c0 3.3 2.4 5.9 5.5 7 3.1-1.1 5.5-3.7 5.5-7v-4Z"/><path d="m5.6 8 1.7 1.7 3.2-3.4"/>'),
    close: svg('<path d="m4 4 8 8M12 4l-8 8"/>', 1.7),
    bm: svg('<path d="M4 2h8v12l-4-3-4 3z"/>', 1.5),
    sliders: svg('<path d="M2 4h7M12 4h2M2 12h3M8 12h6"/><circle cx="10.5" cy="4" r="1.5"/><circle cx="6.5" cy="12" r="1.5"/>', 1.5),
    plus: svg('<path d="M8 3v10M3 8h10"/>', 1.7),
    tab: {
      work: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="m13 13 4.5 4.5"/></svg>',
      inbox: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 4h14v10H8l-5 3z"/></svg>',
      truck: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 5h10v8H2zM12 8h3.5L18 10.5V13h-6z"/><circle cx="5.5" cy="14.5" r="1.5"/><circle cx="14.5" cy="14.5" r="1.5"/></svg>',
      profile: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="7" r="3.5"/><path d="M3.5 17c1-3.3 3.5-5 6.5-5s5.5 1.7 6.5 5"/></svg>',
      home: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 9 10 3l7 6v8H3z"/></svg>',
      jobs: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M6 8h8M6 12h5"/></svg>',
      more: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="5" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15" cy="10" r="1"/></svg>'
    }
  };
  /* End-grain mark: offset growth rings, a check (radial crack) and a timber pith. */
  const MARK = '<svg class="ll-brand__mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke-width="2.4"/><circle cx="16.9" cy="15.4" r="8.6" stroke-width="1.8"/><circle cx="17.5" cy="15" r="4.4" stroke-width="1.6"/><circle cx="17.8" cy="14.8" r="1.5" fill="var(--ll-color-brand-pith)" stroke="none"/><path d="M15.6 3.2 16.8 9.6" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /* ---------------- formatters (shared; production equivalents live in contracts / format.ts) ---------------- */
  const BASIS = { per_load: "per load", per_ton: "per ton", per_hour: "per hour", per_mile: "per loaded mile", per_day: "per day" };
  const F = {
    payAmount: (p) => p.unit === "negotiable" ? "Negotiable" : "$" + (p.amountCents % 100 ? (p.amountCents / 100).toFixed(2) : (p.amountCents / 100).toFixed(0)),
    payBasis: (p) => p.unit === "negotiable" ? p.note : BASIS[p.unit],
    demand: (t) => t.perDay ? `${t.perDay} trucks a day` : `${t.total} truck${t.total === 1 ? "" : "s"} for the job`,
    freshness: (j) => j.freshness === "unconfirmed" ? "Not yet confirmed" : j.freshness === "stale" ? `Last confirmed ${j.lastConfirmedAt}` : `Confirmed ${j.lastConfirmedAt}`,
    equipment: (code) => D.equipmentTypes[code] ?? code,
    fits: (j) => j.equipment.some((e) => D.viewer.hauler.setups.includes(e))
  };

  /* ================= Components ================= */
  const C = {};
  C.Button = ({ label, variant = "primary", size = "md", icon = "", iconOnly = false, act = "", attrs = "" }) =>
    `<button type="button" class="ll-btn" data-variant="${variant}" data-size="${size}" ${iconOnly ? 'data-icon-only' : ""} ${act ? `data-act="${act}"` : ""} ${attrs} ${iconOnly ? `aria-label="${esc(label)}"` : ""}>${icon}${iconOnly ? "" : esc(label)}</button>`;
  C.Segmented = ({ label, options, value, act }) =>
    `<span class="ll-seg" role="group" aria-label="${esc(label)}">${options.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${v}" aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`).join("")}</span>`;
  C.Tabs = ({ items, current, label }) => `<nav class="ll-tabs" aria-label="${esc(label)}">${items.map(([id, l, n]) => `<a class="ll-tabs__tab" href="#" ${id === current ? 'aria-current="page"' : ""}>${esc(l)}${n ? ` <span class="ll-count">${n}</span>` : ""}</a>`).join("")}</nav>`;
  C.FormField = ({ id, label, hint = "", optional = false, control }) =>
    `<div class="ll-field"><label class="ll-field__label" for="${id}">${esc(label)}${optional ? " <em>(optional)</em>" : ""}</label>${hint ? `<span class="ll-field__hint" id="${id}-hint">${esc(hint)}</span>` : ""}${control}</div>`;
  C.NumberStepper = ({ label, value, min = 0, max = null, act, key }) =>
    `<span class="ll-stepper" role="group" aria-label="${esc(label)}"><button type="button" data-act="${act}" data-k="${key}" data-d="-1" aria-label="One fewer" ${value === null || value <= min ? "disabled" : ""}>−</button><output aria-live="polite">${value ?? "?"}</output><button type="button" data-act="${act}" data-k="${key}" data-d="1" aria-label="One more" ${max !== null && value !== null && value >= max ? "disabled" : ""}>+</button></span>`;
  C.EmptyState = ({ title, body, actions = "" }) => `<div class="ll-state" data-kind="empty"><h3 class="ll-state__title">${esc(title)}</h3><p class="ll-state__body">${esc(body)}</p>${actions ? `<div class="ll-page-actions">${actions}</div>` : ""}</div>`;
  C.ErrorState = ({ title, body, actions = "" }) => `<div class="ll-state" data-kind="error" role="alert"><h3 class="ll-state__title">${esc(title)}</h3><p class="ll-state__body">${esc(body)}</p>${actions ? `<div class="ll-page-actions">${actions}</div>` : ""}</div>`;
  C.LoadingState = ({ rows = 4 }) => `<div aria-busy="true" aria-label="Loading jobs">${Array.from({ length: rows }, () => `<div class="ll-job-row" style="cursor:default"><div class="ll-job-row__pay"><span class="ll-skeleton" style="width:72px;height:24px"></span></div><div class="ll-job-row__main" style="display:grid;gap:8px"><span class="ll-skeleton" style="width:60%"></span><span class="ll-skeleton" style="width:35%"></span></div></div>`).join("")}<span class="ll-sr">Loading jobs</span></div>`;
  C.Dialog = ({ title, body, foot = "", size = "default" }) =>
    `<div class="ll-dialog-backdrop" data-act="close-dialog"><div class="ll-theme ll-dialog" data-size="${size}" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="ll-dialog__head"><h2 class="ll-dialog__title" id="dlg-title">${esc(title)}</h2>${C.Button({ label: "Close", variant: "ghost", size: "sm", icon: IC.close, iconOnly: true, act: "close-dialog" })}</div>
      <div class="ll-dialog__body">${body}</div>${foot ? `<div class="ll-dialog__foot">${foot}</div>` : ""}</div></div>`;

  C.PayFigure = ({ pay, size = "md" }) =>
    `<div class="ll-pay" data-size="${size}" data-kind="${pay.unit === "negotiable" ? "negotiable" : "rate"}"><span class="ll-pay__amount">${esc(F.payAmount(pay))}</span><span class="ll-pay__basis">${esc(F.payBasis(pay))}</span></div>`;
  C.EquipmentRequirement = ({ codes, fits }) =>
    `<div class="ll-equip"><span>${codes.map((c) => esc(F.equipment(c))).join(", ")}</span>${fits === undefined ? "" : fits ? `<small class="ll-equip__fit" data-fit="yes">${IC.check}Fits your trucks</small>` : `<small class="ll-equip__fit" data-fit="no">Not in your setups</small>`}</div>`;
  C.AvailabilityStatus = ({ state, label }) => `<span class="ll-availability" data-state="${state}">${esc(label)}</span>`;
  C.VerificationIndicator = ({ scope }) => scope ? `<span class="ll-verified">${IC.seal}${esc(scope)}</span>` : ""; // scope names exactly what was checked
  C.SponsoredIndicator = () => `<span class="ll-sponsored">Sponsored</span>`;

  C.JobResultRow = ({ job, selected = false, context = "hauler" }) => {
    const fits = context === "hauler" ? F.fits(job) : undefined;
    return `<li class="ll-job-row" ${selected ? "data-selected" : ""} data-context="${context}" ${job.sponsored ? "data-sponsored" : ""}>
      <div class="ll-job-row__pay">${C.PayFigure({ pay: job.pay })}</div>
      <div class="ll-job-row__main">${job.sponsored ? C.SponsoredIndicator() : ""}<h3 class="ll-job-row__title"><a class="ll-row-link" href="/v2/work/${job.id}" data-sel="${job.id}" ${selected ? 'aria-current="true"' : ""} aria-controls="job-detail">${esc(job.title)}</a></h3>
        <p class="ll-job-row__biz">${context === "poster" ? esc(job.landing) : esc(job.poster.name)}${context === "hauler" ? C.VerificationIndicator({ scope: job.poster.verified }) : ""}</p></div>
      <div class="ll-job-row__fresh">${C.AvailabilityStatus({ state: job.freshness, label: F.freshness(job) })}</div>
      <div class="ll-job-row__end">${context === "hauler" ? C.Button({ label: `Save ${job.title}`, variant: "secondary", size: "sm", icon: IC.bm, iconOnly: true, act: "save" }) : ""}</div>
      <dl class="ll-facts ll-job-row__facts">
        <div><dt class="ll-label">Area</dt><dd>Near ${esc(job.origin.label)}${context === "hauler" ? `<small>About ${job.origin.milesFromViewer} mi from you</small>` : "<small>Approximate area</small>"}</dd></div>
        <div><dt class="ll-label">Truck and trailer</dt><dd>${C.EquipmentRequirement({ codes: job.equipment, fits })}</dd></div>
        <div><dt class="ll-label">Schedule</dt><dd>${esc(job.startsOn)}<small>${esc(job.duration)}</small></dd></div>
        <div><dt class="ll-label">${context === "poster" ? "Interest" : "Demand"}</dt><dd>${context === "poster" ? `${job.interest.total} businesses${job.interest.new ? `<small>${job.interest.new} new</small>` : "<small>None new</small>"}` : esc(F.demand(job.trucks))}</dd></div>
      </dl></li>`;
  };
  C.JobResultList = ({ jobs, selectedId, context = "hauler", density = "comfortable", foot = "" }) =>
    `<div class="ll-results" data-density="${density}"><div class="ll-results__head ll-label" aria-hidden="true"><span>Pay</span><span>Job</span><span>Area</span><span>Truck and trailer</span><span>Start</span><span>Confirmed</span></div>
      <ul class="ll-results__list" aria-label="Jobs">${jobs.map((j) => C.JobResultRow({ job: j, selected: j.id === selectedId, context })).join("")}</ul>${foot ? `<p class="ll-results__foot">${foot}</p>` : ""}</div>`;

  C.JobDetail = ({ job, closable = false }) =>
    `<div class="ll-job-detail__head">
        <div class="ll-job-detail__top"><span>${esc(job.poster.name)} ${C.VerificationIndicator({ scope: job.poster.verified })}</span>${closable ? C.Button({ label: "Close details", variant: "ghost", size: "sm", icon: IC.close, iconOnly: true, act: "toggle-panel" }) : ""}</div>
        ${job.sponsored ? C.SponsoredIndicator() : ""}<h2 class="ll-job-detail__title">${esc(job.title)}</h2>
        ${C.PayFigure({ pay: job.pay, size: "lg" })}
        <p class="ll-job-detail__source">${job.pay.unit === "negotiable" ? "Pay is negotiable. The poster's explanation is shown above." : "Rate stated by the poster. LogLoads doesn't set or guarantee pay."}</p>
        <div class="ll-job-detail__actions">${C.Button({ label: "I'm interested", size: "lg", act: "open-interest", attrs: `data-job="${job.id}"` })}${C.Button({ label: "Save job", variant: "secondary", size: "lg", icon: IC.bm, iconOnly: true })}</div></div>
      <div class="ll-job-detail__body">
        <div class="ll-job-detail__group"><h3 class="ll-label">The haul</h3><dl class="ll-facts" data-layout="stacked">
          <dt class="ll-label">Product</dt><dd>${esc(job.product)}${job.tonsPerLoad ? `<small>About ${job.tonsPerLoad} tons a load · poster's estimate</small>` : ""}</dd>
          <dt class="ll-label">To</dt><dd>${esc(job.destination ?? "Not stated by the poster")}${job.haulDistance ? `<small>${job.haulDistance.miles} mi one way · ${job.haulDistance.basis === "poster_route_estimate" ? "poster's route estimate" : "straight-line estimate"}</small>` : ""}</dd>
          <dt class="ll-label">Equipment</dt><dd>${C.EquipmentRequirement({ codes: job.equipment, fits: F.fits(job) })}</dd></dl></div>
        <div class="ll-job-detail__group"><h3 class="ll-label">Schedule and demand</h3><dl class="ll-facts" data-layout="stacked">
          <dt class="ll-label">Start</dt><dd>${esc(job.startsOn)}<small>${esc(job.duration)}</small></dd>
          <dt class="ll-label">Trucks</dt><dd>${esc(F.demand(job.trucks))}</dd>
          <dt class="ll-label">Hours</dt><dd>${esc(job.hours)}</dd></dl></div>
        <div class="ll-job-detail__group"><h3 class="ll-label">Location</h3><dl class="ll-facts" data-layout="stacked">
          <dt class="ll-label">Area</dt><dd>Near ${esc(job.origin.label)}<small>Approximate area. The landing shares the exact site directly.</small></dd>
          <dt class="ll-label">Road</dt><dd>${esc(job.road)}</dd></dl></div></div>
      <div class="ll-job-detail__foot"><span>${job.freshness === "unconfirmed" ? "Not yet confirmed by the poster." : `${esc(F.freshness(job))} by ${esc(job.poster.name)}.`}</span><span>Free and nonbinding. The poster reviews interest and replies.</span><a href="#">Report this listing</a></div>`;

  C.GlobalNavigation = ({ context, active }) => {
    const items = context === "hauler"
      ? [["find", "Find work"], ["saved", "Saved"], ["inq-h", "Inquiries", 1], ["equipment", "Equipment"], ["bizprofile", "Business profile"]]
      : [["overview", "Overview"], ["jobs", "Jobs"], ["inbox", "Inbox", 1], ["trucks", "Find trucks"], ["landings", "Landings"], ["team", "Team"]];
    const v = context === "hauler" ? D.viewer.hauler : D.viewer.landing;
    return `<header class="ll-nav"><div class="ll-container ll-nav__inner">
      <a class="ll-brand" href="#" aria-label="LogLoads home">${MARK}<span class="ll-brand__word"><b>Log</b><span>Loads</span></span></a>
      <nav class="ll-nav__links ll-hide-below-lg" aria-label="Main">${items.map(([id, l, n]) => `<a class="ll-nav__link" href="#" ${id === active ? 'aria-current="page"' : ""}>${esc(l)}${n ? `<span class="ll-count">${n}</span>` : ""}</a>`).join("")}</nav>
      ${C.BusinessSwitcher({ viewer: v, context })}</div></header>`;
  };
  C.BusinessSwitcher = ({ viewer, context }) =>
    `<button type="button" class="ll-switcher" aria-haspopup="menu" aria-label="Acting as ${esc(viewer.name)}, ${esc(viewer.kind)}. Switch business"><span class="ll-switcher__avatar">${esc(viewer.initials)}</span><span class="ll-hide-below-lg"><span class="ll-switcher__name">${esc(viewer.name)}</span><span class="ll-switcher__role">${esc(viewer.kind)} · ${esc(context === "landing" ? viewer.plan + " plan" : viewer.role)}</span></span>${IC.chev}</button>`;
  C.ResponsiveNavigation = ({ context, active }) => {
    const items = context === "hauler"
      ? [["find", "Find work", IC.tab.work], ["inq-h", "Inquiries", IC.tab.inbox], ["equipment", "Equipment", IC.tab.truck], ["bizprofile", "Profile", IC.tab.profile]]
      : [["overview", "Overview", IC.tab.home], ["jobs", "Jobs", IC.tab.jobs], ["inbox", "Inbox", IC.tab.inbox], ["trucks", "Trucks", IC.tab.truck], ["more", "More", IC.tab.more]];
    return `<nav class="ll-bottom-nav" aria-label="Main">${items.map(([id, l, i]) => `<a href="#" ${id === active ? 'aria-current="page"' : ""}>${i}${esc(l)}</a>`).join("")}</nav>`;
  };
  C.AppShell = ({ context, active, children, overlay = "" }) =>
    `<div class="ll-proto">Prototype content. Every business, job and verification mark is fictional. Actions marked "simulated" change only this page.</div>
     ${C.GlobalNavigation({ context, active })}<main id="main">${children}</main>${C.ResponsiveNavigation({ context, active })}${overlay}`;
  C.PageContainer = ({ children, width = "default" }) => `<div class="ll-container" ${width === "narrow" ? 'data-width="narrow"' : ""}>${children}</div>`;
  C.PageHeader = ({ crumb = "", title, description = "", meta = "", actions = "", slot = "", tabs = "" }) =>
    `<section class="ll-page-header" ${tabs ? "data-tabs" : ""}><div class="ll-container ll-page-header__inner">
      <div style="min-width:0">${crumb ? `<p class="ll-page-header__crumb">${crumb}</p>` : ""}<h1 class="ll-page-header__title">${esc(title)}</h1>${description ? `<p class="ll-page-header__desc">${description}</p>` : ""}${meta ? `<div class="ll-page-header__meta">${meta}</div>` : ""}</div>
      ${actions ? C.PageActions({ children: actions }) : ""}${slot ? `<div style="grid-column:1/-1">${slot}</div>` : ""}${tabs ? `<div class="ll-page-header__tabs">${tabs}</div>` : ""}</div></section>`;
  C.PageActions = ({ children }) => `<div class="ll-page-actions">${children}</div>`;
  C.ContentGrid = ({ layout = "single", detail = false, main, aside = "" }) =>
    `<div class="ll-grid" data-layout="${layout}" ${layout === "list-detail" ? `data-detail="${detail ? "open" : "closed"}"` : ""}><div class="ll-grid__col">${main}</div>${aside ? (layout === "list-detail" ? aside : `<div class="ll-grid__col">${aside}</div>`) : ""}</div>`;
  C.Section = ({ title = "", description = "", actions = "", children, variant = "surface", label = "" }) =>
    `<section class="ll-section" data-variant="${variant}" ${title ? `aria-label="${esc(label || title)}"` : ""}>${title ? `<div class="ll-section__head"><div><h2 class="ll-section__title">${esc(title)}</h2>${description ? `<p class="ll-section__desc">${description}</p>` : ""}</div>${actions}</div>` : ""}${children}</section>`;
  C.SearchToolbar = ({ location, radius, equipment }) =>
    `<form class="ll-search ll-hide-below-lg" role="search" onsubmit="return false"><div class="ll-search__field"><span>Hauling from</span><b>${esc(location)}</b></div><div class="ll-search__field"><span>Within</span><b>${esc(radius)}</b></div><div class="ll-search__field"><span>Equipment</span><b>${esc(equipment)}</b></div>${C.Button({ label: "Search", size: "lg", icon: IC.search })}</form>
     <button type="button" class="ll-search__summary ll-show-below-lg">${IC.search}<span><b>Near ${esc(location.split(",")[0])} · ${esc(radius.replace(" miles", " mi"))}</b><small>${esc(equipment)} · Starting this month</small></span></button>`;
  C.FilterBar = ({ filters, clear = true }) =>
    `<nav class="ll-filterbar" aria-label="Filters"><div class="ll-container ll-filterbar__inner">
      <button type="button" class="ll-filter ll-show-below-lg">${IC.sliders}<b>Filters · ${filters.filter((f) => f.active).length}</b></button>
      ${filters.map((f) => `<button type="button" class="ll-filter ${f.wideOnly ? "ll-hide-below-lg" : ""}" ${f.active ? "data-active" : ""}><small>${esc(f.label)}</small> <b>${esc(f.value)}</b>${IC.chev}</button>`).join("")}
      <button type="button" class="ll-filter ll-hide-below-lg">${IC.sliders}More filters</button>${clear ? '<button type="button" class="ll-filterbar__clear ll-hide-below-lg">Clear all</button>' : ""}</div></nav>`;
  C.DetailPanel = ({ label, children }) => `<aside class="ll-detail-panel" id="job-detail" aria-label="${esc(label)}" tabindex="-1">${children}</aside>`;

  C.CompanyProfileHeader = ({ biz, actions, note }) =>
    `<section class="ll-company"><div class="ll-container ll-company__inner">
      <p class="ll-page-header__crumb" style="margin:0"><a href="#">Find trucks</a> / Hauling businesses</p>
      <div class="ll-company__top"><div class="ll-company__id"><span class="ll-company__logo" aria-hidden="true">${esc(biz.initials)}</span><div style="min-width:0">
          <h1 class="ll-company__name">${esc(biz.name)}</h1>
          <p class="ll-company__meta"><span>${esc(biz.kind)}</span><span>${esc(biz.home)}</span><span>Hauling since ${biz.since}</span></p>
          <p class="ll-company__verify"><span class="ll-verified">${IC.seal}Business identity verified by LogLoads · ${esc(biz.verification.date)}</span><a href="#verification">What was checked</a></p></div></div>
        <div class="ll-company__actions"><div class="ll-page-actions">${actions}</div>${note ? `<small>${esc(note)}</small>` : ""}</div></div>
      ${C.CapabilityFigures({ biz })}</div></section>`;
  C.CapabilityFigures = ({ biz }) => {
    const units = biz.equipment.reduce((a, e) => a + e.units, 0), avail = biz.equipment.reduce((a, e) => a + (e.available ?? 0), 0);
    return `<dl class="ll-figures">${[[units, "trucks listed"], [avail, "available from Nov 10 · updated today"], [`${biz.region.radiusMiles} mi`, `around ${biz.region.home.split(",")[0]} · ${biz.region.counties.length} counties`], [biz.products.length, `products: ${biz.products.join(", ").toLowerCase()}`]].map(([v, l]) => `<div class="ll-figure"><dt class="ll-sr">${esc(l)}</dt><dd style="margin:0;display:grid;gap:2px"><b>${esc(v)}</b><span>${esc(l)}</span></dd></div>`).join("")}</dl>`;
  };
  C.EquipmentCapacity = ({ units, available, state }) =>
    `<div class="ll-capacity" data-state="${state === "unknown" ? "unknown" : "known"}"><span class="ll-capacity__marks" aria-hidden="true">${Array.from({ length: units }, (_, i) => `<i ${available !== null && i < available ? "data-on" : ""}></i>`).join("")}</span>
      <span class="ll-capacity__text">${state === "unknown" ? `${units} units · availability not recently confirmed` : `${available} of ${units} available`}</span></div>`;
  C.OperatingRegion = ({ region }) =>
    `<div class="ll-region"><svg viewBox="0 0 104 104" aria-hidden="true"><rect x="1" y="1" width="102" height="102" rx="10" fill="var(--ll-color-surface-sunken)"/><path d="M6 66 C28 58 42 74 62 62 S90 52 98 58" stroke="var(--ll-color-border-strong)" stroke-width="2" fill="none"/><circle cx="52" cy="52" r="38" fill="none" stroke="var(--ll-color-brand)" stroke-width="1.5" stroke-dasharray="4 3"/><circle cx="52" cy="52" r="4" fill="var(--ll-color-text)"/></svg>
      <ul><li>Home base: <b>${esc(region.home)}</b></li><li>${esc(region.counties.join(", "))} counties</li><li>Up to ${region.radiusMiles} miles</li></ul></div>`;
  C.InquiryRow = ({ inq, selected }) =>
    `<li class="ll-inquiry-row" ${selected ? "data-selected" : ""}>
      <div class="ll-inquiry-row__top"><a class="ll-row-link ll-inquiry-row__name" href="#conversation" data-inq="${inq.id}" ${selected ? 'aria-current="true"' : ""}>${esc(inq.name)}</a><span class="ll-inquiry-row__time">${esc(inq.time)}</span></div>
      <div class="ll-inquiry-row__offer">${inq.offer.map(([o, m]) => m ? `<div>${esc(o)} <span class="ll-equip__fit">${IC.check}matches</span></div>` : `<div style="color:var(--ll-color-text-muted)">${esc(o)} · not requested</div>`).join("")}</div>
      <div class="ll-inquiry-row__state" data-state="${inq.state}">${inq.state === "new" ? "New" : inq.state === "seen" ? "Seen · not answered" : "You replied · waiting for the hauler"} · from ${esc(inq.from)}</div></li>`;
  C.ConversationThread = ({ inq, sent }) =>
    `<div class="ll-thread" aria-label="Conversation" aria-live="polite"><span class="ll-thread__system">Interest sent ${esc(inq.sentAt)}</span>
      ${inq.note ? `<div class="ll-msg" data-side="them"><p>${esc(inq.note)}</p><small>${esc(inq.name)}</small></div>` : ""}
      ${(inq.thread ?? []).map((m) => `<div class="ll-msg" data-side="${m.side}"><p>${esc(m.text)}</p><small>${esc(m.at)}</small></div>`).join("")}
      ${sent.map((t) => `<div class="ll-msg" data-side="me"><p>${esc(t)}</p><small>You · just now · simulated, not sent</small></div>`).join("")}</div>`;
  C.MessageComposer = ({ to, draft, quick }) =>
    `<div class="ll-composer"><div class="ll-composer__quick">${quick.map((q) => `<button type="button" data-act="quick" data-v="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <div class="ll-composer__box"><textarea class="ll-input" id="composer" aria-label="Reply to ${esc(to)}">${esc(draft)}</textarea>${C.Button({ label: "Send", act: "send" })}</div>
      <div class="ll-composer__foot"><span>Replies are free and unlimited. Nothing here books a truck.</span>${C.Button({ label: "Decline", variant: "danger", size: "sm" })}</div></div>`;

  /* ================= Store ================= */
  let returnFocus = null; // selector of the control that opened the dialog
  const S = { screen: "find", w: 1440, density: "comfortable", panel: true, sel: "oak", state: "loaded", dialog: null, interestSent: false, photos: true,
    inq: "rh", drafts: {}, sent: {}, theme: "forest", corners: "standard",
    eq: JSON.parse(JSON.stringify(D.business.equipment)), confirmed: false, radius: 120 };

  /* ================= Pages ================= */
  const pages = {};
  pages.find = () => {
    const job = D.jobs.find((j) => j.id === S.sel) ?? D.jobs[0];
    const tools = `<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--ll-space-3);flex-wrap:wrap">
        <p style="color:var(--ll-color-text-secondary)"><b style="color:var(--ll-color-text)">6 jobs</b> within 100 miles of Sweet Home</p>
        <div class="ll-page-actions" style="justify-content:flex-end"><button type="button" class="ll-filter">Newest confirmed ${IC.chev}</button>
          <span class="ll-hide-below-lg">${C.Segmented({ label: "Density", options: [["comfortable", "Comfortable"], ["compact", "Compact"]], value: S.density, act: "density" })}</span>
          <span class="ll-hide-below-lg">${C.Button({ label: S.panel ? "Hide details" : "Show details", variant: "secondary", size: "sm", act: "toggle-panel", attrs: `aria-pressed="${S.panel}"` })}</span>
          ${C.Segmented({ label: "View", options: [["list", "List"], ["map", "Map"]], value: "list", act: "noop" })}</div></div>`;
    const list = S.state === "loading" ? `<div class="ll-results">${C.LoadingState({ rows: 4 })}</div>`
      : S.state === "empty" ? `<div class="ll-results">${C.EmptyState({ title: "No jobs match within 100 miles", body: "Nothing fits your 3 truck setups starting this month. LogLoads lists only real postings, so try a wider area or any start date.", actions: C.Button({ label: "Widen to 150 mi", variant: "secondary", size: "sm" }) + C.Button({ label: "Any start date", variant: "secondary", size: "sm" }) })}</div>`
      : S.state === "error" ? `<div class="ll-results">${C.ErrorState({ title: "Jobs couldn't load", body: "Your filters are kept. Check your connection and try again.", actions: C.Button({ label: "Try again", variant: "secondary", size: "sm" }) })}</div>`
      : C.JobResultList({ jobs: D.jobs, selectedId: S.sel, density: S.density, foot: "Rates use different bases (load, ton, hour, mile). Sorting by pay compares jobs within one basis only." });
    return C.AppShell({ context: "hauler", active: "find",
      children: C.PageHeader({ title: "Find hauling work", description: "Real jobs from landing operators. Free for haulers.", slot: C.SearchToolbar({ location: "Sweet Home, OR", radius: "100 miles", equipment: "My trucks · 3 setups" }) })
        + C.FilterBar({ filters: [{ label: "Truck and trailer", value: "My 3 setups", active: true }, { label: "Product", value: "Any" }, { label: "Pay basis", value: "Any", wideOnly: true }, { label: "Starting", value: "This month", active: true }] })
        + C.PageContainer({ children: C.ContentGrid({ layout: "list-detail", detail: S.panel && S.state === "loaded", main: tools + list, aside: C.DetailPanel({ label: "Job details", children: C.JobDetail({ job, closable: true }) }) }) }),
      overlay: dialogFor() });
  };
  pages.profile = () => {
    const b = D.business;
    return C.AppShell({ context: "landing", active: "trucks",
      children: C.CompanyProfileHeader({ biz: b, actions: C.Button({ label: "Invite to a job", size: "lg", act: "noop" }) + C.Button({ label: "Save", variant: "secondary", size: "lg", icon: IC.bm }), note: "7 of 10 invitations left this billing cycle" })
        + C.PageContainer({ children: C.ContentGrid({ layout: "main-aside",
          main: C.Section({ title: "Equipment and availability", description: "Self-reported by Ridgeline Hauling. This is what they last told LogLoads, not live tracking.",
              children: `<div class="ll-eq-list">${b.equipment.map((e) => `<div class="ll-eq"><div><span class="ll-eq__name">${esc(F.equipment(e.type))}</span><span class="ll-eq__spec">${esc(e.spec)}</span></div>${C.EquipmentCapacity({ units: e.units, available: e.available, state: e.state })}${C.AvailabilityStatus({ state: e.state === "unknown" ? "stale" : "confirmed", label: e.state === "unknown" ? `Last update ${e.updated.split(" by")[0]}` : e.state === "unavailable" ? `Next available ${e.from}` : `From ${e.from}` })}</div>`).join("")}</div>` })
            + (S.photos ? C.Section({ title: "Equipment photos", description: "Supplied by the business. The page is complete without them.", children: `<div class="ll-gallery">${b.photos.map((p, i) => `<figure class="ll-photo" style="margin:0">${land(i)}<figcaption>${esc(p.caption)}</figcaption></figure>`).join("")}</div>` }) : "")
            + C.Section({ title: "About", children: `<p style="color:var(--ll-color-text-secondary);max-width:68ch;line-height:var(--ll-leading-relaxed)">${esc(b.about)}</p><p style="font-size:var(--ll-text-md);color:var(--ll-color-text-secondary)">Hauls ${esc(b.products.join(", ").toLowerCase())}.</p>` }),
          aside: C.Section({ title: "Operating region", children: C.OperatingRegion({ region: b.region }) })
            + `<div id="verification">${C.Section({ title: "Verification", description: `Reviewed by LogLoads, ${esc(b.verification.date)}.`, children: `<ul class="ll-checklist">${b.verification.checked.map((c) => `<li data-ok>${IC.check}<span>${esc(c)}</span></li>`).join("")}${b.verification.notChecked.map((c) => `<li>${IC.dash}<span>${esc(c)} not checked by LogLoads</span></li>`).join("")}</ul>` })}</div>`
            + C.Section({ title: "Contact", children: `<p style="font-size:var(--ll-text-md);color:var(--ll-color-text-secondary)">Prefers ${esc(b.contact)}. Invite them to a job, or reply when they send interest. Phone and address are private.</p>` }) }) }) });
  };
  pages.equipment = () => {
    const units = S.eq.reduce((a, e) => a + e.units, 0), avail = S.eq.reduce((a, e) => a + (e.state === "unknown" ? 0 : e.available ?? 0), 0);
    const row = (e, i) => {
      const stale = e.state === "unknown";
      return `<div class="ll-avail-row" ${stale ? "data-stale" : ""}><div><span class="ll-eq__name">${esc(F.equipment(e.type))}</span><span class="ll-eq__spec">${esc(e.spec)}</span>
          <div style="margin-top:var(--ll-space-3)">${C.EquipmentCapacity({ units: e.units, available: stale ? null : e.available, state: stale ? "unknown" : "known" })}</div></div>
        <div class="ll-avail-row__controls">
          <div class="ll-avail-row__line">${C.Segmented({ label: `Availability for ${F.equipment(e.type)}`, options: [["available_now", "Available now"], ["available_from", "From a date"], ["unavailable", "Not available"]], value: e.state, act: `eqstate:${i}` })}</div>
          ${e.state === "unknown" ? `<p class="ll-avail-row__note">Not confirmed since ${esc(e.updated.split(" by")[0])}. Landings see "not recently confirmed", never "0 available". Pick a status to update it.</p>` : `
          <div class="ll-avail-row__line">${e.state !== "unavailable" ? `<span style="font-size:var(--ll-text-md)">Trucks available</span>${C.NumberStepper({ label: "Trucks available", value: e.available, min: 0, max: e.units, act: "eqcount", key: i })}<span style="font-size:var(--ll-text-sm);color:var(--ll-color-text-muted)">of ${e.units}</span>` : ""}
            ${e.state !== "available_now" ? `<span style="font-size:var(--ll-text-md)">${e.state === "unavailable" ? "Next available" : "From"}</span><input class="ll-input" style="width:140px" aria-label="Date" value="${esc(e.from ?? "")}">` : ""}</div>
          <p class="ll-avail-row__note">Updated ${esc(S.confirmed ? "just now by you (simulated, not saved)" : e.updated.charAt(0).toLowerCase() + e.updated.slice(1))}</p>`}</div></div>`;
    };
    return C.AppShell({ context: "hauler", active: "equipment",
      children: C.PageHeader({ title: "Equipment and availability", description: "Self-reported. Landing operators see what you confirm here, with the date. LogLoads never uses GPS.",
          meta: `<span><b class="ll-num">${units}</b> trucks listed</span><span><b class="ll-num">${avail}</b> available</span>${C.AvailabilityStatus({ state: S.confirmed ? "confirmed" : "stale", label: S.confirmed ? "Confirmed just now · simulated" : "1 setup not recently confirmed" })}`,
          actions: C.Button({ label: "Add a setup", variant: "secondary", icon: IC.plus }) + C.Button({ label: "Confirm all as shown", act: "confirm-all" }) })
        + C.PageContainer({ children: C.ContentGrid({ layout: "main-aside",
          main: C.Section({ title: "Your setups", description: "One row per truck-and-trailer setup. Counts can't exceed the trucks you list.", children: S.eq.map(row).join("") }),
          aside: C.Section({ title: "What landing operators see", children: `<div class="ll-preview"><b>Ridgeline Hauling</b>${S.eq.map((e) => `<div style="display:grid;gap:2px"><span style="font-size:var(--ll-text-md)">${esc(F.equipment(e.type))}</span>${C.AvailabilityStatus({ state: e.state === "unknown" ? "stale" : e.state === "unavailable" ? "aging" : "confirmed", label: e.state === "unknown" ? "Not recently confirmed" : e.state === "unavailable" ? `None available until ${e.from}` : `${e.available} available ${e.state === "available_now" ? "now" : "from " + e.from}` })}</div>`).join("")}</div>` })
            + C.Section({ title: "Service area", children: C.FormField({ id: "home", label: "Home base", hint: "Town or ZIP. Shown as a town, never an address.", control: '<input class="ll-input" id="home" value="Sweet Home, OR" aria-describedby="home-hint">' })
              + `<div class="ll-field"><span class="ll-field__label">Works up to</span>${C.Segmented({ label: "Service radius", options: [[50, "50 mi"], [100, "100 mi"], [120, "120 mi"], [250, "250+ mi"]], value: S.radius, act: "radius" })}</div>` }) }) }) });
  };
  pages.overview = () => {
    const o = D.landingOverview, jobs = o.jobs.map((id) => D.jobs.find((j) => j.id === id));
    const meter = (l, [a, b], sub) => `<div class="ll-usage__row"><div><span>${esc(l)}</span><b class="ll-num">${a} of ${b}</b></div><span class="ll-meter" aria-hidden="true"><i style="width:${(a / b) * 100}%"></i></span>${sub ? `<span style="font-size:var(--ll-text-sm);color:var(--ll-color-text-muted)">${esc(sub)}</span>` : ""}</div>`;
    return C.AppShell({ context: "landing", active: "overview",
      children: C.PageHeader({ title: "Overview", description: "Cedar Fork Logging · Pro plan", actions: C.Button({ label: "Inbox", variant: "secondary", act: "go", attrs: 'data-go="inquiry"' }) + C.Button({ label: "Post a job", icon: IC.plus }) })
        + C.PageContainer({ children: C.ContentGrid({ layout: "main-aside",
          main: C.Section({ title: "Needs attention", children: `<ul class="ll-attention">${o.attention.map((a) => `<li><p>${esc(a.text)}<small>${esc(a.sub)}</small></p>${C.Button({ label: a.action, variant: "secondary", size: "sm", act: a.go ? "go" : "noop", attrs: a.go ? `data-go="${a.go}"` : "" })}</li>`).join("")}</ul>` })
            + C.Section({ variant: "flush", title: "Your jobs", description: "Published jobs at your active landings.", actions: C.Button({ label: "All jobs", variant: "ghost", size: "sm" }),
              children: C.JobResultList({ jobs, selectedId: null, context: "poster", density: S.density }) }),
          aside: C.Section({ title: "This billing cycle", children: `<div class="ll-usage">${meter("Active landings", o.plan.landings)}${meter("Team members", o.plan.seats)}${meter("Invitations left", o.plan.invitations, `Resets ${o.plan.resets}. Unused invitations don't roll over.`)}</div><p style="font-size:var(--ll-text-sm);color:var(--ll-color-text-muted)">Job posts, inquiries and replies are unlimited.</p>` })
            + C.Section({ title: "Landings", children: `<ul class="ll-attention">${o.landings.map((l) => `<li><p>${esc(l.name)}<small>${esc(l.area)} · ${l.jobs} job${l.jobs === 1 ? "" : "s"}</small></p>${C.AvailabilityStatus({ state: l.state.startsWith("Paused") ? "unknown" : "confirmed", label: l.state })}</li>`).join("")}</ul>` }) }) }) });
  };
  pages.inquiry = () => {
    const q = D.inquiries.find((x) => x.id === S.inq) ?? D.inquiries[0], job = D.jobs[0];
    const draft = S.drafts[q.id] ?? (q.id === "rh" ? "Can you start Tuesday at 5 a.m.? Gate opens at 4:45." : "");
    return C.AppShell({ context: "landing", active: "jobs",
      children: C.PageHeader({ crumb: '<a href="#">Jobs</a> / Hills Creek Unit 4', title: job.title,
          meta: `${C.AvailabilityStatus({ state: "confirmed", label: "Accepting interest" })}${C.PayFigure({ pay: job.pay, size: "sm" })}<span>Near ${esc(job.origin.label)}</span><span>${esc(F.equipment(job.equipment[0]))}</span><span>${esc(job.startsOn)} · ${esc(job.duration.toLowerCase())}</span><span>${esc(F.demand(job.trucks))}</span>`,
          description: `<span style="font-size:var(--ll-text-sm);color:var(--ll-color-text-muted)">${S.reconfirmed ? "Availability reconfirmed just now (simulated, not saved)." : "Availability confirmed by Dana L. today at 6:12 AM, when the job was published."} Edits don't change this date.</span>`,
          actions: C.Button({ label: "Reconfirm availability", variant: "secondary", act: "reconfirm" }) + C.Button({ label: "Edit listing", variant: "secondary" }) + C.Button({ label: "Pause", variant: "ghost" }),
          tabs: C.Tabs({ label: "Job sections", current: "interest", items: [["interest", "Interest", 3], ["listing", "Listing as haulers see it"], ["activity", "Activity"]] }) })
        + C.PageContainer({ children: C.ContentGrid({ layout: "split",
          main: `<ul class="ll-inquiries" aria-label="Hauling businesses interested in this job">${D.inquiries.map((x) => C.InquiryRow({ inq: x, selected: x.id === q.id })).join("")}</ul>`,
          aside: `<section class="ll-conv" id="conversation" tabindex="-1" aria-label="Conversation with ${esc(q.name)}"><div class="ll-conv__head"><div style="display:flex;justify-content:space-between;gap:var(--ll-space-3);flex-wrap:wrap;align-items:flex-start"><div><h2 class="ll-conv__title">${esc(q.name)}</h2><p class="ll-conv__sub">${esc(q.kind)}${q.verified ? C.VerificationIndicator({ scope: "Business identity verified" }) : ""}</p></div>${C.Button({ label: "View profile", variant: "secondary", size: "sm", act: "go", attrs: 'data-go="profile"' })}</div>
              <dl class="ll-facts" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))"><div><dt class="ll-label">Offers</dt><dd>${esc(q.offer.map(([o]) => o).join(", "))}<small>Self-reported by the hauler</small></dd></div><div><dt class="ll-label">Available</dt><dd>From ${esc(q.from)}<small>${esc(q.updated)}</small></dd></div><div><dt class="ll-label">Prefers</dt><dd>LogLoads messages<small>Phone shared only if they choose</small></dd></div></dl></div>
            ${C.ConversationThread({ inq: q, sent: S.sent[q.id] ?? [] })}${C.MessageComposer({ to: q.name, draft, quick: ["Can you start on Nov 10?", "Please confirm your trailer type", "We'll be in touch"] })}</section>` }) }) });
  };

  function dialogFor() {
    if (!S.dialog) return "";
    const job = D.jobs.find((j) => j.id === S.dialog.job) ?? D.jobs[0];
    if (S.dialog.kind === "detail") return C.Dialog({ title: "Job details", size: "wide", body: `<div style="margin:0 calc(-1 * var(--ll-space-5))">${C.JobDetail({ job })}</div>` });
    if (S.interestSent) return C.Dialog({ title: "Interest ready to send", body: `<p>In the live product, Cedar Fork Logging would receive your interest: 2 × Log truck + pole trailer, from Nov 10.</p><p style="color:var(--ll-color-status-warning);font-weight:var(--ll-weight-semibold)">Simulated. Nothing was sent.</p>`, foot: C.Button({ label: "Done", act: "close-dialog" }) });
    return C.Dialog({ title: `Interest in "${job.title}"`,
      body: `<p style="color:var(--ll-color-text-secondary);font-size:var(--ll-text-md)">Sending as <b>Ridgeline Hauling</b> to ${esc(job.poster.name)}. Free and nonbinding.</p>
        <div class="ll-field"><span class="ll-field__label">Trucks you can offer</span><div style="display:flex;align-items:center;gap:var(--ll-space-3);flex-wrap:wrap"><span>${esc(F.equipment(job.equipment[0]))}</span>${C.NumberStepper({ label: "Trucks offered", value: S.offer ?? 2, min: 1, max: null, act: "offer", key: 0 })}</div>
          ${(S.offer ?? 2) > 4 ? '<span class="ll-field__error">You reported 4 available. You can still send, or update your availability first.</span>' : '<span class="ll-field__hint">4 available from Nov 10 (from Equipment and availability)</span>'}</div>
        ${C.FormField({ id: "from", label: "Available from", hint: "Prefilled from your availability", control: '<input class="ll-input" id="from" value="Nov 10, 2026" aria-describedby="from-hint">' })}
        ${C.FormField({ id: "note", label: "Note", optional: true, control: '<textarea class="ll-input" id="note">Both trucks can run Tuesdays and Thursdays.</textarea>' })}`,
      foot: C.Button({ label: "Cancel", variant: "secondary", act: "close-dialog" }) + C.Button({ label: "Send interest (simulated)", act: "send-interest" }) });
  }
  const land = (seed) => { const t = [["#e3e9e4", "#c5d3ca", "#9fb4a6", "#4f6c5d"], ["#e9ebe4", "#d2d8c6", "#b1bea4", "#5f7353"], ["#e4e8ea", "#c9d4d9", "#a7b8c0", "#536b76"]][seed % 3], h = [0.6, 0.5, 0.66][seed % 3];
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true"><rect width="400" height="300" fill="${t[0]}"/><path d="M0 ${300 * h} C90 ${300 * h - 50} 160 ${300 * h + 10} 240 ${300 * h - 35} S350 ${300 * h - 45} 400 ${300 * h - 20} V300 H0Z" fill="${t[1]}"/><path d="M0 ${300 * h + 50} C110 ${300 * h + 15} 200 ${300 * h + 65} 290 ${300 * h + 30} S370 ${300 * h + 25} 400 ${300 * h + 40} V300 H0Z" fill="${t[2]}"/>${Array.from({ length: 12 }, (_, i) => `<path d="M${20 + i * 32 + seed * 5} ${300 * h - 8 - ((i * 17 + seed * 7) % 26)} l9 -26 l9 26 z" fill="${t[3]}"/>`).join("")}</svg>`; };

  /* ================= Review harness (not product UI) ================= */
  const SCREENS = [["find-desktop", "Find work · desktop", "find", 1440], ["find-mobile", "Find work · mobile", "find", 390], ["profile", "Hauler business profile", "profile"], ["equipment", "Equipment and availability", "equipment"], ["overview", "Landing workspace", "overview"], ["inquiry", "Inquiry and conversation", "inquiry"]];
  const THEMES = { forest: {}, spruce: { "--ll-color-action": "#1d5c6b", "--ll-color-action-hover": "#174b58", "--ll-color-brand": "#1d5c6b", "--ll-color-nav-active": "#1d5c6b", "--ll-color-selected-indicator": "#1d5c6b", "--ll-color-status-positive": "#1d5c6b", "--ll-color-action-subtle": "#eaf3f5", "--ll-color-action-subtle-border": "#cfe2e7", "--ll-color-selected-bg": "#f0f6f7" }, charcoal: { "--ll-color-action": "#262f2b", "--ll-color-action-hover": "#151a18", "--ll-color-nav-active": "#262f2b", "--ll-color-selected-indicator": "#262f2b" } };
  const CORNERS = { standard: {}, square: { "--ll-radius-md": "3px", "--ll-radius-lg": "4px", "--ll-radius-xl": "6px", "--ll-c-section-radius": "4px", "--ll-c-button-radius": "3px", "--ll-c-field-radius": "3px" } };
  const stage = document.getElementById("stage"), vp = document.getElementById("vp");
  let screenId = "find-desktop";
  const segHtml = (items, cur, key) => items.map(([v, l]) => `<button type="button" data-k="${key}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${esc(l)}</button>`).join("");
  function fit() {
    const avail = stage.clientWidth, w = S.w === "fit" ? avail : Number(S.w), scale = Math.min(1, avail / w);
    vp.style.width = w + "px"; vp.style.transform = `scale(${scale})`; vp.style.left = Math.max(0, (avail - w * scale) / 2) + "px";
    stage.style.height = Math.ceil(vp.scrollHeight * scale) + "px";
    document.getElementById("cap-r").textContent = S.w === "fit" ? `Actual size · ${Math.round(avail)} px` : scale < 1 ? `${w} px, shown at ${Math.round(scale * 100)}%` : `${w} px, actual size`;
  }
  function render(keep) {
    document.getElementById("c-screen").innerHTML = segHtml(SCREENS.map(([id, l]) => [id, l]), screenId, "screen");
    document.getElementById("c-w").innerHTML = segHtml([[1440, "1440"], [1280, "1280"], [1024, "1024"], [768, "768"], [390, "390"], ["fit", "Fit"]], S.w, "w");
    document.getElementById("c-theme").innerHTML = segHtml([["forest", "Forest (default)"], ["spruce", "Spruce"], ["charcoal", "Charcoal"]], S.theme, "theme");
    document.getElementById("c-corners").innerHTML = segHtml([["standard", "Standard"], ["square", "Square"]], S.corners, "corners");
    document.getElementById("c-state").innerHTML = segHtml([["loaded", "Results"], ["loading", "Loading"], ["empty", "Empty"], ["error", "Error"]], S.state, "state");
    document.getElementById("c-photos").innerHTML = segHtml([["true", "With photos"], ["false", "Without"]], String(S.photos), "photos");
    document.getElementById("ctl-state").hidden = S.screen !== "find";
    document.getElementById("ctl-photos").hidden = S.screen !== "profile";
    const vars = { ...THEMES[S.theme], ...CORNERS[S.corners] };
    const y = window.scrollY;
    vp.innerHTML = `<div class="ll-theme ll-app" style="${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}">${pages[S.screen]()}</div>`;
    document.getElementById("cap-l").textContent = SCREENS.find((s) => s[0] === screenId)[1];
    requestAnimationFrame(() => { fit(); if (keep) window.scrollTo(0, y); const d = vp.querySelector(".ll-dialog");
      if (d && keep === "dialog") d.querySelector("input, textarea, [data-act='send-interest'], button")?.focus();
      if (!d && returnFocus) { vp.querySelector(returnFocus)?.focus(); returnFocus = null; } });
  }
  document.addEventListener("click", (e) => {
    const k = e.target.closest("[data-k]");
    if (k && !e.target.closest("#vp")) {
      const key = k.dataset.k, v = k.dataset.v;
      if (key === "screen") { const s = SCREENS.find((x) => x[0] === v); screenId = v; S.screen = s[2]; if (s[3]) S.w = s[3]; S.dialog = null; }
      else if (key === "w") { S.w = v === "fit" ? "fit" : Number(v); const s = SCREENS.find((x) => x[0] === screenId); if (s[2] === "find") screenId = S.w === 390 ? "find-mobile" : "find-desktop"; }
      else if (key === "photos") S.photos = v === "true";
      else S[key] = v;
      render(); return;
    }
    if (!e.target.closest("#vp")) return;
    if (e.target.closest("[data-stop]") && !e.target.closest("[data-act]")) { if (e.target.closest(".ll-dialog")) return; }
    const a = e.target.closest("[data-act]");
    if (a) {
      e.preventDefault();
      const act = a.dataset.act;
      if (act === "close-dialog" && a.classList.contains("ll-dialog-backdrop") && e.target !== a) return;
      if (act === "density") S.density = a.dataset.v;
      else if (act === "toggle-panel") S.panel = !S.panel;
      else if (act === "open-interest") { returnFocus = `[data-act="open-interest"][data-job="${a.dataset.job}"]`; S.dialog = { kind: "interest", job: a.dataset.job }; S.interestSent = false; render("dialog"); return; }
      else if (act === "close-dialog") { S.dialog = null; S.interestSent = false; }
      else if (act === "send-interest") S.interestSent = true;
      else if (act === "offer") S.offer = Math.max(1, (S.offer ?? 2) + Number(a.dataset.d));
      else if (act.startsWith("eqstate:")) { const e2 = S.eq[Number(act.split(":")[1])]; e2.state = a.dataset.v; if (e2.available === null) e2.available = e2.state === "unavailable" ? 0 : e2.units; if (e2.state === "unavailable") e2.available = 0; if (!e2.from) e2.from = "Nov 12"; e2.updated = "just now by you (simulated, not saved)"; }
      else if (act === "eqcount") { const e2 = S.eq[Number(a.dataset.k)]; e2.available = Math.min(e2.units, Math.max(0, e2.available + Number(a.dataset.d))); }
      else if (act === "confirm-all") { S.confirmed = true; S.eq.forEach((x) => { if (x.state === "unknown") { x.state = "unavailable"; x.available = 0; x.from = x.from ?? "Nov 12"; } }); }
      else if (act === "radius") S.radius = Number(a.dataset.v);
      else if (act === "quick") S.drafts[S.inq] = a.dataset.v;
      else if (act === "send") { const t = (document.getElementById("composer")?.value ?? "").trim(); if (t) { (S.sent[S.inq] ??= []).push(t); S.drafts[S.inq] = ""; } }
      else if (act === "reconfirm") S.reconfirmed = true;
      else if (act === "go") { const target = a.dataset.go; S.screen = target; screenId = target; S.dialog = null; }
      render(act === "send-interest" || act === "offer" ? "dialog" : true); return;
    }
    const row = e.target.closest("[data-sel]");
    if (row) { e.preventDefault(); S.sel = row.dataset.sel; const w = S.w === "fit" ? stage.clientWidth : S.w; if (S.screen === "find" && w < 1200) { returnFocus = `[data-sel="${S.sel}"]`; S.dialog = { kind: "detail", job: S.sel }; render("dialog"); return; } S.panel = true; render(true); vp.querySelector(`[data-sel="${S.sel}"]`)?.focus(); return; }
    const iq = e.target.closest("[data-inq]"); if (iq) { e.preventDefault(); S.inq = iq.dataset.inq; render(true); vp.querySelector(`[data-inq="${S.inq}"]`)?.focus(); return; }
    if (e.target.closest("a, button")) e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.dialog) { S.dialog = null; S.interestSent = false; render(true); }
  });
  new ResizeObserver(fit).observe(stage); new ResizeObserver(fit).observe(vp);
  if (document.fonts?.ready) document.fonts.ready.then(fit);
  render();
})();
