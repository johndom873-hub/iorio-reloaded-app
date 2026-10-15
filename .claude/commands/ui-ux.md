---
description: Review an iorio-reloaded-app screen/component for desktop and mobile UI/UX issues against this app's actual conventions. Usage: /ui-ux [ComponentName or file path]
---

You are performing a UI/UX review of the **iorio-reloaded-app** frontend (options trading platform; one user is a developer, the other is a non-developer business user).
Stack: React + `@tabler/core` (CSS and JS) + ApexCharts (via a shared wrapper) + `lightweight-charts` (price/IV history) + Plotly (volatility surface only).

Review the component or screen given in the argument (or the most recently discussed screen if no argument). Report every violation with file:line and the exact fix. At the end, mark each checklist item PASS or FAIL.

This file is scoped to this project and reflects its shared components and past incidents. Where it conflicts with generic Bootstrap/Tabler assumptions, this file wins. The general rules in `~/.claude/CLAUDE.md`'s UI/UX Standards section (rem font sizes, semantic colours, `table-light` thead, badges, `btn-sm`, background cascade) also apply and are not repeated here.

---

## Method — visual first

A finding counts only if it was **seen on screen** in the relevant state. Code reading and DOM measurements are hypotheses to confirm visually, and source code is read afterwards to explain the cause. A measurement-only audit once missed overlapping column headers ("DESCRIPTVALUE") and over-reported "table too wide" findings that actually scrolled cleanly.

1. Read the component(s) to learn what states exist (tabs, collapsibles, modals, empty/loading/error, live updates).
2. Open the screen with the Playwright MCP against the local dev server (log in with the local dev credentials from memory). If a state can't be reached with local data, sync or mutate data to produce it (then restore it); don't skip the state.
3. Screenshot at **1706px** (the user's main screen), **1440px** (the tight desktop case) and **390px** (phone), in **both themes** (localStorage key `iorio-theme`; confirm `data-bs-theme` on `<html>` changed). Wait ~350 ms after a theme toggle before measuring or capturing, or the transition gives false readings.
4. In each viewport: scroll every overflowing container to at least three positions, open every collapsible/tab/modal/dropdown/tooltip, and screenshot each.
5. Measure what a screenshot can't settle: text contrast via `getComputedStyle` (colours may come back as `color(srgb …)` fractions; parse those, don't eyeball), tap-target size and row heights via `getBoundingClientRect` at 390px.
6. Close the Playwright browser when done.

---

## Stack Context — read before reviewing

- **Bootstrap's JS is loaded.** `main.tsx` imports `@tabler/core/dist/js/tabler.esm.min.js`, which bundles Bootstrap's full JS (collapse, dropdown, modal, tooltip, Popper). `data-bs-*` attributes therefore do work; the mobile nav burger in `AppLayout.tsx` uses `data-bs-toggle="collapse"`. Two rules follow:
  - New interactive widgets use React state (open flag + click-outside), not the Bootstrap data-API: Bootstrap JS changes classes behind React's back, and a re-render resets them.
  - When a Bootstrap JS class *is* needed (`Tooltip`, `Collapse`), import it only from the deep path `@tabler/core/dist/js/tabler.esm.min.js`. The bare `@tabler/core` specifier resolves to a second copy, which registers duplicate global click listeners (that broke closing the mobile nav).
- **Page wrapper is centralized**: `AppLayout.tsx` wraps every routed page in `page-wrapper` > `page-body` > `container-fluid` around `<Outlet />`. Pages must not re-wrap themselves. A page-level error state is just `<div className="alert alert-danger">{error}</div>`.
- **Grid**: Tabler ships `.row > * { width: 100% }`, so `col-md-6` alone is already full width on a phone; `col-12` is not required.
- **Tables**: record lists use the shared `<DataTable>` (`src/components/DataTable/DataTable.tsx`). It supplies `table-responsive`, `table table-sm table-hover table-vcenter card-table`, `table-light` thead and the gear-icon column-visibility popover. Numeric columns get `align: "right"` on the column def, which also gets the monospaced numeric font via the `.table td.text-end` rule in `theme.css`. This app's mobile strategy is user-controlled column visibility via the gear icon, so don't flag hidden columns when the gear is present.
- **Charts**:
  - **ApexCharts**: always the `<ApexChart>` wrapper (`src/components/charts/ApexChart.tsx`), never raw `ReactApexChart`. The wrapper themes axes, grid, legend and tooltip; **annotation label colours are not covered** and must be set per chart from the theme.
  - **lightweight-charts** (`TickerPriceChart.tsx`, `IvHistoryChart.tsx`): no built-in responsiveness or theming. A new instance needs a `ResizeObserver` that re-applies width/height, and must re-apply the `textColorByTheme`/`gridColorByTheme` colours on theme toggle.
  - **Plotly** (`VolatilitySurfaceModal.tsx` only): same two needs, a `ResizeObserver` and theme-aware layout colours.
- **Formatting**: never hand-write currency/percentage/date/number formatting, contract labels or P&L colour logic. `src/lib/formatters.ts` has `formatCurrency`, `formatPercentage`, `formatSignedPnl`, `formatDate`/`formatDateTime`/`formatRelativeDate`, `formatDaysToExpiry`, `formatOptionContractLabel`, `pnlBadgeClass`/`pnlTextClass` and more. A genuinely new need goes into that file, not inline.
- **Stylesheet**: app-wide CSS lives in `src/theme.css` (there is no `index.css`). Tabler's `.bg-*`, `.bg-*-lt` and `.text-*` utilities are `!important`, so a plain override of them silently does nothing.

---

## Rules

### CRITICAL — Visual Defects

Anything seen broken in a screenshot: overlapping or garbled text, content overflowing the viewport, controls rendered off-screen or clipped, a theme in which content is unreadable. Report it even if no rule below names it.

### CRITICAL — Record Lists Without the Gear Icon

A table listing records (positions, orders, jobs, events, candidates — rows of the same kind, any count) must use `<DataTable>`, or, if it needs a custom layout, still carry `ColumnVisibilityPopover` with persisted per-table visibility (as `CycleCard`, the Pluto tables and `BacktestComparePage` do). Fixed-shape tables are exempt: key-value tables, month×year grids, small fixed strategy summaries, the option chain.

### CRITICAL — Raw or Unthemed Charts

- No direct `ReactApexChart` import; always `<ApexChart>`. Annotation labels get explicit theme colours.
- Every `lightweight-charts` or Plotly instance has a `ResizeObserver` resize and re-applies theme colours on toggle (reference: `TickerPriceChart.tsx`).

### HIGH — Contrast in Both Themes

Text must reach 4.5:1 and non-text UI (borders, icons, chart series, badge fills) 3:1, measured in **light and dark**. Known failures and their replacements:

| Fails | Where | Use instead |
|---|---|---|
| `text-muted` | dark card (2.53:1) | `text-secondary` |
| `text-warning` | white (2.13:1) | `.iorio-note-amber` |
| `btn-link` | dark card (2.95:1) | `btn btn-outline-secondary` for new controls |
| Tabler outline-button default text | dark surface (≈2–2.6:1) | the standard outline block in `theme.css` (see Buttons) |

- Don't put a Bootstrap `.text-*`/`.bg-*` utility on an element whose colour app CSS must override; give it a dedicated class in `theme.css` that defines both themes. Any override of a Tabler `bg-*`/`bg-*-lt` class needs `!important`, verified with `getComputedStyle`.
- `.form-control + .form-hint` (specificity 0,2,0) beats a single-class colour; for a coloured hint under an input, drop `form-hint`.
- Text inside a themed container (`alert-*`, `bg-*-lt`) inherits its colour; never hard-code `text-dark`/`text-white` there.

### HIGH — Interactive Widgets and Overflow Containers

- Dropdowns, popovers and menus use React state, not the Bootstrap data-API (see Stack Context).
- Any menu, popover or tooltip whose trigger sits inside `.table-responsive` (or any `overflow: auto/hidden` ancestor) must be portalled to `document.body` with `position: fixed` from `getBoundingClientRect()`, and close on scroll/resize. Reuse `MultiSelectDropdown` or copy `ColumnVisibilityPopover`'s mechanics; reuse `DottedLabelTooltip`/`HelpTooltip`/`useTooltip` for tooltips.
- Hover- or focus-opened UI must gate those handlers on `matchMedia("(hover: hover)")` and toggle on click only on hover-less devices; a tap fires hover, focus and click together, so it otherwise opens and closes at once. Verify in a touch context (`hasTouch`, `isMobile`, `page.tap`).

### HIGH — Duplicated Page Wrapper

Never wrap a routed page in `page-body`/`container-fluid`; `AppLayout` already does. A page error is the bare `alert alert-danger`.

### HIGH — Hand-Written Formatting, Labels or P&L Colours

Use `src/lib/formatters.ts`. Option contracts read like "SMCI $47 Call · 9 Oct (2DTE)" via `formatOptionContractLabel`, with DTE shown wherever an expiry is. Established terms stay as they are: "Covered Calls", "Max drawdown", "EXP" means exposure. Never use "buy-write".

### HIGH — Buttons

- Every `.btn` has a real variant; a bare `.btn` with an icon inherits the ancestor's colour on hover and the icon can vanish.
- Never give a button a custom `bg-X`/`backgroundColor` with default text, or override its hover background, without checking rest and hover contrast in both themes; use the semantic `btn-*` classes.
- Outline buttons follow the "Standard outline buttons" block in `theme.css`: transparent at rest, label white in dark and black in light, solid fill on hover. Use `btn btn-outline-<variant>` with nothing inline. A new variant is added to that block and checked at rest and hover in both themes.
- Don't put a solid `btn-primary` next to outline buttons in the same footer.
- `btn-sm` only in compact table rows or tight inline groups.

### HIGH — Icon + Text Alignment

Use `d-inline-flex align-items-center gap-1`, never baseline alignment or `position: relative; top: Xpx` nudges.

### HIGH — Modals

Every modal is hand-built (no Bootstrap `Modal` instance), so each one needs:

- `modal-dialog-centered` on `.modal-dialog` (full-height `modal-dialog-inset` modals excepted), plus `modal-dialog-scrollable` if content can exceed the viewport.
- Body scroll lock: `document.body.style.overflow = "hidden"` on mount, restored on unmount.
- Backdrop `zIndex: 1050` (`1100` for a modal or toast stacked above an open modal), `backgroundColor: "rgba(0,0,0,0.5)"` and **`opacity: 1`**. Tabler's `--tblr-backdrop-opacity` (0.24) otherwise multiplies the alpha down to 0.12.
- Informational modals close on **ESC and backdrop click**.
- Confirmation dialogs (`ConfirmModal`) close on **neither**: Cancel/X is the only way out, so a dismissal is never mistaken for a confirm.
- Order/form modals with their own cancel path (e.g. `ClosePositionModal`) close on ESC through that cancel handler, never on backdrop click.

### HIGH — Ticker Symbols Open the Ticker Modal

Every ticker symbol shown anywhere (cell, badge, list, alert, chart label) is clickable and opens the shared `SignalsTickerModal` via `useSignalsTickerModal().open(symbol)`. Flag any ticker rendered as plain text.

### HIGH — Touch Targets (phone)

At phone width, every standalone clickable control has at least a 44×44px tap area, measured with `getBoundingClientRect`. Grow the hit area with padding plus matching negative margins so the glyph doesn't move (examples in `theme.css`); `btn p-2` alone is not enough (about 34px for a 16px icon). Ticker-symbol links inside table and list rows (`btn-link p-0`) are inline text and exempt.

### HIGH — Unbounded Table Cells

A cell showing free text from live data (error messages, notes, joined lists, JSON) needs a cap: `text-truncate` plus a `title` for diagnostic text, a 2–3 line `-webkit-line-clamp` plus a `title` for primary text, or `<details>` for raw dumps. Check row heights at 390px; one huge row reads as "blank rows".

### MEDIUM — Loading States

Every non-immediate operation, including a table's initial or refreshing fetch, shows the shared `<Spinner>` (`src/components/Spinner.tsx`): `size="sm"` inline in buttons/cells, default size for page-level waits, with a `label` when nothing nearby says what is loading. Never a hand-rolled `spinner-border` or a bare "Loading…" string.

### MEDIUM — Live-Updating Values

- Live price cells use `TickColoredPrice`/`useTickDirectionColor` (colour by the previous tick, not a fixed reference) and `FlashingNumber`/`useFlashOnChange`.
- The flash wraps the number in a span, never the `<td>`, and nothing recolours or flashes when the value is unchanged at the displayed precision.
- A ticking clock (`useTickingNow`) lives in the smallest component that shows it, never at page level, where it re-renders every table each second.

### MEDIUM — Table Details

- Totals rows use `.table-totals-row`, not `table-light` on `<tfoot>` (renders as a white bar).
- A `card-table` nested inside a `.card-body` double-pads; use `table-flush` there.
- `text-nowrap` only on numeric/price columns; on text columns it forces horizontal scroll.

### MEDIUM — Badge Colours

Badges in adjacent columns must not reuse a colour with a different meaning (e.g. strategy badges: CC azure/blue, CSP purple). New badge sets default to solid `bg-X text-X-fg` and are contrast-checked in both themes. Price-change badges use `pnlBadgeClass()` → `badge-change-pos/neg/flat`.

### MEDIUM — Tabs and Toasts

- Tabs use `nav nav-tabs`, never `nav-pills`.
- New toasts reuse the plain `toast`/`toast-header`/`toast-body` structure of `BackgroundJobsToastStack.tsx`. Global toasts belong in `BackgroundJobsContext`; a toast local to one modal may live in that component.

### LOW — Fixed Pixel Widths on Layout Containers

No fixed pixel width on a container holding charts, cards or tables; use grid columns, `width: 100%` or `maxWidth` + `width: 100%`. Filter inputs that need to fit their content use a CSS grid `auto-fit`, not hard-coded widths.

### LOW — Row Gutters

Use `g-3` between cards; don't mix `g-2` and `g-3` in one row group.

---

## Review Checklist

- [ ] Screenshots taken at 1706, 1440 and 390px in both themes, with every overflow container scrolled and every collapsible/tab/modal/dropdown opened; no visual defects seen
- [ ] Every record-list table has the gear icon (via `DataTable` or `ColumnVisibilityPopover`)
- [ ] Charts: `<ApexChart>` only (annotation colours themed); lightweight-charts/Plotly have `ResizeObserver` + theme re-application
- [ ] All text ≥ 4.5:1 and non-text ≥ 3:1 in both themes (measured); no `text-muted`/`text-warning`/`btn-link` in new code where the table above says otherwise
- [ ] Interactive widgets use React state; menus inside overflow containers are portalled; hover UI gated on `(hover: hover)`; Bootstrap JS imported only from the deep path
- [ ] No page re-wraps itself in `page-body`/`container-fluid`
- [ ] Formatting, contract labels and P&L colours via `formatters.ts`; established terminology kept
- [ ] Buttons: real variants, outline standard from `theme.css`, `btn-sm` only in compact contexts
- [ ] Icon + text uses `d-inline-flex align-items-center gap-1`
- [ ] Modals: centered (unless inset), scrollable where needed, scroll lock, backdrop 1050/0.5/`opacity: 1`, dismiss behaviour matches the modal type (informational: ESC + backdrop; ConfirmModal: neither; order/form: ESC via cancel only)
- [ ] Every ticker symbol opens `SignalsTickerModal`
- [ ] Standalone controls ≥ 44px tap area at 390px (measured)
- [ ] Free-text cells capped; row heights sane at 390px
- [ ] Loading states use `<Spinner>`, including table fetches
- [ ] Live cells use tick-direction colour and number-scoped flash; no page-level ticking clock
- [ ] Totals rows use `.table-totals-row`; no double-padded nested `card-table`; `text-nowrap` only on numeric columns
- [ ] Adjacent badge colours don't clash in meaning; badge contrast checked in both themes
- [ ] Tabs use `nav-tabs`; toasts reuse the existing structure
- [ ] No fixed pixel widths on layout containers; gutters consistently `g-3`

---

## Output Format

List each violation as:
> **[CRITICAL|HIGH|MEDIUM|LOW]** description — `file:line` — fix (and the screenshot/viewport/theme where it was seen)

Then state each checklist item as **PASS** or **FAIL**.
If no violations found, state "All checks passed" followed by the full checklist.
