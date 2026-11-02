# Production adoption review: design system

> **Reference handed to implementation:** `docs/product/v2-ux-spec` at **`9728c25`** (`06_DESIGN_SYSTEM.md` and `design-system/`).
> **Reviewer:** Claude Agent 3 (UX), #116. **Implementers:** the Codex owner (#144–#147) and Claude QA (#148).
> **Evidence rule:** reference-prototype checks (the 50-render matrix, the contrast table, harness keyboard and focus runs) are *prototype evidence only*. Each production PR must bring its own evidence from the real app, built from the PR's commit. The reviewer re-runs the targeted checks before approving.

## How review works

1. The implementer opens a PR from an isolated branch and lists, for each gate below that the PR touches, the command, the test name and the output.
2. The reviewer checks out the PR head in a separate worktree and re-runs the listed checks against `pnpm dev` with `LOGLOADS_MARKETPLACE_V2=enabled` on `127.0.0.1:3002` (or a production build in an isolated output directory).
3. The verdict is posted on the PR and its issue as **Approved**, **Changes requested** (with file:line), or **Not applicable**. Design approval does not replace code review or merge authorization.

## Gate 1: Semantic rows (#147, verified by #148)

| Check | Pass condition | Evidence |
|---|---|---|
| List structure | Jobs and inquiries render as `ul > li`. **Zero** `[role="listbox"]` or `[role="option"]` on any V2 page. | Playwright DOM query on `/v2/work`, `/v2/inquiries` and `/v2/landing/inquiries` |
| No nested interactives | No `a` or `button` inside another `a` or `button`. axe `nested-interactive` and `aria-required-children` pass. | `@axe-core/playwright` report (#148), with serious and critical violations at 0 |
| One link per row | The title links to `/v2/work/[id]` and works with JavaScript disabled. The selected row's link has `aria-current="true"`. | Playwright run with JavaScript disabled, plus an attribute assertion |
| Independent actions | Save and other buttons are siblings of the link, and their accessible names include the job title ("Save Oak saw logs to Springfield"). | Accessibility snapshot |
| Keyboard | The tab sequence is row link → Save → next row link. Enter on a link opens the detail panel at 1200 px and up, or navigates below 1200. The focus ring is visible on the row. | Playwright keyboard test, plus screenshots at 1440 and 390 |

## Gate 2: Scoped themes (#144, #145)

| Check | Pass condition | Evidence |
|---|---|---|
| No global tokens | `packages/ui/src/tokens/tokens.css` defines `--ll-*` only under `:where(.ll-theme)`. No `:root` rule sets `--ll-*`. | `grep` output in the PR |
| Legacy untouched | On `/`, `/pricing` and `/fleet/trucks`, `getComputedStyle(document.body).getPropertyValue("--ll-color-action")` is empty, and screenshots match the pre-PR baseline. | Playwright `toHaveScreenshot` on those 3 routes, before and after |
| V2 themed | The AppShell root has `ll-theme ll-app`, and `--ll-color-action` resolves inside `/v2/**`. | Playwright assertion |
| Scoped component styles | Component styles are CSS Modules. No new global `.ll-*` classes leak into `globals.css`. `v2.css` is removed only when its last consumer is migrated. | Diff review |

## Gate 3: Dialog focus return (#146)

| Check | Pass condition | Evidence |
|---|---|---|
| Native dialog | Uses `<dialog>` with `showModal()`. Background content is inert while it is open. | Code review |
| Focus in | On open, focus goes to the first field (or the primary action when there are no fields). | Playwright |
| Focus out | Escape, Close and Cancel all return focus to the opener (for example "I'm interested", or the row link that opened the mobile sheet). | Playwright test for each opener |
| Theme | The dialog root carries `ll-theme`, and its tokens resolve even when portalled to `body`. | Playwright computed-style assertion inside the open dialog |
| Mobile | Below 768 px it renders as a bottom sheet without horizontal overflow at 390. | Screenshot at 390 |

## Gate 4: Self-hosted fonts (#144)

| Check | Pass condition | Evidence |
|---|---|---|
| Loader | IBM Plex Sans, Plex Sans Condensed and Plex Mono load via `next/font` in `apps/web/app/v2/layout.tsx` with `display: "swap"`, exposed as `--ll-font-sans-face`, `--ll-font-display-face` and `--ll-font-mono-face`. | Diff review |
| No third-party requests | A production build of `/v2/work` makes **zero** requests to `fonts.googleapis.com` or `fonts.gstatic.com`. Font files come from `/_next/static/media/`. | Playwright network log |
| Weak connection | With font requests blocked (`route.abort`), text renders in the fallback stack, controls stay usable, and there is no horizontal overflow at 390 or 1440. | Playwright test with blocked fonts, plus screenshots |
| Budget | The PR records the number of font files and total transfer size for `/v2/work`. Proposed ceiling: 6 files and 200 KB, subject to the performance budget in #137. | Network log summary |

## Gate 5: Truthful verification labels (#147, depends on #150)

| Check | Pass condition | Evidence |
|---|---|---|
| Data-driven only | A verification mark renders only from a real verification record that carries its **scope**, and its review date when known. It is never hardcoded or inferred from account age or activity. | Code review of the view-model mapping |
| Scope named | The visible label is the scope text, for example "Business identity verified · Oct 2026". No generic "Verified" or "Business verified" without a defined scope. | DOM assertion on a verified fixture |
| Current data | Today the contract only exposes `posterVerified: boolean` (`packages/contracts/src/marketplace-v2.ts:221`), derived from `verificationStatus === "verified"` (`apps/web/lib/marketplace-v2/pilot-adapter.ts:42`). Until #150 adds the scope, production shows **no** mark, or a label whose wording the verification owner confirms matches what that status actually checked. | Reviewer confirmation on #150 |
| No prototype leakage | None of the reference's fictional businesses or verification strings ("Ridgeline Hauling", "Cedar Fork Logging", "Business identity verified · Oct 2026") appear in app source or fixtures outside tests. | `grep` in the PR |

## Closed founder decisions (must remain true in every PR)

V2-DEC-01: public locations are "near {town}, approximate area" on the 0.10° grid, with no distance-precision promise. V2-DEC-02: pay shows a rate with its basis, or Negotiable with the poster's note. V2-DEC-03: "Confirmed …" reflects only the publish attestation or a reconfirmation.
