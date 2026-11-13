/** The value of a CSS colour variable on the document root ("--tblr-blue", "--iorio-book-pluto"), for chart series: ApexCharts
 * needs the colour itself. Read at render time, so a component that also reads useTheme() picks up the theme's value. */
export function cssVariableColor(variableName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
}
