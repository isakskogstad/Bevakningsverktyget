/**
 * ChartGenerator - Grafgenerering med Chart.js, SVG och Mermaid
 *
 * Funktioner:
 * - Chart.js konfigurationer för alla diagramtyper
 * - Rena SVG-grafer utan dependencies
 * - Mermaid diagram (flödesscheman, sekvensdiagram)
 * - HTML-tabeller med styling
 */

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface ChartConfig {
  type: "bar" | "line" | "pie" | "doughnut" | "radar" | "area";
  title?: string;
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    fill?: boolean;
  }>;
  options?: Record<string, unknown>;
}

// Impact Loop färgpalett
export const CHART_COLORS = {
  primary: "#D4FF00",
  secondary: "#1a1a1a",
  blue: "#3b82f6",
  green: "#10b981",
  red: "#ef4444",
  yellow: "#f59e0b",
  purple: "#8b5cf6",
  pink: "#ec4899",
  gray: "#6b7280",
  palette: [
    "#D4FF00",
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#f97316",
  ],
};

/**
 * Generera Chart.js konfiguration
 */
export function generateChartConfig(config: ChartConfig): object {
  const {
    type,
    title,
    labels,
    datasets,
    options = {},
  } = config;

  // Lägg till färger om de saknas
  const coloredDatasets = datasets.map((ds, i) => ({
    ...ds,
    backgroundColor:
      ds.backgroundColor ||
      (type === "pie" || type === "doughnut"
        ? CHART_COLORS.palette
        : CHART_COLORS.palette[i % CHART_COLORS.palette.length]),
    borderColor:
      ds.borderColor ||
      (type === "line" || type === "area"
        ? CHART_COLORS.palette[i % CHART_COLORS.palette.length]
        : undefined),
    fill: ds.fill ?? (type === "area"),
  }));

  return {
    type: type === "area" ? "line" : type,
    data: {
      labels,
      datasets: coloredDatasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: title
          ? {
              display: true,
              text: title,
              font: { size: 16, weight: "bold" },
            }
          : undefined,
        legend: {
          display: datasets.length > 1 || type === "pie" || type === "doughnut",
          position: "bottom",
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (context: { dataset: { label: string }; raw: number }) => {
              const label = context.dataset.label || "";
              const value =
                typeof context.raw === "number"
                  ? context.raw.toLocaleString("sv-SE")
                  : context.raw;
              return `${label}: ${value}`;
            },
          },
        },
      },
      scales:
        type !== "pie" && type !== "doughnut" && type !== "radar"
          ? {
              x: {
                grid: { display: false },
              },
              y: {
                beginAtZero: true,
                ticks: {
                  callback: (value: number) => value.toLocaleString("sv-SE"),
                },
              },
            }
          : undefined,
      ...options,
    },
  };
}

/**
 * Generera ren SVG stapeldiagram
 */
export function generateSVGBarChart(
  data: ChartDataPoint[],
  options: {
    width?: number;
    height?: number;
    title?: string;
    showValues?: boolean;
    colors?: string[];
  } = {}
): string {
  const {
    width = 600,
    height = 400,
    title,
    showValues = true,
    colors = CHART_COLORS.palette,
  } = options;

  const padding = { top: title ? 50 : 30, right: 30, bottom: 60, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map((d) => d.value));
  const barWidth = chartWidth / data.length - 10;

  const bars = data
    .map((d, i) => {
      const barHeight = (d.value / maxValue) * chartHeight;
      const x = padding.left + i * (barWidth + 10) + 5;
      const y = padding.top + chartHeight - barHeight;
      const color = d.color || colors[i % colors.length];

      return `
      <g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}"
              fill="${color}" rx="4" class="bar" data-value="${d.value}"/>
        <text x="${x + barWidth / 2}" y="${height - padding.bottom + 20}"
              text-anchor="middle" font-size="12" fill="#666">${d.label}</text>
        ${
          showValues
            ? `<text x="${x + barWidth / 2}" y="${y - 5}"
               text-anchor="middle" font-size="11" fill="#333" font-weight="500">
               ${d.value.toLocaleString("sv-SE")}
             </text>`
            : ""
        }
      </g>
    `;
    })
    .join("");

  // Y-axel med linjer
  const yTicks = 5;
  const yAxis = Array.from({ length: yTicks + 1 }, (_, i) => {
    const value = Math.round((maxValue / yTicks) * i);
    const y = padding.top + chartHeight - (i / yTicks) * chartHeight;
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"
            stroke="#eee" stroke-width="1"/>
      <text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#666">
        ${value.toLocaleString("sv-SE")}
      </text>
    `;
  }).join("");

  return `
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .bar { transition: opacity 0.2s; }
    .bar:hover { opacity: 0.8; }
  </style>
  ${
    title
      ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">${title}</text>`
      : ""
  }
  ${yAxis}
  ${bars}
</svg>
  `.trim();
}

/**
 * Generera ren SVG linjediagram
 */
export function generateSVGLineChart(
  data: ChartDataPoint[],
  options: {
    width?: number;
    height?: number;
    title?: string;
    showPoints?: boolean;
    fill?: boolean;
    color?: string;
  } = {}
): string {
  const {
    width = 600,
    height = 400,
    title,
    showPoints = true,
    fill = false,
    color = CHART_COLORS.primary,
  } = options;

  const padding = { top: title ? 50 : 30, right: 30, bottom: 60, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map((d) => d.value));
  const minValue = Math.min(...data.map((d) => d.value));
  const range = maxValue - minValue || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y =
      padding.top + chartHeight - ((d.value - minValue) / range) * chartHeight;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  const fillPath = fill
    ? `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`
    : "";

  return `
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${
    title
      ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">${title}</text>`
      : ""
  }

  ${
    fill
      ? `<path d="${fillPath}" fill="${color}" opacity="0.1"/>`
      : ""
  }

  <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>

  ${
    showPoints
      ? points
          .map(
            (p) => `
    <circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}"/>
    <title>${p.label}: ${p.value.toLocaleString("sv-SE")}</title>
  `
          )
          .join("")
      : ""
  }

  ${points
    .map(
      (p, i) => `
    <text x="${p.x}" y="${height - padding.bottom + 20}"
          text-anchor="middle" font-size="11" fill="#666"
          transform="rotate(-45, ${p.x}, ${height - padding.bottom + 20})">
      ${p.label}
    </text>
  `
    )
    .join("")}
</svg>
  `.trim();
}

/**
 * Generera SVG cirkeldiagram
 */
export function generateSVGPieChart(
  data: ChartDataPoint[],
  options: {
    width?: number;
    height?: number;
    title?: string;
    donut?: boolean;
    showLabels?: boolean;
    colors?: string[];
  } = {}
): string {
  const {
    width = 400,
    height = 400,
    title,
    donut = false,
    showLabels = true,
    colors = CHART_COLORS.palette,
  } = options;

  const centerX = width / 2;
  const centerY = (height + (title ? 30 : 0)) / 2;
  const radius = Math.min(width, height) / 2 - 40;
  const innerRadius = donut ? radius * 0.6 : 0;

  const total = data.reduce((sum, d) => sum + d.value, 0);
  let currentAngle = -Math.PI / 2;

  const slices = data.map((d, i) => {
    const sliceAngle = (d.value / total) * Math.PI * 2;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    const x1 = centerX + Math.cos(startAngle) * radius;
    const y1 = centerY + Math.sin(startAngle) * radius;
    const x2 = centerX + Math.cos(endAngle) * radius;
    const y2 = centerY + Math.sin(endAngle) * radius;

    const largeArc = sliceAngle > Math.PI ? 1 : 0;
    const color = d.color || colors[i % colors.length];

    let path: string;
    if (donut) {
      const ix1 = centerX + Math.cos(startAngle) * innerRadius;
      const iy1 = centerY + Math.sin(startAngle) * innerRadius;
      const ix2 = centerX + Math.cos(endAngle) * innerRadius;
      const iy2 = centerY + Math.sin(endAngle) * innerRadius;
      path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
    } else {
      path = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    }

    // Label position
    const labelAngle = startAngle + sliceAngle / 2;
    const labelRadius = donut ? (radius + innerRadius) / 2 : radius * 0.6;
    const labelX = centerX + Math.cos(labelAngle) * labelRadius;
    const labelY = centerY + Math.sin(labelAngle) * labelRadius;

    return `
      <g>
        <path d="${path}" fill="${color}" class="slice" stroke="white" stroke-width="2">
          <title>${d.label}: ${d.value.toLocaleString("sv-SE")} (${((d.value / total) * 100).toFixed(1)}%)</title>
        </path>
        ${
          showLabels && sliceAngle > 0.3
            ? `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="11" fill="white" font-weight="500">
             ${((d.value / total) * 100).toFixed(0)}%
           </text>`
            : ""
        }
      </g>
    `;
  });

  // Legend
  const legendY = height - 30;
  const legend = data
    .map((d, i) => {
      const x = 20 + (i * (width - 40)) / data.length;
      const color = d.color || colors[i % colors.length];
      return `
      <g transform="translate(${x}, ${legendY})">
        <rect width="12" height="12" fill="${color}" rx="2"/>
        <text x="16" y="10" font-size="11" fill="#666">${d.label}</text>
      </g>
    `;
    })
    .join("");

  return `
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .slice { transition: transform 0.2s; transform-origin: ${centerX}px ${centerY}px; }
    .slice:hover { transform: scale(1.03); }
  </style>
  ${
    title
      ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">${title}</text>`
      : ""
  }
  ${slices.join("")}
  ${legend}
</svg>
  `.trim();
}

/**
 * Generera Mermaid diagram
 */
export function generateMermaidDiagram(
  type: "flowchart" | "sequence" | "classDiagram" | "gantt",
  definition: string
): string {
  const directions: Record<string, string> = {
    flowchart: "TD",
    sequence: "",
    classDiagram: "",
    gantt: "",
  };

  const prefix = type === "flowchart" ? `flowchart ${directions[type]}\n` : `${type}\n`;

  return `\`\`\`mermaid
${prefix}${definition}
\`\`\``;
}

/**
 * Generera HTML-tabell
 */
export function generateHTMLTable(
  headers: string[],
  rows: (string | number)[][],
  options: {
    className?: string;
    sortable?: boolean;
    striped?: boolean;
    compact?: boolean;
  } = {}
): string {
  const {
    className = "data-table",
    sortable = false,
    striped = true,
    compact = false,
  } = options;

  const classes = [
    className,
    striped ? "striped" : "",
    compact ? "compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const headerCells = headers
    .map(
      (h, i) =>
        `<th${sortable ? ` data-sort="${i}" style="cursor: pointer;"` : ""}>${h}</th>`
    )
    .join("");

  const bodyRows = rows
    .map(
      (row, rowIndex) =>
        `<tr>${row.map((cell) => `<td>${typeof cell === "number" ? cell.toLocaleString("sv-SE") : cell}</td>`).join("")}</tr>`
    )
    .join("\n");

  return `
<table class="${classes}">
  <thead>
    <tr>${headerCells}</tr>
  </thead>
  <tbody>
    ${bodyRows}
  </tbody>
</table>
  `.trim();
}

/**
 * Generera CSS för tabeller
 */
export function generateTableCSS(): string {
  return `
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.data-table th,
.data-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}

.data-table th {
  font-weight: 600;
  background: #f9fafb;
  text-transform: uppercase;
  font-size: 12px;
  letter-spacing: 0.05em;
  color: #6b7280;
}

.data-table.striped tbody tr:nth-child(even) {
  background: #f9fafb;
}

.data-table tbody tr:hover {
  background: #f3f4f6;
}

.data-table.compact th,
.data-table.compact td {
  padding: 8px 12px;
}

.data-table td:last-child {
  text-align: right;
}
  `.trim();
}

export default {
  generateChartConfig,
  generateSVGBarChart,
  generateSVGLineChart,
  generateSVGPieChart,
  generateMermaidDiagram,
  generateHTMLTable,
  generateTableCSS,
  CHART_COLORS,
};
