-- Uppdatera loop_poit_events view för bättre företagsmatchning
-- Problemet: Viewen matchar inte företagsnamn korrekt, speciellt med "(publ)" suffix

-- Ta bort befintlig view
DROP VIEW IF EXISTS loop_poit_events;

-- Skapa förbättrad view som matchar på företagsnamn i content
CREATE VIEW loop_poit_events AS
SELECT
    pa.id,
    pa.title,
    pa.content,
    pa.category,
    pa.announcement_date,
    pa.orgnr,
    pa.extracted_orgnrs,
    pa.created_at,
    lt.company_name AS matched_company_name,
    lt.orgnr AS matched_orgnr,
    lt.sector AS matched_sector
FROM poit_announcements pa
INNER JOIN loop_table lt ON (
    -- Matcha på exakt företagsnamn i content
    pa.content ILIKE '%' || lt.company_name || '%'
    -- ELLER matcha på företagsnamn utan "(publ)" suffix
    OR pa.content ILIKE '%' || REPLACE(REPLACE(lt.company_name, ' (publ)', ''), ' AB', '') || ' AB%'
    -- ELLER matcha på orgnr om det finns
    OR pa.orgnr = lt.orgnr
    OR lt.orgnr = ANY(pa.extracted_orgnrs)
)
ORDER BY pa.announcement_date DESC, pa.created_at DESC;

-- Kommentar
COMMENT ON VIEW loop_poit_events IS 'POIT-händelser filtrerade till endast Loop Impact bevakade företag. Uppdaterad 2025-12-23 med förbättrad namnmatchning.';

-- Ge läsrättigheter
GRANT SELECT ON loop_poit_events TO anon, authenticated;
