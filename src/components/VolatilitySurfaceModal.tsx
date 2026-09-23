import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { Spinner } from "./Spinner";
import { TooltipSpan } from "./TooltipSpan";
import { useTheme } from "../contexts/ThemeContext";
import { ApiError } from "../api/client";
import { fetchTickerSignals, type SignalSurfaceSlice, type SviSliceStatus, type TickerSignalsDetail } from "../api/signals";
import { formatCurrency, formatDate, formatPercentage } from "../lib/formatters";

// Volatility-surface modal: reconstructs the fitted implied-volatility surface from the stored per-expiry
// raw-SVI parameters (option_surface_fits) on demand -- the API never stores a grid, only the five SVI
// parameters per expiry (see impliedVolatilitySurface.ts sviTotalVariance). Opened from both the Shortlist
// and Signals screens' surface-fit-count cell. Prototyped as a claude.ai Artifact and approved by Marcelo
// before this build (2026-09-23).

interface VolatilitySurfaceModalProps {
  symbol: string;
  onClose: () => void;
}

const desktopChartHeight = 500;
const mobileChartHeight = 320;
const mobileBreakpointPx = 768;

// Keyed off the viewport, not the chart's own column width -- the chart sits in a narrower column
// (side-by-side with the table) even on desktop, so measuring its own width would misclassify a normal
// desktop view as "mobile" and collapse it to the short mobile height.
function currentChartHeight(): number {
  return window.innerWidth < mobileBreakpointPx ? mobileChartHeight : desktopChartHeight;
}

const narrowChartWidthPx = 420;
const axisFontSizes = {
  wide: { title: 13, tick: 11, colorbarTick: 11 },
  narrow: { title: 11, tick: 9, colorbarTick: 9 },
};

// Sequential ramp anchored on the app's primary blue (--tblr-primary #0369a1), light -> dark, for IV magnitude.
const sequentialRamp: Array<[number, string]> = [
  [0, "#dbeafe"],
  [0.25, "#93c5fd"],
  [0.5, "#3b82f6"],
  [0.75, "#0369a1"],
  [1, "#0c4a6e"],
];

const defaultCameraEye = { x: 1.28, y: -1.7, z: 0.72 }; // same direction as before, ~15% closer to `center`
// Ctrl+drag pans by changing this (Plotly's default is {x:0,y:0,z:0}) -- separate from `eye`, which only
// handles rotation/zoom. Read both live via `document.querySelector('.js-plotly-plot').layout.scene.camera`
// in the browser console after adjusting the view, to get exact values to paste in here.
const defaultCameraCenter = { x: 0, y: 0, z: -0.25 };

const sceneColorsByTheme = {
  light: { ink: "#52514e", grid: "#b9b7ad", bg: "#fcfcfb", knot: "#0b0b0b" },
  dark: { ink: "#c3c2b7", grid: "#54534d", bg: "#1a1a19", knot: "#ffffff" },
} as const;

const statusBadgeClass: Record<SviSliceStatus, string> = {
  ok: "badge bg-success-lt",
  poor_fit: "badge bg-warning-lt",
  insufficient_points: "badge bg-warning-lt",
  fit_failed: "badge bg-danger-lt",
  butterfly_arbitrage: "badge bg-danger-lt",
};

const statusLabel: Record<SviSliceStatus, string> = {
  ok: "ok",
  poor_fit: "poor fit",
  insufficient_points: "insufficient points",
  fit_failed: "fit failed",
  butterfly_arbitrage: "butterfly arbitrage",
};

function sviTotalVariance(p: { a: number; b: number; rho: number; m: number; sigma: number }, k: number): number {
  const shifted = k - p.m;
  return p.a + p.b * (p.rho * shifted + Math.sqrt(shifted * shifted + p.sigma * p.sigma));
}

// @types/plotly.js's PlotData type predates/omits several gl3d-only attributes this chart needs
// (colorscale/lighting/colorbar on a surface trace, a scatter3d trace shape at all) -- a local loose
// shape sidesteps that gap rather than fighting incomplete community types; cast to Plotly.Data at the
// Plotly.react call site, which is the only place the real (permissive) runtime API is invoked.
type PlotlyTrace = Record<string, unknown>;

interface SurfaceTraces {
  surface: PlotlyTrace;
  knots: PlotlyTrace;
}

function buildSurfaceTraces(slices: SignalSurfaceSlice[], theme: "light" | "dark", showKnots: boolean, isNarrow: boolean): SurfaceTraces | null {
  const fitted = slices.filter((slice): slice is SignalSurfaceSlice & { kMin: number; kMax: number; parameters: NonNullable<SignalSurfaceSlice["parameters"]> } => slice.status === "ok" && slice.parameters !== null && slice.kMin !== null && slice.kMax !== null);
  if (fitted.length === 0) return null;

  const kMinAll = Math.min(...fitted.map((slice) => slice.kMin));
  const kMaxAll = Math.max(...fitted.map((slice) => slice.kMax));
  const steps = 90;
  const kGrid = Array.from({ length: steps + 1 }, (_, i) => kMinAll + ((kMaxAll - kMinAll) * i) / steps);
  const yVals = fitted.map((slice) => slice.yearsToExpiry);

  const zMatrix: (number | null)[][] = [];
  const knotX: number[] = [];
  const knotY: number[] = [];
  const knotZ: number[] = [];
  const knotText: string[] = [];

  for (const slice of fitted) {
    const zRow: (number | null)[] = [];
    for (const k of kGrid) {
      const inRange = k >= slice.kMin && k <= slice.kMax;
      let cell: number | null = null;
      if (inRange) {
        const w = Math.max(sviTotalVariance(slice.parameters, k), 0);
        cell = 100 * Math.sqrt(w / slice.yearsToExpiry);
      }
      zRow.push(cell);
    }
    zMatrix.push(zRow);

    for (const k of [slice.kMin, 0, slice.kMax]) {
      if (k < slice.kMin || k > slice.kMax) continue;
      const w = Math.max(sviTotalVariance(slice.parameters, k), 0);
      const ivPct = 100 * Math.sqrt(w / slice.yearsToExpiry);
      knotX.push(k);
      knotY.push(slice.yearsToExpiry);
      knotZ.push(ivPct);
      knotText.push(`Expiry ${slice.expiry}<br>k = ${k.toFixed(3)}<br>IV = ${ivPct.toFixed(2)}%`);
    }
  }

  const colors = sceneColorsByTheme[theme];
  const surface: PlotlyTrace = {
    type: "surface",
    x: kGrid,
    y: yVals,
    z: zMatrix,
    // A precomputed per-point text matrix here (instead of hovertemplate) breaks Plotly gl3d's scene
    // background fill -- verified by isolated repro: same data, only removing the 2D text array fixes it.
    hovertemplate: "log-moneyness %{x:.3f}<br>years to expiry %{y:.3f}<br>IV %{z:.2f}%<extra></extra>",
    colorscale: sequentialRamp,
    connectgaps: false,
    showscale: true,
    // No colorbar title: the nested `title: { text, font }` form breaks this Plotly build's gl3d
    // scene-background fill entirely (verified by isolated bisection), and the flat string form renders
    // without a visible label here either -- the z-axis title ("implied volatility %") already says what
    // the color encodes, so the colorbar is left unlabeled rather than risking the background bug again.
    colorbar: { tickfont: { color: colors.ink, size: isNarrow ? axisFontSizes.narrow.colorbarTick : axisFontSizes.wide.colorbarTick }, thickness: isNarrow ? 10 : 14, len: 0.75 },
    lighting: { ambient: 0.65, diffuse: 0.55, roughness: 0.9, specular: 0.15 },
  };

  const knots: PlotlyTrace = {
    type: "scatter3d",
    mode: "markers",
    x: knotX,
    y: knotY,
    z: knotZ,
    text: knotText,
    hoverinfo: "text",
    marker: { size: 3, color: colors.knot, opacity: 0.85 },
    name: "fitted knots",
    visible: showKnots,
  };

  return { surface, knots };
}

// Informational, read-only modal (no form/submission) -- closes on backdrop click per the app's convention
// for display-only modals.
export function VolatilitySurfaceModal({ symbol, onClose }: VolatilitySurfaceModalProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const plottedRef = useRef(false);
  const [modalBg, setModalBg] = useState<string | null>(null);
  const [signals, setSignals] = useState<TickerSignalsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showKnots, setShowKnots] = useState(true);
  const [chartHeight, setChartHeight] = useState(desktopChartHeight);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTickerSignals(symbol)
      .then((data) => {
        if (!cancelled) setSignals(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : `Failed to load the volatility surface for ${symbol}.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Reads the modal's own resolved background (Tabler's --tblr-bg-surface) so the chart's canvas matches it
  // exactly instead of a hand-picked near-black/near-white approximation -- re-read on theme change since
  // that token's value differs between light and dark.
  useEffect(() => {
    const resolved = modalContentRef.current ? getComputedStyle(modalContentRef.current).backgroundColor : null;
    if (resolved) setModalBg(resolved);
  }, [theme]);

  const traces = useMemo(() => (signals ? buildSurfaceTraces(signals.slices, theme, showKnots, isNarrow) : null), [signals, theme, showKnots, isNarrow]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !traces) return;
    const colors = sceneColorsByTheme[theme];
    const bg = modalBg ?? colors.bg; // matches the modal's own --tblr-bg-surface once measured; falls back until then
    const fonts = isNarrow ? axisFontSizes.narrow : axisFontSizes.wide;
    const layout: PlotlyTrace = {
      paper_bgcolor: bg,
      plot_bgcolor: bg,
      margin: isNarrow ? { l: 20, r: 20, t: 5, b: 5 } : { l: 70, r: 70, t: 0, b: 10 },
      uirevision: symbol, // preserves the viewer's camera angle across knot-toggle / theme / resize re-renders
      scene: {
        bgcolor: bg, // the gl3d canvas's own fill -- separate from paper_bgcolor, which only tints the div behind it
        xaxis: { title: { text: "log-moneyness ln(K/F)", font: { color: colors.ink, size: fonts.title } }, gridcolor: colors.grid, zerolinecolor: colors.grid, tickfont: { color: colors.ink, size: fonts.tick }, backgroundcolor: bg },
        yaxis: { title: { text: "years to expiry", font: { color: colors.ink, size: fonts.title } }, gridcolor: colors.grid, zerolinecolor: colors.grid, tickfont: { color: colors.ink, size: fonts.tick }, backgroundcolor: bg },
        zaxis: { title: { text: "implied volatility %", font: { color: colors.ink, size: fonts.title } }, gridcolor: colors.grid, zerolinecolor: colors.grid, tickfont: { color: colors.ink, size: fonts.tick }, backgroundcolor: bg },
        camera: { eye: defaultCameraEye, center: defaultCameraCenter },
        aspectmode: "cube",
      },
      // "inherit" is a valid CSS keyword but meaningless to the raw Canvas 2D context gl3d rasterizes
      // tick/axis text with -- it silently fails to parse, so nothing gets drawn. A real font stack fixes it.
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif" },
    };
    // @types/plotly.js's Layout/Data shapes predate several gl3d attributes this chart uses (see the
    // PlotlyTrace comment above) -- cast at this single call site, the only place the permissive runtime
    // API is actually invoked.
    Plotly.react(container, [traces.surface, traces.knots] as unknown as Plotly.Data[], layout as unknown as Partial<Plotly.Layout>, { displayModeBar: false, responsive: true });
    plottedRef.current = true;
  }, [traces, theme, symbol, isNarrow, modalBg]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setChartHeight(currentChartHeight());
    setIsNarrow(container.clientWidth < narrowChartWidthPx);
    const onWindowResize = () => setChartHeight(currentChartHeight());
    window.addEventListener("resize", onWindowResize);
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width) return;
      setIsNarrow(width < narrowChartWidthPx);
      if (plottedRef.current) Plotly.Plots.resize(container);
    });
    resizeObserver.observe(container);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      resizeObserver.disconnect();
    };
    // Re-runs when `traces` flips from null to set: the chart <div> this effect measures only exists once
    // `signals` has loaded (see the conditional render below), so containerRef.current is null at mount --
    // an empty dep array here would leave chartHeight/isNarrow stuck at their initial defaults forever.
  }, [traces]);

  useEffect(
    () => () => {
      if (containerRef.current) Plotly.purge(containerRef.current);
    },
    [],
  );

  function resetCamera() {
    if (!containerRef.current) return;
    // Dotted-path relayout keys (Plotly's own idiom for updating a nested scene property) aren't
    // represented in Partial<Layout>, hence the cast.
    Plotly.relayout(containerRef.current, { "scene.camera": { eye: defaultCameraEye, center: defaultCameraCenter } } as unknown as Partial<Plotly.Layout>);
  }

  return (
    <>
      <div
        className="modal-backdrop show"
        style={{ zIndex: 1050, backgroundColor: "rgba(0,0,0,0.5)", opacity: 1 }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      />
      <div className="modal show d-block" style={{ zIndex: 1050 }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="modal-dialog modal-dialog-scrollable modal-dialog-centered" style={{ maxWidth: "90vw" }}>
          <div className="modal-content" ref={modalContentRef}>
            <div className="modal-header">
              <h5 className="modal-title">Volatility Surface — {symbol}</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {loading && <Spinner size="sm" label="Loading the volatility surface" />}
              {error && <div className="alert alert-danger">{error}</div>}
              {signals && !loading && !error && (
                <>
                  <div className="d-flex flex-wrap gap-3 mb-3" style={{ fontSize: "0.75rem" }}>
                    <span className="text-secondary">
                      Snapshot <span className="font-mono">{signals.snapshotDateIso ? formatDate(signals.snapshotDateIso) : "—"}</span>
                    </span>
                    <span className="text-secondary">
                      Spot <span className="font-mono">{signals.spotPrice !== null ? formatCurrency(signals.spotPrice) : "—"}</span>
                    </span>
                    <span className="text-secondary">
                      Expiries fitted <span className="font-mono">{signals.fittedSliceCount}/{signals.totalSliceCount} ok</span>
                    </span>
                  </div>

                  <div className="row g-3">
                    <div className="col-12 volatility-surface-chart-col">
                      {traces ? (
                        <div
                          ref={containerRef}
                          style={{ height: chartHeight, width: "100%", backgroundColor: modalBg ?? sceneColorsByTheme[theme].bg }}
                        />
                      ) : (
                        <div className="alert alert-warning">No expiry fitted with status "ok" on the latest snapshot — nothing to plot.</div>
                      )}
                    </div>

                    <div className="col-12 volatility-surface-table-col">
                  <div className="table-responsive">
                    <table className="table table-sm card-table" style={{ fontSize: "0.75rem" }}>
                      <thead className="table-light">
                        <tr>
                          <th>Expiry</th>
                          <TooltipSpan as="th" className="text-end" text="Time to expiry in years — the T in the SVI total-variance formula, w(k) = IV² × T">
                            T (yrs)
                          </TooltipSpan>
                          <th className="text-end">Forward</th>
                          <th className="text-center">Status</th>
                          <th className="text-end">Points</th>
                          <TooltipSpan as="th" className="text-end" text="Root-mean-square difference between the fitted SVI curve and the market's quoted implied vols, in volatility points (e.g. 0.0172 = 1.72 vol points)">
                            RMSE (vol)
                          </TooltipSpan>
                          <TooltipSpan as="th" className="text-end" text="Minimum Butterfly Density">
                            MBD
                          </TooltipSpan>
                          <TooltipSpan as="th" className="text-end" text="Log-moneyness range ln(K/F) this expiry's quotes actually covered — the curve is only evaluated inside this range; outside it would be extrapolation past the fit">
                            k range
                          </TooltipSpan>
                          <TooltipSpan as="th" className="text-end" text="Calendar Violations">
                            CV
                          </TooltipSpan>
                        </tr>
                      </thead>
                      <tbody>
                        {signals.slices.map((slice) => (
                          <tr key={slice.expiry}>
                            <td className="font-mono">{formatDate(slice.expiry)}</td>
                            <td className="text-end font-mono">{slice.yearsToExpiry.toFixed(3)}</td>
                            <td className="text-end font-mono">{formatCurrency(slice.forwardPrice)}</td>
                            <td className="text-center">
                              <span className={statusBadgeClass[slice.status]} style={{ fontSize: "0.72rem" }}>
                                {statusLabel[slice.status]}
                              </span>
                            </td>
                            <td className="text-end font-mono">{slice.pointCount}</td>
                            <td className="text-end font-mono">{formatPercentage(slice.rmseVolatility, 2)}</td>
                            <td className="text-end font-mono">{slice.minButterflyDensity !== null ? slice.minButterflyDensity.toFixed(3) : "—"}</td>
                            <td className="text-end font-mono">{slice.kMin !== null && slice.kMax !== null ? `[${slice.kMin.toFixed(2)}, ${slice.kMax.toFixed(2)}]` : "—"}</td>
                            <td className="text-end font-mono">
                              {slice.calendarChecks > 0 ? `${slice.calendarViolations}/${slice.calendarChecks}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                      {traces && (
                        <p className="text-secondary mt-2" style={{ fontSize: "0.72rem" }}>
                          Each expiry is fit independently (per-expiry raw SVI) — there is no calendar-time interpolation model between them. The sheet
                          between expiry rows is a rendering convenience, not a modeled surface. Gaps mark log-moneyness outside that expiry's fitted
                          range, where evaluating the curve would be extrapolation past the quotes that fit it.
                        </p>
                      )}
                    </div>
                  </div>

                  {traces && (
                    <div className="row">
                      <div className="col-12 volatility-surface-chart-col d-flex flex-wrap justify-content-center gap-2 mt-2 mb-3">
                        <button type="button" className={`btn btn-sm ${showKnots ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setShowKnots((v) => !v)}>
                          {showKnots ? "− fitted knots" : "+ fitted knots"}
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={resetCamera}>
                          Reset view
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
