import type { ApexOptions } from "apexcharts";
import { ApexChart, textColorByTheme } from "../charts/ApexChart";
import type { AnalysisBook, PnlAnalysis } from "../../api/pnlAnalysis";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import { cssVariableColor } from "../../lib/cssColors";
import { formatCurrency, formatDayMonth, formatSignedPercentageValue } from "../../lib/formatters";
import { bookChoiceLabels, bookColorVariable, bookLinePoints, roundAxisBounds, separatedLabelOffsets } from "../../lib/pnlAnalysisPresentation";

const bookOrder: AnalysisBook[] = ["pluto", "manual", "all"];
/** The plot's height inside the chart: the chart's less the x-axis labels and, on the growth chart, the legend. */
const plotHeightAllowance = { growth: 88, drawdown: 64 };
const endLabelGap = 15;
/** Moves an annotation label from above its point to centred on it. */
const endLabelCentring = 5;

// Growth of $100 and the drawdown below each book's last peak, one point per night (mockup approved 2026-11-13). All
// books is dashed; each line carries its name and value at its end, in the body colour (Manual's pink is a line colour,
// 3.4:1 as text), the labels kept apart when lines end close together; a book funded after its range began is flat until then.
// When the range starts before the books, a dotted line marks the books' first night: before it only All books exists.
export function BookGrowthCharts({ analysis, emphasisBook, growthHeight = 250, drawdownHeight = 190 }: { analysis: PnlAnalysis; emphasisBook?: AnalysisBook; growthHeight?: number; drawdownHeight?: number }) {
  const { theme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 575.98px)");
  const booksBeginInRange = analysis.booksFirstNight !== null && analysis.range !== null && analysis.booksFirstNight > analysis.range.baselineNight;

  const chartFor = (field: "growth" | "drawdown") => {
    const lines = bookOrder.map((book) => ({ book, points: bookLinePoints(analysis.books[book], field) })).filter((line) => line.points.length > 0);
    const formatValue = (value: number) => (field === "growth" ? formatCurrency(value, 2) : formatSignedPercentageValue(value, 2));
    const height = field === "growth" ? growthHeight : drawdownHeight;
    const axis = roundAxisBounds(lines.flatMap((line) => line.points.map((point) => point.value)), field === "drawdown" ? 0 : undefined);
    const plotHeight = height - plotHeightAllowance[field];
    const ends = lines.map((line) => line.points.at(-1)!);
    const labelOffsets = separatedLabelOffsets(ends.map((end) => ((axis.max - end.value) / (axis.max - axis.min)) * plotHeight), endLabelGap);
    // On a phone the end labels would take half the plot: the legend names the lines instead.
    const endLabels = isPhone
      ? []
      : lines.map((line, index) => ({
          x: Date.parse(`${ends[index]!.night}T00:00:00Z`),
          // A hair inside the axis: ApexCharts drops a point annotation that rounds to just outside the plot (a 0% drawdown).
          y: Math.min(Math.max(ends[index]!.value, axis.min + (axis.max - axis.min) * 0.001), axis.max - (axis.max - axis.min) * 0.001),
          marker: { size: 0 },
          label: {
            text: `${bookChoiceLabels[line.book]} ${formatValue(ends[index]!.value)}`,
            borderWidth: 0,
            textAnchor: "start",
            offsetX: 8,
            offsetY: endLabelCentring + labelOffsets[index]!,
            style: { background: "transparent", color: cssVariableColor("--tblr-body-color"), fontSize: "0.75rem", fontWeight: 600 },
          },
        }));
    const options: ApexOptions = {
      chart: { zoom: { enabled: false }, animations: { enabled: false } },
      colors: lines.map((line) => cssVariableColor(bookColorVariable[line.book])),
      stroke: { curve: "straight", width: lines.map((line) => (emphasisBook && line.book === emphasisBook ? 3.5 : 2.5)), dashArray: lines.map((line) => (line.book === "all" ? 6 : 0)) },
      xaxis: { type: "datetime", labels: { datetimeUTC: true, format: "d MMM" } },
      yaxis: { min: axis.min, max: axis.max, tickAmount: Math.min(Math.round((axis.max - axis.min) / axis.step), 6), labels: { formatter: (value: number) => (field === "growth" ? formatCurrency(value, 0) : `${value.toFixed(0)}%`) } },
      grid: { padding: { right: isPhone ? 10 : 150 } },
      legend: { show: field === "growth", position: "top", horizontalAlign: "right" },
      tooltip: { shared: true, x: { format: "d MMM yyyy" }, y: { formatter: formatValue } },
      dataLabels: { enabled: false },
      annotations: {
        points: endLabels,
        xaxis: booksBeginInRange
          ? [
              {
                x: Date.parse(`${analysis.booksFirstNight}T00:00:00Z`),
                borderColor: textColorByTheme[theme],
                strokeDashArray: 3,
                label: { text: field === "growth" ? `Books begin ${formatDayMonth(analysis.booksFirstNight!)}` : "", orientation: "horizontal", borderWidth: 0, style: { color: textColorByTheme[theme], background: "transparent", fontSize: "0.72rem" } },
              },
            ]
          : [],
      },
    };
    const series = lines.map((line) => ({ name: bookChoiceLabels[line.book], data: line.points.map((point) => ({ x: Date.parse(`${point.night}T00:00:00Z`), y: point.value })) }));
    return { options, series };
  };

  const growth = chartFor("growth");
  const drawdown = chartFor("drawdown");
  return (
    <div className="d-flex flex-column gap-2">
      <div>
        <div className="fw-semibold">Growth of $100</div>
        <ApexChart type="line" height={growthHeight} series={growth.series} options={growth.options} />
      </div>
      <div>
        <div className="fw-semibold">
          Drawdown <span className="text-secondary fw-normal" style={{ fontSize: "0.8rem" }}>below each book's last peak</span>
        </div>
        <ApexChart type="line" height={drawdownHeight} series={drawdown.series} options={drawdown.options} />
      </div>
    </div>
  );
}
