---
description: Review an iorio-reloaded-app screen/component for desktop and mobile UI/UX issues against this app's actual conventions. Usage: /ui-ux [ComponentName or file path]
---

You are performing a UI/UX review of the **iorio-reloaded-app** frontend (options trading platform, business user, not a developer).
Stack: React + Bootstrap 5 (CSS only, no JS bundle) + `@tabler/core` + ApexCharts (via a shared wrapper) + `lightweight-charts` for the price chart.

Read the component or screen given in the argument (or the most recently discussed screen if no argument). Check every rule below and report all violations with file:line and the exact fix required. At the end, confirm each checklist item as PASS or FAIL.

This file is scoped to this project (`.claude/commands/`) and reflects this app's actual shared components and past incidents — do not fall back to generic Bootstrap/Tabler assumptions that conflict with what's below.

---

## Stack Context — read before reviewing

- **No Bootstrap JS is loaded** — only `@tabler/core`'s CSS (confirmed: `bootstrap` isn't even a dependency). Any `data-bs-toggle`/`data-bs-dismiss`/`data-bs-*` attribute-driven interactivity (dropdown, collapse, offcanvas, tooltip) **silently does nothing** — no error, the element just never opens. This exact bug shipped to prod once already: `ColumnVisibilityPopover.tsx`'s gear-icon dropdown used `data-bs-toggle="dropdown"` and was completely dead on every table platform-wide until rebuilt as manual open-state + click-outside-to-close. Treat any new `data-bs-*` usage as an automatic CRITICAL finding.
- **Page wrapper is centralized**: `AppLayout.tsx` already wraps every routed page in `<div className="page-wrapper"><div className="page-body"><div className="container-fluid"><Outlet /></div></div></div>`. Individual page components must **not** re-wrap themselves in `page-body`/`container-fluid` — that double-nests the wrapper. A page-level error state is just `<div className="alert alert-danger">{error}</div>` inline, nothing more (see `DashboardPage.tsx`, `PositionsPage.tsx` for the pattern).
- **Tables**: never hand-roll a `<table>`. Use the shared `<DataTable>` (`src/components/DataTable/DataTable.tsx`) — it already supplies `table-responsive`, `table table-sm table-hover table-vcenter card-table`, `table-light` on `<thead>`, and the required gear-icon column-visibility popover (per-table `tableId`, auto-saves to localStorage, all columns visible by default — this is a standing platform-wide requirement, not optional). Numeric columns: pass `align: "right"` on the column def, not a hand-added class — this alone gets `font-mono`/tabular-nums for free via a global CSS rule keyed on `.table td.text-end` (`theme.css`). **This app's mobile strategy for tables is user-controlled column visibility via the gear icon, not "never hide columns"** — don't flag hidden columns as a violation if the gear icon is present and working.
- **Charts**: two libraries, two different responsibilities.
  - **ApexCharts** (P&L/allocation/time-series charts): always go through the shared `<ApexChart>` wrapper (`src/components/charts/ApexChart.tsx`), never raw `<ReactApexChart>`. The wrapper handles dark/light theming (`foreColor`, grid/axis/legend/tooltip colors) that ApexCharts doesn't do on its own — a raw instance will render illegible grey-on-dark-navy in dark mode. Toolbar is off by default (`options.chart` overrides still need `toolbar: { show: false }` preserved if replaced wholesale).
  - **lightweight-charts** (the price/IV history candlestick charts — `TickerPriceChart.tsx`, `IvHistoryChart.tsx`): has **no built-in responsiveness or theme awareness**. Any new instance must wire its own `ResizeObserver` on the container to re-`applyOptions({ width, height })` on resize, and must re-apply `textColorByTheme`/`gridColorByTheme` (the two-key `{ light, dark }` maps already defined in these files) whenever the app theme toggles. Skipping either is a CRITICAL finding — the chart will either not resize on mobile rotation/breakpoint changes, or stay hardcoded to one theme's colors.
- **Formatting**: never hand-write currency/percentage/date/number formatting or badge-color logic. `src/lib/formatters.ts` has `formatCurrency`, `formatCurrencyTrimmed`, `formatPercentage`, `formatSignedPnl`, `formatDate`/`formatDateTime`/`formatRelativeDate`, `formatDaysToExpiry`, `pnlBadgeClass`/`pnlTextClass`, and more — check it before writing anything that formats a number, date, or P&L color. Per the global CLAUDE.md rule, a genuinely new formatting need goes into this shared file, not inline at the call site.
- **Colours/fonts/modals/badges**: governed by `~/.claude/CLAUDE.md`'s UI/UX Standards section (rem font sizes, semantic Bootstrap color classes, `badge-change-pos/neg/flat` for price badges via `pnlBadgeClass()`, modal backdrop z-index/opacity rules) — those rules apply here and are not repeated in full, but see the app-specific additions below.

---

## Rules

### CRITICAL — `data-bs-*` Attribute-Driven Interactivity

Never use `data-bs-toggle`, `data-bs-dismiss`, `data-bs-target`, or any other Bootstrap-JS-driven `data-bs-*` attribute to make something interactive (dropdown, collapse, offcanvas, tab, tooltip, popover). This app never loads Bootstrap's JS bundle — only `@tabler/core`'s CSS — so these attributes render the correct static markup/classes but nothing ever responds to a click. This exact bug shipped once (`ColumnVisibilityPopover.tsx`'s gear dropdown, found 2026-08-28).

**Wrong:**
```jsx
<button data-bs-toggle="dropdown">Options</button>
<div className="dropdown-menu">...</div>
```

**Correct** — manual open-state + click-outside-to-close, matching `ColumnVisibilityPopover.tsx`:
```jsx
const [open, setOpen] = useState(false);
// ...click-outside effect via a ref + document click listener...
<button onClick={() => setOpen((o) => !o)}>Options</button>
{open && <div className="dropdown-menu show">...</div>}
```

### CRITICAL — Hand-Rolled Tables

Never build a data table with a raw `<table>`. Use `<DataTable>` (`src/components/DataTable/DataTable.tsx`) — it's the only place `table-responsive`, `table-sm table-hover table-vcenter card-table`, `table-light` thead, and the mandatory gear-icon column-visibility popover are implemented correctly. A hand-rolled table silently violates the platform-wide "every data table gets a gear icon" requirement from CLAUDE.md.

### CRITICAL — Raw ApexCharts / Unthemed lightweight-charts

- Never import `react-apexcharts`'s `ReactApexChart` directly — always `<ApexChart>` (`src/components/charts/ApexChart.tsx`). A raw instance loses dark-mode axis/legend/grid theming.
- Any new `lightweight-charts` instance must include a `ResizeObserver`-driven width/height update and theme-aware `textColorByTheme`/`gridColorByTheme` re-application (see `TickerPriceChart.tsx` for the reference implementation) — it has no automatic responsiveness or theming of its own.

### CRITICAL — Grid Mobile Fallback

Every `col-md-X` or `col-lg-X` must be paired with `col-12`. No responsive column without a mobile-first fallback.

**Wrong:** `<div className="col-md-9">`
**Correct:** `<div className="col-12 col-md-9">`

### HIGH — Duplicated Page Wrapper

Never wrap a routed page's content in `page-body`/`container-fluid` — `AppLayout.tsx` already does this once around every route's `<Outlet />`. Doing it again double-pads the page. A page-level error state is just `<div className="alert alert-danger">{error}</div>`, not the full wrapper the global CLAUDE.md's generic example shows (that example is written for apps without a centralized layout).

### HIGH — Hand-Written Formatting / Badge Colors

Never inline currency/date/percentage formatting or pick a P&L badge/text color by hand (`pnl > 0 ? 'text-success' : ...`). Use the matching helper in `src/lib/formatters.ts` (`formatCurrency`, `formatSignedPnl`, `pnlBadgeClass`, `pnlTextClass`, etc.) — consistency and the platform-wide tabular-nums numeric font both depend on going through these, not reinventing them at the call site.

### HIGH — Button Colours and Hover Contrast

Never combine a custom `bg-X` or `backgroundColor` style with default button text. Use the full Tabler/Bootstrap semantic button class (`btn-primary`, `btn-success`, `btn-danger`, `btn-outline-secondary`, etc.).

- Never override Bootstrap's hover background with a custom colour without verifying contrast at both rest and hover states.
- Never leave a plain, undecorated `.btn` (no `btn-*` variant) with an icon inside it — Tabler's base `.btn` has no defined hover text color and inherits the *ancestor's* text color on hover, which can make the icon vanish against certain backgrounds. Always pair `.btn` with a real variant class.
- `btn-sm` is only for compact table rows or tight inline groups (toast bodies, badge-adjacent actions) — never in page-level headers/footers/card actions.

### HIGH — Icon + Text Vertical Alignment

Never rely on natural baseline alignment when mixing an icon and text. Always use flex alignment:

```jsx
<button className="btn btn-primary d-inline-flex align-items-center gap-1">
  <IconComponent size={16} />
  Label
</button>
```

Never use `position: relative; top: Xpx` to nudge icons.

### HIGH — Modal Conventions

This app builds every modal manually (no Bootstrap JS `Modal` instance), so several things have to be done by hand that a real Bootstrap modal would give for free:

- **Body scroll lock**: every modal must lock `document.body.style.overflow = "hidden"` on mount and restore it on unmount — CSS alone does not do this. See `TickerDetailModal.tsx`'s scroll-lock effect for the reference pattern.
- **Backdrop dismiss behavior**: informational modals (data views, ticker detail, article/document viewers) must close on backdrop click — `onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}` on the backdrop element — and on ESC. Confirmation/destructive-action modals (OK/Cancel, order submission, position close) must **not** close on backdrop click.
- **Backdrop z-index/opacity**: `zIndex: 1050`, `backgroundColor: "rgba(0,0,0,0.5)"`, and **explicit `opacity: 1`** on the backdrop element. Tabler's `--bs-backdrop-opacity` custom property defaults to `0.24` and multiplies against the inline `rgba` alpha if not pinned, silently washing the backdrop out. A second modal stacking on top of a first uses `zIndex: 1100`; anything else needing to render above an open modal (e.g. a toast) also uses `1100`.
- **Scrollable content**: pair with `modal-dialog-scrollable` if content can exceed viewport height.

### HIGH — Ticker Symbols Must Link to the Detail Modal

Every ticker symbol shown anywhere in the app (table cell, badge, chart label, alert row) must be a clickable element that opens `TickerDetailModal` for that symbol — this is a standing platform-wide convention, not a per-screen choice. Flag any new ticker display that renders as plain text.

### HIGH — Toast/Background-Job Notification Pattern

Any new toast notification (scan progress, order status, background regen, etc.) should reuse the plain Bootstrap `toast`/`toast-header`/`toast-body` structure already used by `BackgroundJobsToastStack.tsx` (`position-fixed`, `toast-container`, no custom colors) rather than inventing new toast markup/styling. Persistent/global toasts belong in `BackgroundJobsContext`; a toast scoped to one modal's local state (dismissed/auto-clearing) can live in that component directly, same z-index conventions as modals above.

### HIGH — Touch Targets

Every clickable element must have a minimum 44×44px tap area on mobile.

- Icon-only buttons: `className="btn p-2"`
- Table row action icons: at least `px-2 py-1`

### MEDIUM — Loading States

Every non-immediate async operation (fetch, scan, order submission) must show the shared `<Spinner>` (`src/components/Spinner.tsx`) — `size="sm"` inline in a button/cell, default `size="md"` for a standalone/page-level wait state, with a `label` when there's no adjacent text already describing what's loading. Never a hand-rolled `spinner-border` div.

### MEDIUM — Tabs

Use `nav-tabs`, never `nav-pills`, for any tabbed UI in this app — `nav-pills` renders as a row of pill-shaped buttons here, not recognizable tabs, and doesn't match the rest of the app.

### MEDIUM — Dark Mode Contrast

Any new color (badge, border, chart series, custom background) must be checked in **both** light and dark theme, not just the theme the reviewer happens to be in. This app has shipped more than one dark-mode-only contrast bug (border color nearly invisible against the dark body background, Tabler `.bg-*-lt` badges needing an explicit `!important` override to actually change color) — a visual check in one theme only is not sufficient sign-off.

### MEDIUM — text-nowrap Overuse

Only apply `text-nowrap` to numeric or price columns where line-breaking would misread the value. Applying it to text columns forces horizontal scroll even inside `table-responsive`.

### LOW — Fixed Pixel Widths on Layout Containers

Never set a fixed pixel width on a container holding charts, cards, or tables. Use Bootstrap grid cols, `width: '100%'`, or `maxWidth` + `width: '100%'`.

### LOW — Row Gutter Consistency

Use `g-3` for row gutters between cards. Don't mix `g-2` and `g-3` within the same row group.

---

## Review Checklist

- [ ] No `data-bs-*` attribute-driven interactivity anywhere (dead in this app — no Bootstrap JS)
- [ ] Every data table uses the shared `<DataTable>` component, not a hand-rolled `<table>`
- [ ] Every ApexCharts usage goes through `<ApexChart>`; every `lightweight-charts` instance has a `ResizeObserver` + theme-color re-application
- [ ] Every `col-md/lg-X` has a `col-12` mobile fallback
- [ ] No page re-wraps itself in `page-body`/`container-fluid` (already provided once by `AppLayout`)
- [ ] All formatting/badge-color logic goes through `src/lib/formatters.ts`, not hand-inlined
- [ ] All buttons use semantic Tabler/Bootstrap classes; no bare `.btn` with an icon and no variant; `btn-sm` only in compact/inline contexts
- [ ] All icon + text elements use `d-inline-flex align-items-center gap-1`
- [ ] Modals: body scroll lock present, correct backdrop-dismiss behavior for the modal's type, backdrop `opacity: 1` + correct z-index, `modal-dialog-scrollable` where needed
- [ ] Every ticker symbol displayed is a clickable link into `TickerDetailModal`
- [ ] New toasts reuse the existing `toast`/`toast-header`/`toast-body` pattern
- [ ] All clickable elements meet a 44px touch target
- [ ] Loading states use the shared `<Spinner>`, not a hand-rolled spinner
- [ ] Tabs use `nav-tabs`, not `nav-pills`
- [ ] Any new color checked in both light and dark theme
- [ ] `text-nowrap` used only on numeric/price columns
- [ ] No fixed pixel widths on layout containers
- [ ] Row gutters consistently `g-3` within a row group

---

## Output Format

List each violation as:
> **[CRITICAL|HIGH|MEDIUM|LOW]** description — `file:line` — fix

Then state each checklist item as **PASS** or **FAIL**.
If no violations found, state "All checks passed" followed by the full checklist.
