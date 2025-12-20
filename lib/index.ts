/**
 * Bevakningsverktyg Library Index
 *
 * Exporterar alla verktyg för Claude Opus 4.5 API-integration
 */

// Formatting
export {
  TextFormatter,
  intelligentFormat,
} from "./formatting/textFormatter";

export {
  TypographyGenerator,
  colorPalettes,
} from "./formatting/typography";

// Images
export {
  analyzeImageComprehensive,
  extractTextFromImage,
  generateAltText,
  ImageGenerator,
  generateImageFromDescription,
} from "./images/imageAnalyzer";

// References
export {
  CitationManager,
  URLHandler,
  autoLinkText,
} from "./references/citationManager";

// Charts
export {
  generateChartConfig,
  generateSVGBarChart,
  generateSVGLineChart,
  generateSVGPieChart,
  generateMermaidDiagram,
  generateHTMLTable,
  generateTableCSS,
  CHART_COLORS,
} from "./charts/chartGenerator";

// Agents
export {
  runAgentLoop,
  runAgentsInParallel,
  runAgentDAG,
  standardTools,
  createToolHandler,
  summarizeResults,
} from "./agents/agentOrchestrator";

// Types
export type { ChartDataPoint, ChartConfig } from "./charts/chartGenerator";
export type { Source, CitationStyle } from "./references/citationManager";
export type { ImageAnalysisResult, ImageGeneratorConfig } from "./images/imageAnalyzer";
export type { TypographyOptions } from "./formatting/typography";
export type { Tool, ToolResult, AgentTask, AgentResult } from "./agents/agentOrchestrator";
