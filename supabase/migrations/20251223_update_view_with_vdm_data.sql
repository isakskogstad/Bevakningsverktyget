-- Migration: Add VDM data to loop_companies_with_management view
-- Date: 2025-12-23
-- Description: Extends the company view to include data from company_details (VDM API data)

-- Drop existing view to recreate it
DROP VIEW IF EXISTS loop_companies_with_management;

-- Recreate view with VDM data from company_details
CREATE OR REPLACE VIEW loop_companies_with_management AS
SELECT
    lt.id,
    lt.orgnr,
    lt.company_name,
    lt.sector,
    lt.city,
    lt.foundation_date,
    lt.turnover_2024_sek,
    lt.ebit_2024_sek,
    lt.investment_status,
    lt.total_funding_sek,
    lt.latest_valuation_sek,
    lt.largest_owners,

    -- VDM data from company_details (Bolagsverket API)
    cd.status AS company_status,
    cd.company_type,
    cd.registered_date,
    cd.postal_street,
    cd.postal_code,
    cd.postal_city,
    cd.num_employees AS vdm_num_employees,
    cd.website AS vdm_website,
    cd.phone,
    cd.email,
    cd.purpose AS company_purpose,
    cd.last_synced_at AS vdm_synced_at,

    -- Management data (from existing roles table)
    ceo.name AS ceo_name,
    chairman.name AS chairman_name,
    COALESCE(board_count.cnt, 0) AS board_count,

    -- Logo from loop_table
    logo.logo_url,

    -- Calculated num_employees (prefer VDM, fallback to other sources)
    COALESCE(cd.num_employees, fin.num_employees) AS num_employees,

    -- Website (prefer loop_table, fallback to VDM)
    COALESCE(lt.ceo_contact, cd.website) AS website

FROM loop_table lt

-- Join company_details for VDM data
LEFT JOIN company_details cd ON lt.orgnr = cd.orgnr

-- VD (CEO)
LEFT JOIN LATERAL (
    SELECT name
    FROM roles
    WHERE company_orgnr = lt.orgnr
      AND role_category = 'MANAGEMENT'
      AND (role_type ILIKE '%VD%' OR role_type ILIKE '%Verkställande%')
      AND to_date IS NULL
    ORDER BY from_date DESC
    LIMIT 1
) ceo ON true

-- Ordförande (Chairman)
LEFT JOIN LATERAL (
    SELECT name
    FROM roles
    WHERE company_orgnr = lt.orgnr
      AND role_category = 'BOARD'
      AND role_type ILIKE '%ordförande%'
      AND to_date IS NULL
    ORDER BY from_date DESC
    LIMIT 1
) chairman ON true

-- Antal styrelsemedlemmar
LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM roles
    WHERE company_orgnr = lt.orgnr
      AND role_category = 'BOARD'
      AND to_date IS NULL
) board_count ON true

-- Logo from companies table if it exists
LEFT JOIN LATERAL (
    SELECT logo_url
    FROM companies
    WHERE orgnr = lt.orgnr
    LIMIT 1
) logo ON true

-- Latest financial data for num_employees fallback
LEFT JOIN LATERAL (
    SELECT num_employees
    FROM financials
    WHERE company_orgnr = lt.orgnr
    ORDER BY period_year DESC
    LIMIT 1
) fin ON true;

-- Grant access to the view
GRANT SELECT ON loop_companies_with_management TO anon, authenticated;

-- Add comment
COMMENT ON VIEW loop_companies_with_management IS 'Combined view of Loop Impact companies with management roles and Bolagsverket VDM data';
