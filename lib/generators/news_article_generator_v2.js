/**
 * NEWS ARTICLE GENERATOR V2
 * =========================
 *
 * Intelligent artikelgenerator som dynamiskt hämtar och analyserar
 * data från ALLA tillgängliga källor för att generera högkvalitativa
 * nyhetsartiklar om svenska företag.
 *
 * DATAKÄLLOR:
 * -----------
 * 1. Supabase-tabeller (40+ tabeller)
 *    - companies, roles, financials, announcements
 *    - poit_announcements, loop_table, investors
 *    - company_pressrooms, xbrl_facts, annual_reports
 *    - trademarks, company_registry
 *
 * 2. Externa API:er & Scrapers
 *    - Allabolag.se (styrelse, ekonomi, bolagsstruktur)
 *    - POIT (kungörelser)
 *    - Bolagsverket (protokoll, ägarinfo)
 *    - LinkedIn (profiler, foton)
 *    - Pressrum (pressbilder, RSS)
 *
 * 3. Edge Functions
 *    - generate-article (Claude AI)
 *    - parse-pdf (PDF-analys)
 *    - scrape-press-images (pressbilder)
 *    - poit-kungorelse (kungörelsedetaljer)
 *
 * ARTIKELTYPER:
 * -------------
 * - nyemission, vd_byte, arsredovisning, konkurs, forvärv
 * - styrelseändring, ägarförändring, fusion, likvidation
 * - milestone, funding_round, expansion, produkt_lansering
 * - pressmeddelande, årsrapport_analys, branschanalys
 *
 * ANVÄNDNING:
 * -----------
 * const generator = new NewsArticleGeneratorV2(supabaseClient);
 * const article = await generator.generateArticle('5567676827', {
 *   type: 'auto',  // Auto-detect best article type
 *   tone: 'neutral',
 *   includeImages: true,
 *   includeFactbox: true
 * });
 *
 * @author Impact Loop
 * @version 2.0.0
 * @created 2025-12-19
 */

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { chromium } = require('playwright');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514'
  },
  allabolag: {
    baseUrl: 'https://www.allabolag.se',
    delay: 1000
  },
  rateLimit: {
    articlesPerHour: 20,
    requestsPerMinute: 30
  }
};

// =============================================================================
// ARTICLE TYPE DEFINITIONS
// =============================================================================

const ARTICLE_TYPES = {
  // --- Befintliga typer (utökade) ---
  nyemission: {
    label: 'Nyemission',
    priority: 1,
    requiredData: ['company', 'financials'],
    optionalData: ['roles', 'investors', 'pressroom'],
    detectPattern: (data) =>
      data.announcements?.some(a => a.type?.includes('emission')) ||
      data.poit?.some(p => p.category === 'NYEMISSION'),
    promptTemplate: `Skriv en nyhetsartikel om att {company_name} genomfört en nyemission.

KONTEXT:
{context}

INSTRUKTIONER:
- Fokusera på emissionens storlek och villkor
- Analysera bolagets finansiella situation
- Sätt in i branschkontext
- Spekulera på vad kapitalet ska användas till`
  },

  vd_byte: {
    label: 'VD-byte',
    priority: 1,
    requiredData: ['company', 'roles'],
    optionalData: ['linkedin', 'pressroom', 'financials'],
    detectPattern: (data) =>
      data.poit?.some(p => p.category === 'VD_BYTE') ||
      data.roles?.some(r => r.role_type === 'VD' && r.is_new),
    promptTemplate: `Skriv en nyhetsartikel om VD-byte på {company_name}.

NY VD:
{new_ceo}

TIDIGARE VD:
{previous_ceo}

FÖRETAGSKONTEXT:
{context}

INSTRUKTIONER:
- Presentera den nya VD:n med bakgrund
- Analysera vad bytet kan betyda för bolaget
- Inkludera kommentarer om detta är en offensiv eller defensiv förändring`
  },

  arsredovisning: {
    label: 'Årsredovisning',
    priority: 2,
    requiredData: ['company', 'financials', 'xbrl'],
    optionalData: ['roles', 'annual_reports', 'trademarks'],
    detectPattern: (data) =>
      data.xbrl?.length > 0 || data.annual_reports?.length > 0,
    promptTemplate: `Analysera {company_name}s senaste årsredovisning och skriv en nyhetsartikel.

NYCKELTAL:
{financials}

XBRL-DATA:
{xbrl_summary}

VD-KOMMENTAR (om tillgänglig):
{ceo_comment}

INSTRUKTIONER:
- Lyft fram de viktigaste förändringarna jämfört med föregående år
- Analysera trender och vad de kan betyda
- Inkludera branschkontext`
  },

  konkurs: {
    label: 'Konkurs/Rekonstruktion',
    priority: 1,
    requiredData: ['company', 'poit'],
    optionalData: ['financials', 'roles', 'investors'],
    detectPattern: (data) =>
      data.poit?.some(p =>
        p.category === 'KONKURSBESLUT' ||
        p.category === 'KONKURSANSÖKAN' ||
        p.category === 'FÖRETAGSREKONSTRUKTION'
      ),
    promptTemplate: `Skriv en saklig nyhetsartikel om {company_name} som försatts i konkurs/rekonstruktion.

KUNGÖRELSE:
{poit_details}

BOLAGSHISTORIK:
{context}

FINANSIELL UTVECKLING:
{financials}

INSTRUKTIONER:
- Var respektfull och undvik spekulationer
- Fokusera på fakta och konsekvenser
- Inkludera antal anställda och påverkan`
  },

  // --- NYA ARTIKELTYPER ---

  styrelseändring: {
    label: 'Styrelseförändring',
    priority: 2,
    requiredData: ['company', 'roles'],
    optionalData: ['linkedin', 'poit', 'financials'],
    detectPattern: (data) =>
      data.poit?.some(p => p.category === 'STYRELSEÄNDRING') ||
      data.roles?.some(r => r.role_category === 'BOARD' && r.is_new),
    promptTemplate: `Skriv en nyhetsartikel om styrelseförändringar i {company_name}.

FÖRÄNDRINGAR:
{board_changes}

NUVARANDE STYRELSE:
{current_board}

FÖRETAGSKONTEXT:
{context}

INSTRUKTIONER:
- Presentera nya ledamöter med bakgrund
- Analysera vad förändringarna kan betyda strategiskt
- Lyft fram relevant erfarenhet hos nya ledamöter`
  },

  ägarförändring: {
    label: 'Ägarförändring',
    priority: 1,
    requiredData: ['company', 'poit'],
    optionalData: ['investors', 'financials', 'roles'],
    detectPattern: (data) =>
      data.poit?.some(p => p.category === 'ÄGARFÖRÄNDRING') ||
      data.loop_table?.latest_funding_date,
    promptTemplate: `Skriv en nyhetsartikel om ägarförändringar i {company_name}.

ÄGARSTRUKTUR:
{ownership}

INVESTERARE:
{investors}

KONTEXT:
{context}

INSTRUKTIONER:
- Analysera vad ägarförändringen kan betyda
- Lyft fram nya ägares bakgrund och portfölj
- Spekulera på framtida strategi`
  },

  fusion: {
    label: 'Fusion/Sammanslagning',
    priority: 1,
    requiredData: ['company', 'poit'],
    optionalData: ['related_companies', 'financials', 'roles'],
    detectPattern: (data) =>
      data.poit?.some(p => p.category === 'FUSION'),
    promptTemplate: `Skriv en nyhetsartikel om fusionen som involverar {company_name}.

FUSIONSDETALJER:
{fusion_details}

BERÖRDA BOLAG:
{related_companies}

KONTEXT:
{context}

INSTRUKTIONER:
- Förklara fusionens struktur och motiv
- Analysera strategiska implikationer
- Inkludera branschkontext`
  },

  likvidation: {
    label: 'Likvidation',
    priority: 2,
    requiredData: ['company', 'poit'],
    optionalData: ['financials', 'roles'],
    detectPattern: (data) =>
      data.poit?.some(p => p.category === 'LIKVIDATION'),
    promptTemplate: `Skriv en nyhetsartikel om {company_name} som trätt i likvidation.

KUNGÖRELSE:
{poit_details}

BOLAGSHISTORIK:
{context}

INSTRUKTIONER:
- Var saklig och respektfull
- Förklara vad likvidation innebär
- Inkludera bolagets historik`
  },

  funding_round: {
    label: 'Finansieringsrunda',
    priority: 1,
    requiredData: ['company', 'loop_table'],
    optionalData: ['investors', 'roles', 'pressroom'],
    detectPattern: (data) =>
      data.loop_table?.latest_funding_round_sek > 0 &&
      isRecentDate(data.loop_table?.latest_funding_date, 90),
    promptTemplate: `Skriv en nyhetsartikel om {company_name}s senaste finansieringsrunda.

FINANSIERING:
- Belopp: {funding_amount}
- Datum: {funding_date}
- Total funding: {total_funding}
- Värdering: {valuation}

INVESTERARE:
{investors}

FÖRETAGSKONTEXT:
{context}

INSTRUKTIONER:
- Analysera vad kapitalet ska användas till
- Lyft fram investerarnas bakgrund
- Sätt in i startup-ekosystemet`
  },

  milestone: {
    label: 'Företagsmilstolpe',
    priority: 3,
    requiredData: ['company', 'financials'],
    optionalData: ['pressroom', 'trademarks', 'roles'],
    detectPattern: (data) =>
      detectMilestone(data),
    promptTemplate: `Skriv en nyhetsartikel om milstolpen för {company_name}.

MILSTOLPE:
{milestone_description}

FÖRETAGSHISTORIK:
{context}

INSTRUKTIONER:
- Fira framgången på ett balanserat sätt
- Sätt in i historisk kontext
- Analysera vad det betyder för framtiden`
  },

  pressmeddelande: {
    label: 'Pressmeddelande',
    priority: 2,
    requiredData: ['company', 'pressroom'],
    optionalData: ['roles', 'financials'],
    detectPattern: (data) =>
      data.pressroom?.latest_press_release &&
      isRecentDate(data.pressroom.latest_press_release.date, 7),
    promptTemplate: `Omarbeta detta pressmeddelande till en nyhetsartikel om {company_name}.

ORIGINAL:
{press_release}

FÖRETAGSKONTEXT:
{context}

INSTRUKTIONER:
- Omformulera till nyhetsspråk
- Lägg till kritisk analys
- Inkludera faktaruta`
  },

  branschanalys: {
    label: 'Branschanalys',
    priority: 4,
    requiredData: ['company', 'financials'],
    optionalData: ['competitors', 'xbrl', 'trademarks'],
    detectPattern: () => false, // Triggras manuellt
    promptTemplate: `Skriv en branschanalys med fokus på {company_name}.

FÖRETAGSDATA:
{context}

BRANSCH:
{industry}

KONKURRENTER (om kända):
{competitors}

INSTRUKTIONER:
- Analysera bolagets position i branschen
- Jämför nyckeltal med branschsnitt
- Diskutera trender och framtidsutsikter`
  },

  // Auto-detect baserad på tillgänglig data
  auto: {
    label: 'Automatisk',
    priority: 0,
    requiredData: ['company'],
    optionalData: ['*'],
    detectPattern: () => true,
    promptTemplate: null // Väljs dynamiskt
  }
};

// =============================================================================
// TONE DEFINITIONS
// =============================================================================

const TONES = {
  neutral: {
    label: 'Neutral',
    instruction: 'Skriv i en neutral, objektiv journalistisk ton. Presentera fakta utan att ta ställning.'
  },
  avslojar: {
    label: 'Avslöjande',
    instruction: 'Skriv i en avslöjande, undersökande ton. Använd fraser som "Impact Loop avslöjar" eller "kan Impact Loop nu avslöja". Lyft fram nyhetsvinkel och exklusivitet.'
  },
  positiv: {
    label: 'Positiv',
    instruction: 'Skriv i en positiv men balanserad ton. Lyft fram framgångar utan att överdriva.'
  },
  analytisk: {
    label: 'Analytisk',
    instruction: 'Skriv i en analytisk ton med fokus på siffror, trender och marknadsperspektiv. Använd data för att stödja resonemang.'
  },
  kritisk: {
    label: 'Kritisk/Granskande',
    instruction: 'Skriv i en kritisk, granskande ton. Ställ frågor, lyft fram risker och potentiella problem.'
  }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isRecentDate(dateStr, daysBack = 30) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = (now - date) / (1000 * 60 * 60 * 24);
  return diffDays <= daysBack;
}

function detectMilestone(data) {
  const financials = data.financials || [];
  if (financials.length < 2) return false;

  const latest = financials[0];
  const previous = financials[1];

  // Tillväxt > 50%
  if (latest.revenue && previous.revenue) {
    const growth = (latest.revenue - previous.revenue) / previous.revenue;
    if (growth > 0.5) return true;
  }

  // Först lönsamt
  if (latest.net_profit > 0 && previous.net_profit <= 0) return true;

  // Omsättning över 100 MSEK första gången
  if (latest.revenue > 100000000 && (!previous.revenue || previous.revenue < 100000000)) return true;

  return false;
}

function formatSEK(value) {
  if (value === null || value === undefined) return 'N/A';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} mdkr`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mkr`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)} tkr`;
  return `${value.toFixed(0)} kr`;
}

function normalizeOrgnr(orgnr) {
  return orgnr.replace(/[^0-9]/g, '');
}

// =============================================================================
// DATA AGGREGATOR CLASS
// =============================================================================

/**
 * DataAggregator samlar data från alla tillgängliga källor
 */
class DataAggregator {
  constructor(supabase) {
    this.supabase = supabase;
    this.cache = new Map();
  }

  /**
   * Hämtar ALL tillgänglig data för ett företag
   */
  async aggregateCompanyData(orgnr) {
    const cleanOrgnr = normalizeOrgnr(orgnr);

    // Parallellt hämta från alla källor
    const [
      company,
      loopData,
      roles,
      financials,
      announcements,
      poitAnnouncements,
      pressroom,
      xbrlFacts,
      annualReports,
      trademarks,
      investors
    ] = await Promise.all([
      this.fetchCompany(cleanOrgnr),
      this.fetchLoopTable(cleanOrgnr),
      this.fetchRoles(cleanOrgnr),
      this.fetchFinancials(cleanOrgnr),
      this.fetchAnnouncements(cleanOrgnr),
      this.fetchPoitAnnouncements(cleanOrgnr),
      this.fetchPressroom(cleanOrgnr),
      this.fetchXbrlFacts(cleanOrgnr),
      this.fetchAnnualReports(cleanOrgnr),
      this.fetchTrademarks(cleanOrgnr),
      this.fetchInvestors()
    ]);

    // Kombinera och berika data
    const aggregated = {
      orgnr: cleanOrgnr,
      company: company || loopData,
      loop_table: loopData,
      roles: roles || [],
      financials: financials || [],
      announcements: announcements || [],
      poit: poitAnnouncements || [],
      pressroom,
      xbrl: xbrlFacts || [],
      annual_reports: annualReports || [],
      trademarks: trademarks || [],
      investors: investors || [],
      metadata: {
        aggregatedAt: new Date().toISOString(),
        sources: []
      }
    };

    // Logga källor
    if (company) aggregated.metadata.sources.push('companies');
    if (loopData) aggregated.metadata.sources.push('loop_table');
    if (roles?.length) aggregated.metadata.sources.push('roles');
    if (financials?.length) aggregated.metadata.sources.push('financials');
    if (announcements?.length) aggregated.metadata.sources.push('announcements');
    if (poitAnnouncements?.length) aggregated.metadata.sources.push('poit_announcements');
    if (pressroom) aggregated.metadata.sources.push('company_pressrooms');
    if (xbrlFacts?.length) aggregated.metadata.sources.push('xbrl_facts');
    if (annualReports?.length) aggregated.metadata.sources.push('annual_reports');
    if (trademarks?.length) aggregated.metadata.sources.push('trademarks');

    return aggregated;
  }

  async fetchCompany(orgnr) {
    try {
      const { data } = await this.supabase
        .from('companies')
        .select('*')
        .eq('orgnr', orgnr)
        .single();
      return data;
    } catch {
      // Försök med formaterat orgnr
      const formatted = `${orgnr.slice(0, 6)}-${orgnr.slice(6)}`;
      const { data } = await this.supabase
        .from('companies')
        .select('*')
        .eq('orgnr', formatted)
        .single();
      return data;
    }
  }

  async fetchLoopTable(orgnr) {
    const { data } = await this.supabase
      .from('loop_table')
      .select('*')
      .or(`orgnr.eq.${orgnr},orgnr.eq.${orgnr.slice(0, 6)}-${orgnr.slice(6)}`)
      .single();
    return data;
  }

  async fetchRoles(orgnr) {
    const { data } = await this.supabase
      .from('roles')
      .select('*')
      .eq('company_orgnr', orgnr)
      .order('role_category', { ascending: true });
    return data;
  }

  async fetchFinancials(orgnr) {
    const { data } = await this.supabase
      .from('financials')
      .select('*')
      .eq('orgnr', orgnr)
      .order('year', { ascending: false })
      .limit(5);
    return data;
  }

  async fetchAnnouncements(orgnr) {
    const { data } = await this.supabase
      .from('announcements')
      .select('*')
      .eq('orgnr', orgnr)
      .order('date', { ascending: false })
      .limit(20);
    return data;
  }

  async fetchPoitAnnouncements(orgnr) {
    const { data } = await this.supabase
      .from('poit_announcements')
      .select('*')
      .eq('orgnr', orgnr)
      .order('published_at', { ascending: false })
      .limit(20);
    return data;
  }

  async fetchPressroom(orgnr) {
    const { data } = await this.supabase
      .from('company_pressrooms')
      .select('*')
      .eq('orgnr', orgnr)
      .single();
    return data;
  }

  async fetchXbrlFacts(orgnr) {
    const { data } = await this.supabase
      .from('xbrl_facts')
      .select('*')
      .eq('orgnr', orgnr)
      .order('period_end', { ascending: false })
      .limit(100);
    return data;
  }

  async fetchAnnualReports(orgnr) {
    const { data } = await this.supabase
      .from('annual_reports')
      .select('*')
      .eq('orgnr', orgnr)
      .order('year', { ascending: false })
      .limit(3);
    return data;
  }

  async fetchTrademarks(orgnr) {
    const { data } = await this.supabase
      .from('trademarks')
      .select('*')
      .eq('orgnr', orgnr);
    return data;
  }

  async fetchInvestors() {
    const { data } = await this.supabase
      .from('investors')
      .select('*');
    return data;
  }
}

// =============================================================================
// ARTICLE TYPE DETECTOR
// =============================================================================

class ArticleTypeDetector {
  /**
   * Analyserar data och föreslår bästa artikeltyp(er)
   */
  static detectBestTypes(aggregatedData) {
    const suggestions = [];

    for (const [type, config] of Object.entries(ARTICLE_TYPES)) {
      if (type === 'auto') continue;

      // Kolla om vi har required data
      const hasRequiredData = config.requiredData.every(field =>
        this.hasData(aggregatedData, field)
      );

      if (!hasRequiredData) continue;

      // Kolla detect pattern
      const patternMatch = config.detectPattern(aggregatedData);

      if (patternMatch) {
        suggestions.push({
          type,
          label: config.label,
          priority: config.priority,
          confidence: patternMatch === true ? 0.8 : patternMatch,
          reason: this.getDetectionReason(type, aggregatedData)
        });
      }
    }

    // Sortera efter prioritet och confidence
    return suggestions.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.confidence - a.confidence;
    });
  }

  static hasData(data, field) {
    switch (field) {
      case 'company':
        return data.company || data.loop_table;
      case 'roles':
        return data.roles?.length > 0;
      case 'financials':
        return data.financials?.length > 0;
      case 'poit':
        return data.poit?.length > 0;
      case 'xbrl':
        return data.xbrl?.length > 0;
      case 'pressroom':
        return data.pressroom != null;
      case 'loop_table':
        return data.loop_table != null;
      case 'investors':
        return data.investors?.length > 0;
      case 'trademarks':
        return data.trademarks?.length > 0;
      case 'annual_reports':
        return data.annual_reports?.length > 0;
      default:
        return data[field] != null;
    }
  }

  static getDetectionReason(type, data) {
    switch (type) {
      case 'konkurs':
        return `Kungörelse: ${data.poit[0]?.category}`;
      case 'vd_byte':
        return 'VD-förändring detekterad';
      case 'nyemission':
        return 'Nyemission detekterad';
      case 'funding_round':
        return `Senaste runda: ${formatSEK(data.loop_table?.latest_funding_round_sek)}`;
      case 'arsredovisning':
        return `${data.xbrl?.length || data.annual_reports?.length} XBRL/årsredovisningar`;
      default:
        return 'Data tillgänglig';
    }
  }
}

// =============================================================================
// CONTEXT BUILDER
// =============================================================================

class ContextBuilder {
  /**
   * Bygger kontextsträng för AI-prompten baserat på aggregerad data
   */
  static buildContext(data, articleType) {
    const parts = [];

    // Företagsinfo
    const company = data.company || data.loop_table || {};
    parts.push('## FÖRETAGSINFORMATION');
    parts.push(`Namn: ${company.company_name || company.name || 'Okänt'}`);
    parts.push(`Organisationsnummer: ${data.orgnr}`);
    if (company.city) parts.push(`Säte: ${company.city}`);
    if (company.sector) parts.push(`Sektor: ${company.sector}`);
    if (company.website) parts.push(`Webb: ${company.website}`);
    if (company.foundation_date) parts.push(`Grundat: ${company.foundation_date}`);

    // Finansiell data
    if (data.financials?.length > 0) {
      parts.push('\n## FINANSIELL DATA');
      data.financials.slice(0, 3).forEach(fin => {
        parts.push(`\n### ${fin.year}`);
        if (fin.revenue) parts.push(`Omsättning: ${formatSEK(fin.revenue)}`);
        if (fin.net_profit !== undefined) parts.push(`Resultat: ${formatSEK(fin.net_profit)}`);
        if (fin.num_employees) parts.push(`Anställda: ${fin.num_employees}`);
        if (fin.equity_ratio) parts.push(`Soliditet: ${fin.equity_ratio}%`);
      });
    }

    // Loop-specifik data (funding, värdering)
    if (data.loop_table) {
      const lt = data.loop_table;
      parts.push('\n## INVESTERINGSDATA');
      if (lt.total_funding_sek) parts.push(`Total funding: ${formatSEK(lt.total_funding_sek)}`);
      if (lt.latest_funding_round_sek) parts.push(`Senaste runda: ${formatSEK(lt.latest_funding_round_sek)}`);
      if (lt.latest_funding_date) parts.push(`Datum: ${lt.latest_funding_date}`);
      if (lt.latest_valuation_sek) parts.push(`Värdering: ${formatSEK(lt.latest_valuation_sek)}`);
      if (lt.largest_owners) parts.push(`Största ägare: ${lt.largest_owners}`);
    }

    // Styrelse och ledning
    if (data.roles?.length > 0) {
      parts.push('\n## STYRELSE & LEDNING');

      const management = data.roles.filter(r => r.role_category === 'MANAGEMENT');
      const board = data.roles.filter(r => r.role_category === 'BOARD');

      if (management.length > 0) {
        parts.push('\n### Ledning');
        management.forEach(r => {
          parts.push(`- ${r.name} (${r.role_type})`);
        });
      }

      if (board.length > 0) {
        parts.push('\n### Styrelse');
        board.slice(0, 5).forEach(r => {
          parts.push(`- ${r.name} (${r.role_type})`);
        });
        if (board.length > 5) parts.push(`+ ${board.length - 5} fler...`);
      }
    }

    // POIT-kungörelser
    if (data.poit?.length > 0) {
      parts.push('\n## KUNGÖRELSER (POIT)');
      data.poit.slice(0, 5).forEach(p => {
        parts.push(`- [${p.published_at?.split('T')[0]}] ${p.category}: ${p.summary || p.title}`);
      });
    }

    // XBRL-data
    if (data.xbrl?.length > 0) {
      parts.push('\n## XBRL-FAKTA');
      const grouped = {};
      data.xbrl.slice(0, 20).forEach(f => {
        if (!grouped[f.concept]) grouped[f.concept] = [];
        grouped[f.concept].push(f);
      });
      Object.entries(grouped).slice(0, 10).forEach(([concept, facts]) => {
        const latest = facts[0];
        parts.push(`- ${concept}: ${latest.value} (${latest.period_end})`);
      });
    }

    // Varumärken
    if (data.trademarks?.length > 0) {
      parts.push('\n## VARUMÄRKEN');
      data.trademarks.slice(0, 5).forEach(tm => {
        parts.push(`- ${tm.name} (${tm.status})`);
      });
    }

    return parts.join('\n');
  }

  /**
   * Bygger specifik kontext för artikeltyp
   */
  static buildTypeSpecificContext(data, articleType) {
    switch (articleType) {
      case 'vd_byte':
        return this.buildCeoChangeContext(data);
      case 'konkurs':
        return this.buildBankruptcyContext(data);
      case 'funding_round':
        return this.buildFundingContext(data);
      case 'arsredovisning':
        return this.buildAnnualReportContext(data);
      default:
        return '';
    }
  }

  static buildCeoChangeContext(data) {
    const vdRoles = data.roles?.filter(r =>
      r.role_type?.includes('VD') || r.role_type?.includes('verkställande')
    ) || [];

    if (vdRoles.length === 0) return '';

    return `
## VD-INFORMATION
Nuvarande VD: ${vdRoles[0]?.name || 'Okänd'}
Roll: ${vdRoles[0]?.role_type || 'VD'}
    `.trim();
  }

  static buildBankruptcyContext(data) {
    const konkurs = data.poit?.find(p =>
      p.category === 'KONKURSBESLUT' || p.category === 'KONKURSANSÖKAN'
    );

    if (!konkurs) return '';

    return `
## KONKURSINFORMATION
Typ: ${konkurs.category}
Datum: ${konkurs.published_at?.split('T')[0]}
Detaljer: ${konkurs.summary || konkurs.title}
${konkurs.administrator ? `Förvaltare: ${konkurs.administrator}` : ''}
    `.trim();
  }

  static buildFundingContext(data) {
    const lt = data.loop_table;
    if (!lt) return '';

    return `
## FINANSIERINGSRUNDA
Belopp: ${formatSEK(lt.latest_funding_round_sek)}
Datum: ${lt.latest_funding_date || 'Okänt'}
Total historisk funding: ${formatSEK(lt.total_funding_sek)}
Värdering: ${formatSEK(lt.latest_valuation_sek)}
Investerare: ${lt.largest_owners || 'Ej angivet'}
    `.trim();
  }

  static buildAnnualReportContext(data) {
    if (!data.xbrl?.length && !data.annual_reports?.length) return '';

    const parts = ['## ÅRSREDOVISNINGSDATA'];

    // Sammanfatta XBRL
    if (data.xbrl?.length > 0) {
      const keyMetrics = ['Nettoomsättning', 'Rörelseresultat', 'Resultat', 'Soliditet'];
      parts.push('\n### Nyckeltal från XBRL');

      data.xbrl
        .filter(f => keyMetrics.some(m => f.concept?.includes(m)))
        .slice(0, 10)
        .forEach(f => {
          parts.push(`- ${f.concept}: ${f.value}`);
        });
    }

    // VD-ord från årsredovisning
    if (data.annual_reports?.[0]?.ceo_comment) {
      parts.push('\n### VD-kommentar');
      parts.push(data.annual_reports[0].ceo_comment.substring(0, 500) + '...');
    }

    return parts.join('\n');
  }
}

// =============================================================================
// IMAGE FETCHER
// =============================================================================

class ImageFetcher {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Hämtar alla tillgängliga bilder för ett företag
   */
  async fetchImages(data) {
    const images = {
      logo: null,
      pressImages: [],
      personPhotos: []
    };

    // 1. Logotyp från Supabase
    if (data.company?.logo_url) {
      images.logo = data.company.logo_url;
    } else if (data.loop_table?.logo_url) {
      images.logo = data.loop_table.logo_url;
    }

    // 2. Personfoton från roles
    if (data.roles) {
      for (const role of data.roles) {
        if (role.photo_url) {
          images.personPhotos.push({
            name: role.name,
            role: role.role_type,
            url: role.photo_url
          });
        }
      }
    }

    // 3. Försök hämta pressbilder om vi har webbplats
    const website = data.company?.website || data.loop_table?.website;
    if (website) {
      try {
        const pressImages = await this.fetchPressImages(website);
        images.pressImages = pressImages;
      } catch (err) {
        console.log('Kunde inte hämta pressbilder:', err.message);
      }
    }

    return images;
  }

  async fetchPressImages(websiteUrl) {
    // Anropa Edge Function
    const { data, error } = await this.supabase.functions.invoke('scrape-press-images', {
      body: {
        websiteUrl,
        maxImages: 5,
        minWidth: 400,
        minHeight: 300
      }
    });

    if (error) throw error;
    return data?.images || [];
  }
}

// =============================================================================
// MAIN GENERATOR CLASS
// =============================================================================

class NewsArticleGeneratorV2 {
  constructor(supabase, options = {}) {
    this.supabase = supabase;
    this.options = options;
    this.aggregator = new DataAggregator(supabase);
    this.imageFetcher = new ImageFetcher(supabase);
  }

  /**
   * Genererar en nyhetsartikel
   *
   * @param {string} orgnr - Organisationsnummer
   * @param {Object} options - Genereringsalternativ
   * @param {string} options.type - Artikeltyp (auto, nyemission, vd_byte, etc.)
   * @param {string} options.tone - Ton (neutral, avslojar, positiv, analytisk, kritisk)
   * @param {boolean} options.includeImages - Inkludera bilder
   * @param {boolean} options.includeFactbox - Inkludera faktaruta
   * @param {string} options.customPrompt - Extra instruktioner
   * @returns {Promise<Object>} Genererad artikel
   */
  async generateArticle(orgnr, options = {}) {
    const {
      type = 'auto',
      tone = 'neutral',
      includeImages = true,
      includeFactbox = true,
      customPrompt = ''
    } = options;

    console.log(`[ArticleGen] Startar generering för ${orgnr}`);

    // 1. Aggregera all data
    console.log('[ArticleGen] Hämtar data från alla källor...');
    const aggregatedData = await this.aggregator.aggregateCompanyData(orgnr);

    if (!aggregatedData.company && !aggregatedData.loop_table) {
      throw new Error(`Företag med orgnr ${orgnr} hittades inte`);
    }

    console.log(`[ArticleGen] Data hämtad från: ${aggregatedData.metadata.sources.join(', ')}`);

    // 2. Detektera artikeltyp om auto
    let selectedType = type;
    let detectedTypes = [];

    if (type === 'auto') {
      detectedTypes = ArticleTypeDetector.detectBestTypes(aggregatedData);
      if (detectedTypes.length > 0) {
        selectedType = detectedTypes[0].type;
        console.log(`[ArticleGen] Auto-detekterad typ: ${selectedType} (${detectedTypes[0].reason})`);
      } else {
        selectedType = 'general';
        console.log('[ArticleGen] Ingen specifik typ detekterad, använder general');
      }
    }

    const articleConfig = ARTICLE_TYPES[selectedType] || ARTICLE_TYPES.general;
    const toneConfig = TONES[tone] || TONES.neutral;

    // 3. Bygg kontext
    console.log('[ArticleGen] Bygger kontext...');
    const generalContext = ContextBuilder.buildContext(aggregatedData, selectedType);
    const typeContext = ContextBuilder.buildTypeSpecificContext(aggregatedData, selectedType);

    // 4. Hämta bilder (parallellt)
    let images = null;
    if (includeImages) {
      console.log('[ArticleGen] Hämtar bilder...');
      images = await this.imageFetcher.fetchImages(aggregatedData);
    }

    // 5. Bygg prompt
    const companyName = aggregatedData.company?.company_name ||
                       aggregatedData.loop_table?.company_name ||
                       'Företaget';

    const prompt = this.buildPrompt({
      articleConfig,
      toneConfig,
      companyName,
      generalContext,
      typeContext,
      customPrompt,
      includeFactbox
    });

    // 6. Generera med Claude
    console.log('[ArticleGen] Genererar artikel med Claude...');
    const generated = await this.callClaude(prompt);

    // 7. Bygg faktaruta
    let factbox = null;
    if (includeFactbox) {
      factbox = this.buildFactbox(aggregatedData);
    }

    // 8. Returnera komplett artikel
    return {
      success: true,
      article: {
        title: generated.title,
        ingress: generated.ingress,
        content: generated.content,
        sections: generated.sections
      },
      company: {
        orgnr,
        name: companyName,
        city: aggregatedData.company?.city || aggregatedData.loop_table?.city,
        sector: aggregatedData.company?.sector || aggregatedData.loop_table?.sector
      },
      factbox,
      images,
      metadata: {
        articleType: selectedType,
        tone,
        detectedTypes,
        dataSources: aggregatedData.metadata.sources,
        generatedAt: new Date().toISOString()
      }
    };
  }

  buildPrompt({ articleConfig, toneConfig, companyName, generalContext, typeContext, customPrompt, includeFactbox }) {
    // Ersätt {company_name} i template
    let template = articleConfig.promptTemplate || ARTICLE_TYPES.general.promptTemplate;
    template = template.replace(/{company_name}/g, companyName);

    // Ersätt kontext-placeholders
    template = template.replace(/{context}/g, generalContext);
    template = template.replace(/{financials}/g, generalContext);
    template = template.replace(/{[a-z_]+}/g, ''); // Rensa bort oanvända placeholders

    return `Du är en erfaren finansjournalist för Impact Loop, en nyhetssajt om svenska startups och investeringar.

${toneConfig.instruction}

${template}

${typeContext ? `\nTYPSPECIFIK KONTEXT:\n${typeContext}` : ''}

${customPrompt ? `\nEXTRA INSTRUKTIONER:\n${customPrompt}` : ''}

FORMATERING:
Returnera artikeln i följande JSON-format:
{
  "title": "Artikelrubrik (max 100 tecken)",
  "ingress": "Ingress som sammanfattar nyheten (2-3 meningar, max 300 tecken)",
  "content": "Brödtext i HTML-format med <p>, <h2>, <strong> taggar. 4-6 stycken.",
  "sections": [
    { "heading": "Underrubrik", "body": "Stycketext i HTML" }
  ]
}

REGLER:
- Skriv på svenska
- Var faktabaserad - använd endast information som finns i kontexten
- Formatera siffror snyggt (mkr, tkr, mdkr)
- Använd <strong> runt personnamn
- Undvik spekulationer utan belägg
- Håll en professionell journalistisk ton`;
  }

  async callClaude(prompt) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.anthropic.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CONFIG.anthropic.model,
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;

    if (!content) {
      throw new Error('Inget innehåll i Claude-svaret');
    }

    // Extrahera JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Kunde inte hitta JSON i Claude-svaret');
    }

    return JSON.parse(jsonMatch[0]);
  }

  buildFactbox(data) {
    const company = data.company || data.loop_table || {};
    const parts = [];

    parts.push(`<strong>${company.company_name || 'Företaget'}</strong>`);
    parts.push(`Orgnr: ${data.orgnr}`);

    if (company.city) parts.push(`Säte: ${company.city}`);
    if (company.foundation_date) {
      const year = company.foundation_date.split('-')[0];
      parts.push(`Grundat: ${year}`);
    }
    if (company.sector) parts.push(`Sektor: ${company.sector}`);

    // Finansiella nyckeltal
    const latest = data.financials?.[0] || data.loop_table;
    if (latest) {
      if (latest.turnover_2024_sek || latest.revenue) {
        parts.push(`Omsättning: ${formatSEK(latest.turnover_2024_sek || latest.revenue)}`);
      }
      if (latest.ebit_2024_sek !== undefined || latest.net_profit !== undefined) {
        parts.push(`Resultat: ${formatSEK(latest.ebit_2024_sek ?? latest.net_profit)}`);
      }
    }

    // Funding
    if (data.loop_table?.total_funding_sek) {
      parts.push(`Total funding: ${formatSEK(data.loop_table.total_funding_sek)}`);
    }
    if (data.loop_table?.latest_valuation_sek) {
      parts.push(`Värdering: ${formatSEK(data.loop_table.latest_valuation_sek)}`);
    }

    // Ägare
    if (company.largest_owners || data.loop_table?.largest_owners) {
      parts.push(`Ägare: ${company.largest_owners || data.loop_table.largest_owners}`);
    }

    return {
      html: parts.join(' <span class="separator">|</span> '),
      items: parts
    };
  }

  /**
   * Listar alla tillgängliga artikeltyper och deras beskrivningar
   */
  static getArticleTypes() {
    return Object.entries(ARTICLE_TYPES).map(([key, config]) => ({
      type: key,
      label: config.label,
      requiredData: config.requiredData,
      optionalData: config.optionalData
    }));
  }

  /**
   * Listar alla tillgängliga toner
   */
  static getTones() {
    return Object.entries(TONES).map(([key, config]) => ({
      tone: key,
      label: config.label,
      description: config.instruction
    }));
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  NewsArticleGeneratorV2,
  DataAggregator,
  ArticleTypeDetector,
  ContextBuilder,
  ImageFetcher,
  ARTICLE_TYPES,
  TONES,
  formatSEK
};
