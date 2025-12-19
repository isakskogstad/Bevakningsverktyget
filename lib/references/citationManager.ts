/**
 * CitationManager - Hantera källor och referenser
 *
 * Funktioner:
 * - APA, Harvard, IEEE, Vancouver formatering
 * - Automatisk referenslista
 * - URL-validering
 * - Automatisk länkning
 */

export interface Source {
  id?: string;
  type: "article" | "book" | "website" | "report" | "press_release" | "other";
  title: string;
  authors?: string[];
  organization?: string;
  date?: string;
  url?: string;
  publisher?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  accessDate?: string;
  doi?: string;
}

export type CitationStyle = "apa" | "harvard" | "ieee" | "vancouver";

export class CitationManager {
  private sources: Map<string, Source> = new Map();
  private citationOrder: string[] = [];

  /**
   * Lägg till källa
   */
  addSource(source: Source): string {
    const id = source.id || this.generateId(source);
    this.sources.set(id, { ...source, id });
    return id;
  }

  /**
   * Citera källa i text
   */
  cite(sourceId: string, page?: string): string {
    const source = this.sources.get(sourceId);
    if (!source) return "[källa saknas]";

    if (!this.citationOrder.includes(sourceId)) {
      this.citationOrder.push(sourceId);
    }

    const index = this.citationOrder.indexOf(sourceId) + 1;
    const pageRef = page ? `, s. ${page}` : "";

    return `[${index}${pageRef}]`;
  }

  /**
   * Formatera källa enligt stil
   */
  formatSource(source: Source, style: CitationStyle = "apa"): string {
    switch (style) {
      case "apa":
        return this.formatAPA(source);
      case "harvard":
        return this.formatHarvard(source);
      case "ieee":
        return this.formatIEEE(source);
      case "vancouver":
        return this.formatVancouver(source);
      default:
        return this.formatAPA(source);
    }
  }

  /**
   * APA 7 formatering
   */
  private formatAPA(source: Source): string {
    const parts: string[] = [];

    // Författare eller organisation
    if (source.authors && source.authors.length > 0) {
      parts.push(this.formatAuthorsAPA(source.authors));
    } else if (source.organization) {
      parts.push(source.organization);
    }

    // År
    if (source.date) {
      const year = new Date(source.date).getFullYear();
      parts.push(`(${year}).`);
    } else {
      parts.push("(u.å.).");
    }

    // Titel
    if (source.type === "article" && source.journal) {
      parts.push(`${source.title}.`);
      parts.push(`*${source.journal}*`);
      if (source.volume) {
        parts.push(`, *${source.volume}*`);
        if (source.issue) parts.push(`(${source.issue})`);
      }
      if (source.pages) parts.push(`, ${source.pages}`);
      parts.push(".");
    } else if (source.type === "book") {
      parts.push(`*${source.title}*.`);
      if (source.publisher) parts.push(`${source.publisher}.`);
    } else {
      parts.push(`*${source.title}*.`);
    }

    // URL/DOI
    if (source.doi) {
      parts.push(`https://doi.org/${source.doi}`);
    } else if (source.url) {
      parts.push(source.url);
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  /**
   * Harvard formatering
   */
  private formatHarvard(source: Source): string {
    const parts: string[] = [];

    // Författare
    if (source.authors && source.authors.length > 0) {
      parts.push(this.formatAuthorsHarvard(source.authors));
    } else if (source.organization) {
      parts.push(source.organization);
    }

    // År
    if (source.date) {
      const year = new Date(source.date).getFullYear();
      parts.push(`(${year})`);
    }

    // Titel
    parts.push(`'${source.title}'`);

    // Källa
    if (source.journal) {
      parts.push(`*${source.journal}*`);
      if (source.volume) parts.push(`, vol. ${source.volume}`);
      if (source.issue) parts.push(`, no. ${source.issue}`);
      if (source.pages) parts.push(`, pp. ${source.pages}`);
    } else if (source.publisher) {
      parts.push(source.publisher);
    }

    // URL
    if (source.url) {
      parts.push(
        `Available at: ${source.url} [Accessed: ${source.accessDate || new Date().toISOString().split("T")[0]}]`
      );
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  /**
   * IEEE formatering
   */
  private formatIEEE(source: Source): string {
    const index = this.citationOrder.indexOf(source.id || "") + 1;
    const parts: string[] = [`[${index}]`];

    // Författare
    if (source.authors && source.authors.length > 0) {
      parts.push(this.formatAuthorsIEEE(source.authors) + ",");
    } else if (source.organization) {
      parts.push(source.organization + ",");
    }

    // Titel
    parts.push(`"${source.title},"`);

    // Källa
    if (source.journal) {
      parts.push(`*${source.journal}*,`);
      if (source.volume) parts.push(`vol. ${source.volume},`);
      if (source.issue) parts.push(`no. ${source.issue},`);
      if (source.pages) parts.push(`pp. ${source.pages},`);
    }

    // Datum
    if (source.date) {
      const d = new Date(source.date);
      parts.push(
        `${d.toLocaleString("en", { month: "short" })}. ${d.getFullYear()}.`
      );
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  /**
   * Vancouver formatering
   */
  private formatVancouver(source: Source): string {
    const index = this.citationOrder.indexOf(source.id || "") + 1;
    const parts: string[] = [`${index}.`];

    // Författare
    if (source.authors && source.authors.length > 0) {
      parts.push(this.formatAuthorsVancouver(source.authors) + ".");
    }

    // Titel
    parts.push(source.title + ".");

    // Källa
    if (source.journal) {
      parts.push(`${source.journal}.`);
      if (source.date) {
        const year = new Date(source.date).getFullYear();
        parts.push(`${year};`);
      }
      if (source.volume) parts.push(source.volume);
      if (source.issue) parts.push(`(${source.issue})`);
      if (source.pages) parts.push(`:${source.pages}`);
      parts.push(".");
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  /**
   * Generera referenslista
   */
  generateReferenceList(style: CitationStyle = "apa"): string {
    const refs = this.citationOrder.map((id, index) => {
      const source = this.sources.get(id);
      if (!source) return "";
      return this.formatSource(source, style);
    });

    return refs.filter(Boolean).join("\n\n");
  }

  /**
   * Generera referenslista som HTML
   */
  generateReferenceListHTML(style: CitationStyle = "apa"): string {
    const refs = this.citationOrder.map((id) => {
      const source = this.sources.get(id);
      if (!source) return "";
      const formatted = this.formatSource(source, style);
      return `<li>${formatted}</li>`;
    });

    return `<ol class="reference-list">\n${refs.filter(Boolean).join("\n")}\n</ol>`;
  }

  // Hjälpmetoder för författarformattering
  private formatAuthorsAPA(authors: string[]): string {
    if (authors.length === 1) {
      return this.lastNameFirst(authors[0]);
    } else if (authors.length === 2) {
      return `${this.lastNameFirst(authors[0])} & ${this.lastNameFirst(authors[1])}`;
    } else if (authors.length <= 20) {
      const formatted = authors.map((a) => this.lastNameFirst(a));
      return formatted.slice(0, -1).join(", ") + ", & " + formatted.slice(-1);
    } else {
      const first19 = authors.slice(0, 19).map((a) => this.lastNameFirst(a));
      return first19.join(", ") + ", ... " + this.lastNameFirst(authors.slice(-1)[0]);
    }
  }

  private formatAuthorsHarvard(authors: string[]): string {
    if (authors.length === 1) {
      return this.lastNameFirst(authors[0]);
    } else if (authors.length === 2) {
      return `${this.lastNameFirst(authors[0])} and ${this.lastNameFirst(authors[1])}`;
    } else if (authors.length <= 3) {
      const formatted = authors.map((a) => this.lastNameFirst(a));
      return formatted.slice(0, -1).join(", ") + " and " + formatted.slice(-1);
    } else {
      return `${this.lastNameFirst(authors[0])} et al.`;
    }
  }

  private formatAuthorsIEEE(authors: string[]): string {
    if (authors.length <= 3) {
      return authors.map((a) => this.initialsFirst(a)).join(", ");
    } else {
      return this.initialsFirst(authors[0]) + " et al.";
    }
  }

  private formatAuthorsVancouver(authors: string[]): string {
    if (authors.length <= 6) {
      return authors.map((a) => this.lastNameFirst(a)).join(", ");
    } else {
      const first6 = authors.slice(0, 6).map((a) => this.lastNameFirst(a));
      return first6.join(", ") + ", et al";
    }
  }

  private lastNameFirst(name: string): string {
    const parts = name.trim().split(" ");
    if (parts.length === 1) return name;
    const lastName = parts.pop();
    const initials = parts.map((p) => p[0].toUpperCase() + ".").join(" ");
    return `${lastName}, ${initials}`;
  }

  private initialsFirst(name: string): string {
    const parts = name.trim().split(" ");
    if (parts.length === 1) return name;
    const lastName = parts.pop();
    const initials = parts.map((p) => p[0].toUpperCase() + ".").join(" ");
    return `${initials} ${lastName}`;
  }

  private generateId(source: Source): string {
    const author =
      source.authors?.[0]?.split(" ").pop() ||
      source.organization?.split(" ")[0] ||
      "unknown";
    const year = source.date
      ? new Date(source.date).getFullYear()
      : new Date().getFullYear();
    return `${author.toLowerCase()}${year}`;
  }

  /**
   * Rensa alla källor
   */
  clear(): void {
    this.sources.clear();
    this.citationOrder = [];
  }

  /**
   * Hämta alla källor
   */
  getSources(): Source[] {
    return Array.from(this.sources.values());
  }
}

/**
 * URL-hantering och validering
 */
export class URLHandler {
  /**
   * Normalisera URL
   */
  static normalize(url: string): string {
    if (!url) return "";

    try {
      const parsed = new URL(
        url.startsWith("http") ? url : `https://${url}`
      );

      // Ta bort trailing slash
      let normalized = parsed.href.replace(/\/$/, "");

      // Ta bort www om det finns
      normalized = normalized.replace("://www.", "://");

      return normalized;
    } catch {
      return url;
    }
  }

  /**
   * Extrahera domän
   */
  static getDomain(url: string): string {
    try {
      const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
      return parsed.hostname.replace("www.", "");
    } catch {
      return url;
    }
  }

  /**
   * Validera URL-format
   */
  static isValid(url: string): boolean {
    try {
      new URL(url.startsWith("http") ? url : `https://${url}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kontrollera om URL är live
   */
  static async isLive(url: string, timeout: number = 5000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Batch-validera URLs
   */
  static async validateBatch(
    urls: string[]
  ): Promise<Array<{ url: string; valid: boolean }>> {
    const results = await Promise.allSettled(
      urls.map((url) => this.isLive(url).then((live) => ({ url, live })))
    );

    return results.map((r, i) => ({
      url: urls[i],
      valid: r.status === "fulfilled" && r.value.live,
    }));
  }

  /**
   * Arkivera URL via Wayback Machine
   */
  static async archive(url: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://web.archive.org/save/${encodeURIComponent(url)}`,
        { method: "GET" }
      );

      if (response.ok) {
        return `https://web.archive.org/web/${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}/${url}`;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Automatisk länkformattering i text
 */
export function autoLinkText(
  text: string,
  options: {
    target?: string;
    rel?: string;
    className?: string;
  } = {}
): string {
  const {
    target = "_blank",
    rel = "noopener noreferrer",
    className = "auto-link",
  } = options;

  // URL-regex
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

  return text.replace(urlRegex, (url) => {
    const normalized = URLHandler.normalize(url);
    const domain = URLHandler.getDomain(url);
    return `<a href="${normalized}" target="${target}" rel="${rel}" class="${className}" title="${domain}">${domain}</a>`;
  });
}

export default { CitationManager, URLHandler, autoLinkText };
