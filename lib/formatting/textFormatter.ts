/**
 * TextFormatter - Avancerad textformattering
 *
 * Funktioner:
 * - Markdown till HTML
 * - HTML till ren text
 * - Siffror, valuta, procent, datum (sv-SE)
 * - Trunkering, kapitalisering, slugifiering
 * - Intelligent formattering med Claude
 */

import Anthropic from "@anthropic-ai/sdk";

export class TextFormatter {
  /**
   * Konvertera Markdown till HTML
   */
  static markdownToHTML(markdown: string): string {
    let html = markdown
      // Headers
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")

      // Bold & Italic
      .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")

      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

      // Lists
      .replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>")

      // Paragraphs
      .replace(/\n\n/g, "</p><p>")

      // Line breaks
      .replace(/\n/g, "<br>");

    // Wrap lists
    html = html.replace(/(<li>.*<\/li>)+/g, "<ul>$&</ul>");

    // Wrap in paragraph
    if (!html.startsWith("<")) {
      html = `<p>${html}</p>`;
    }

    return html;
  }

  /**
   * Konvertera HTML till ren text
   */
  static htmlToText(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<li>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Formatera siffror med svenska lokalinställningar
   */
  static formatNumber(
    num: number | null | undefined,
    options: {
      locale?: string;
      decimals?: number;
      prefix?: string;
      suffix?: string;
    } = {}
  ): string {
    const {
      locale = "sv-SE",
      decimals = 0,
      prefix = "",
      suffix = "",
    } = options;

    if (num === null || num === undefined || isNaN(num)) return "N/A";

    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);

    return `${prefix}${formatted}${suffix}`;
  }

  /**
   * Formatera valuta (SEK, EUR, USD)
   */
  static formatCurrency(
    amount: number | null | undefined,
    currency: string = "SEK"
  ): string {
    if (amount === null || amount === undefined) return "N/A";

    return new Intl.NumberFormat("sv-SE", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Formatera procent med tecken
   */
  static formatPercent(
    value: number | null | undefined,
    decimals: number = 1
  ): string {
    if (value === null || value === undefined) return "N/A";

    const formatted = (value * 100).toFixed(decimals);
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatted}%`;
  }

  /**
   * Formatera datum
   */
  static formatDate(
    date: string | Date,
    format: "full" | "short" | "relative" | "iso" = "full"
  ): string {
    const d = new Date(date);
    if (isNaN(d.getTime())) return "N/A";

    const formats: Record<string, Intl.DateTimeFormatOptions | null> = {
      full: { year: "numeric", month: "long", day: "numeric" },
      short: { year: "numeric", month: "2-digit", day: "2-digit" },
      relative: null,
      iso: null,
    };

    if (format === "iso") {
      return d.toISOString().split("T")[0];
    }

    if (format === "relative") {
      return this.formatRelativeDate(d);
    }

    return d.toLocaleDateString("sv-SE", formats[format] || formats.full!);
  }

  /**
   * Formatera relativt datum (t.ex. "3 dagar sedan")
   */
  static formatRelativeDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 30) return this.formatDate(date, "short");
    if (days > 0) return `${days} dag${days > 1 ? "ar" : ""} sedan`;
    if (hours > 0) return `${hours} timm${hours > 1 ? "ar" : "e"} sedan`;
    if (minutes > 0) return `${minutes} minut${minutes > 1 ? "er" : ""} sedan`;
    return "Just nu";
  }

  /**
   * Trunkera text till maxlängd
   */
  static truncate(
    text: string,
    maxLength: number,
    suffix: string = "..."
  ): string {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength - suffix.length).trim() + suffix;
  }

  /**
   * Kapitalisera första bokstaven
   */
  static capitalize(text: string): string {
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  /**
   * Title Case med svenska undantag
   */
  static titleCase(text: string): string {
    if (!text) return "";
    const exceptions = [
      "och",
      "i",
      "på",
      "av",
      "för",
      "med",
      "till",
      "den",
      "det",
      "de",
    ];

    return text
      .split(" ")
      .map((word, i) => {
        if (i > 0 && exceptions.includes(word.toLowerCase())) {
          return word.toLowerCase();
        }
        return this.capitalize(word);
      })
      .join(" ");
  }

  /**
   * Skapa URL-vänlig slug
   */
  static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/å/g, "a")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  /**
   * Extrahera nyckelord från text
   */
  static extractKeywords(text: string, minLength: number = 4): string[] {
    const stopwords = [
      "och",
      "eller",
      "men",
      "som",
      "att",
      "den",
      "det",
      "de",
      "en",
      "ett",
      "på",
      "i",
      "av",
      "för",
      "med",
      "till",
      "från",
      "om",
      "vid",
      "har",
      "hade",
      "vara",
      "är",
      "var",
      "blev",
      "blir",
      "ska",
      "skulle",
      "kan",
      "kunde",
      "denna",
      "detta",
      "dessa",
      "sin",
      "sitt",
      "sina",
    ];

    const words = text.toLowerCase().match(/\b\w+\b/g) || [];

    const filtered = words.filter(
      (word) => word.length >= minLength && !stopwords.includes(word)
    );

    // Räkna frekvens
    const freq: Record<string, number> = {};
    for (const word of filtered) {
      freq[word] = (freq[word] || 0) + 1;
    }

    // Sortera efter frekvens
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Beräkna lästid
   */
  static estimateReadingTime(text: string, wordsPerMinute: number = 200): {
    minutes: number;
    text: string;
  } {
    const wordCount = text.split(/\s+/).length;
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return {
      minutes,
      text: minutes === 1 ? "1 minut" : `${minutes} minuter`,
    };
  }
}

/**
 * Intelligent formattering med Claude
 */
export async function intelligentFormat(
  text: string,
  style: "article" | "formal" | "casual" = "article",
  apiKey?: string
): Promise<string> {
  const client = new Anthropic({
    apiKey: apiKey || Anthropic.ANTHROPIC_API_KEY,
  });

  const styleInstructions = {
    article: `
      - Dela upp i tydliga stycken
      - Lägg till mellanrubriker (##)
      - Använd **fetstil** för viktiga begrepp
      - Formatera siffror konsekvent (tusentalsavgränsare)
      - Korta meningar, max 25 ord
    `,
    formal: `
      - Formell ton
      - Inga sammandragningar
      - Fullständiga meningar
      - Akademisk struktur
    `,
    casual: `
      - Avslappnad ton
      - Kortare meningar
      - Direkt tilltal
      - Kan använda emoji där lämpligt
    `,
  };

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Formatera följande text enligt stilen "${style}":

TEXT:
${text}

INSTRUKTIONER för stil "${style}":
${styleInstructions[style]}

Returnera den formaterade texten.`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type === "text") {
    return content.text;
  }
  throw new Error("Unexpected response type");
}

export default TextFormatter;
