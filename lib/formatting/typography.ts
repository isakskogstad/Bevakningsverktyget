/**
 * TypographyGenerator - Generera typografisystem och CSS
 *
 * Funktioner:
 * - Typografisk skala (1.25 ratio)
 * - CSS-variabler för fonts
 * - Responsiva typsnitt
 * - Impact Loop-branding
 */

export interface TypographyOptions {
  fontFamily?: string;
  baseFontSize?: number;
  lineHeight?: number;
  headingFont?: string;
  primaryColor?: string;
  accentColor?: string;
  linkColor?: string;
}

export class TypographyGenerator {
  /**
   * Generera komplett CSS-typografisystem
   */
  static generateCSS(options: TypographyOptions = {}): string {
    const {
      fontFamily = "'Inter', sans-serif",
      baseFontSize = 16,
      lineHeight = 1.7,
      headingFont = fontFamily,
      primaryColor = "#1a1a1a",
      accentColor = "#D4FF00",
      linkColor = "#0066cc",
    } = options;

    return `
/* Typography System - Generated */
:root {
  --font-family: ${fontFamily};
  --heading-font: ${headingFont};
  --base-font-size: ${baseFontSize}px;
  --line-height: ${lineHeight};
  --primary-color: ${primaryColor};
  --accent-color: ${accentColor};
  --link-color: ${linkColor};

  /* Type Scale (1.25 ratio) */
  --text-xs: ${(baseFontSize * 0.64).toFixed(2)}px;
  --text-sm: ${(baseFontSize * 0.8).toFixed(2)}px;
  --text-base: ${baseFontSize}px;
  --text-lg: ${(baseFontSize * 1.25).toFixed(2)}px;
  --text-xl: ${(baseFontSize * 1.563).toFixed(2)}px;
  --text-2xl: ${(baseFontSize * 1.953).toFixed(2)}px;
  --text-3xl: ${(baseFontSize * 2.441).toFixed(2)}px;
  --text-4xl: ${(baseFontSize * 3.052).toFixed(2)}px;

  /* Spacing Scale */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
}

body {
  font-family: var(--font-family);
  font-size: var(--base-font-size);
  line-height: var(--line-height);
  color: var(--primary-color);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--heading-font);
  font-weight: 700;
  line-height: 1.2;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  letter-spacing: -0.02em;
}

h1 { font-size: var(--text-4xl); }
h2 { font-size: var(--text-3xl); }
h3 { font-size: var(--text-2xl); }
h4 { font-size: var(--text-xl); }
h5 { font-size: var(--text-lg); }
h6 { font-size: var(--text-base); font-weight: 600; }

p {
  margin-bottom: 1.5em;
}

a {
  color: var(--link-color);
  text-decoration: none;
  transition: color 0.2s, text-decoration 0.2s;
}

a:hover {
  text-decoration: underline;
}

strong, b {
  font-weight: 600;
}

em, i {
  font-style: italic;
}

blockquote {
  border-left: 4px solid var(--accent-color);
  padding-left: 1em;
  margin: 1.5em 0;
  font-style: italic;
  color: #666;
}

code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.9em;
  background: #f4f4f4;
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

pre code {
  display: block;
  padding: 1em;
  overflow-x: auto;
}

/* Utility Classes */
.lead {
  font-size: var(--text-lg);
  font-weight: 500;
  line-height: 1.5;
}

.small {
  font-size: var(--text-sm);
}

.caption {
  font-size: var(--text-xs);
  color: #888;
}

.text-muted {
  color: #6b7280;
}

.text-accent {
  color: var(--accent-color);
}

.text-center { text-align: center; }
.text-right { text-align: right; }
.text-left { text-align: left; }

.font-bold { font-weight: 700; }
.font-semibold { font-weight: 600; }
.font-medium { font-weight: 500; }
.font-normal { font-weight: 400; }

/* Article Styling */
.article-content {
  max-width: 680px;
  margin: 0 auto;
}

.article-content h2 {
  margin-top: 2.5em;
  padding-bottom: 0.5em;
  border-bottom: 1px solid #eee;
}

.article-content h3 {
  margin-top: 2em;
}

.article-content ul, .article-content ol {
  padding-left: 1.5em;
  margin-bottom: 1.5em;
}

.article-content li {
  margin-bottom: 0.5em;
}

.article-content img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 1.5em 0;
}

.article-content figure {
  margin: 2em 0;
}

.article-content figcaption {
  font-size: var(--text-sm);
  color: #666;
  text-align: center;
  margin-top: 0.5em;
}

/* Data/Table Typography */
.data-table {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.data-table th {
  font-weight: 600;
  text-transform: uppercase;
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
}

.number-large {
  font-size: var(--text-2xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.number-change-positive {
  color: #10b981;
}

.number-change-negative {
  color: #ef4444;
}
    `.trim();
  }

  /**
   * Generera Impact Loop-specifik typografi
   */
  static generateImpactLoopCSS(): string {
    return this.generateCSS({
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      headingFont: "'Inter', sans-serif",
      baseFontSize: 16,
      lineHeight: 1.6,
      primaryColor: "#1a1a1a",
      accentColor: "#D4FF00",
      linkColor: "#2563eb",
    });
  }

  /**
   * Generera inline styles för e-post
   */
  static generateEmailStyles(): string {
    return `
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
font-size: 16px;
line-height: 1.6;
color: #1a1a1a;
    `.trim();
  }

  /**
   * Generera PDF-optimerad typografi
   */
  static generatePDFStyles(): string {
    return `
@page {
  size: A4;
  margin: 2.5cm;
}

body {
  font-family: 'Georgia', serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #000;
}

h1 {
  font-size: 24pt;
  font-weight: bold;
  margin-bottom: 12pt;
  page-break-after: avoid;
}

h2 {
  font-size: 18pt;
  font-weight: bold;
  margin-top: 24pt;
  margin-bottom: 12pt;
  page-break-after: avoid;
}

h3 {
  font-size: 14pt;
  font-weight: bold;
  margin-top: 18pt;
  margin-bottom: 6pt;
  page-break-after: avoid;
}

p {
  margin-bottom: 12pt;
  text-align: justify;
  orphans: 2;
  widows: 2;
}

table {
  width: 100%;
  border-collapse: collapse;
  page-break-inside: avoid;
}

th, td {
  border: 0.5pt solid #666;
  padding: 6pt;
  font-size: 10pt;
}

th {
  background: #f0f0f0;
  font-weight: bold;
}
    `.trim();
  }
}

/**
 * Färgpaletter för typografi
 */
export const colorPalettes = {
  impactLoop: {
    primary: "#1a1a1a",
    secondary: "#4b5563",
    accent: "#D4FF00",
    background: "#ffffff",
    surface: "#f9fafb",
    border: "#e5e7eb",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
  },
  professional: {
    primary: "#111827",
    secondary: "#6b7280",
    accent: "#3b82f6",
    background: "#ffffff",
    surface: "#f3f4f6",
    border: "#d1d5db",
    success: "#059669",
    warning: "#d97706",
    error: "#dc2626",
  },
  dark: {
    primary: "#f9fafb",
    secondary: "#9ca3af",
    accent: "#60a5fa",
    background: "#111827",
    surface: "#1f2937",
    border: "#374151",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
  },
};

export default TypographyGenerator;
