#!/usr/bin/env node
/**
 * Test script for Allabolag scraper (Node.js)
 *
 * Usage:
 *   node test-allabolag.js
 */

const { scrapeCompany } = require('./allabolag-scraper');

/**
 * Test basic scraping
 */
async function testBasicScraping() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: Basic scraping');
  console.log('='.repeat(80));

  // Test with Spotify's Swedish branch
  const orgnr = '5567676827';

  console.log(`\nScraping ${orgnr}...`);

  try {
    const data = await scrapeCompany(orgnr);

    if (!data) {
      console.log('\n✗ Failed to scrape data');
      return false;
    }

    console.log(`\n✓ Successfully scraped ${data.name}`);
    console.log(`  - Organization number: ${data.orgnr}`);
    console.log(`  - Company type: ${data.company_type || 'N/A'}`);
    console.log(`  - Status: ${data.status || 'N/A'}`);
    console.log(`  - Postal address: ${data.postal_street || 'N/A'}, ${data.postal_city || 'N/A'}`);
    console.log(`  - Phone: ${data.phone || 'N/A'}`);
    console.log(`  - Website: ${data.website || 'N/A'}`);

    console.log('\nRegistrations:');
    console.log(`  - F-skatt: ${data.f_skatt ? 'Yes' : 'No'}`);
    console.log(`  - VAT registered: ${data.moms_registered ? 'Yes' : 'No'}`);
    console.log(`  - Employer registered: ${data.employer_registered ? 'Yes' : 'No'}`);

    if (data.roles && data.roles.length > 0) {
      console.log(`\nRoles (${data.roles.length}):`);
      data.roles.slice(0, 5).forEach(role => {
        console.log(`  - ${role.name} (${role.birth_year || 'N/A'}): ${role.role_type} [${role.role_category}]`);
      });
      if (data.roles.length > 5) {
        console.log(`  ... and ${data.roles.length - 5} more`);
      }
    }

    if (data.financials && data.financials.length > 0) {
      console.log(`\nFinancials (${data.financials.length} periods):`);
      data.financials.slice(0, 3).forEach(fin => {
        const consolidated = fin.is_consolidated ? ' (Consolidated)' : '';
        console.log(`  - ${fin.period_year}${consolidated}:`);
        if (fin.revenue) {
          console.log(`    Revenue: ${fin.revenue.toLocaleString()} SEK`);
        }
        if (fin.net_profit) {
          console.log(`    Net profit: ${fin.net_profit.toLocaleString()} SEK`);
        }
        if (fin.num_employees) {
          console.log(`    Employees: ${fin.num_employees}`);
        }
      });
    }

    if (data.related_companies && data.related_companies.length > 0) {
      console.log(`\nRelated companies (${data.related_companies.length}):`);
      data.related_companies.slice(0, 5).forEach(rel => {
        console.log(`  - ${rel.related_name} (${rel.related_orgnr}) - ${rel.relation_type}`);
      });
    }

    if (data.industries && data.industries.length > 0) {
      console.log('\nIndustries:');
      data.industries.forEach(ind => {
        const primary = ind.is_primary ? ' (Primary)' : '';
        console.log(`  - ${ind.sni_code}: ${ind.sni_description || 'N/A'}${primary}`);
      });
    }

    if (data.announcements && data.announcements.length > 0) {
      console.log(`\nAnnouncements (${data.announcements.length}):`);
      data.announcements.slice(0, 3).forEach(ann => {
        console.log(`  - ${ann.announcement_date}: ${ann.announcement_type || 'N/A'}`);
      });
    }

    return true;
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    return false;
  }
}

/**
 * Test custom delay
 */
async function testCustomDelay() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: Custom delay');
  console.log('='.repeat(80));

  const orgnr = '5567676827';

  console.log(`\nScraping ${orgnr} with 2 second delay...`);

  try {
    const startTime = Date.now();
    const data = await scrapeCompany(orgnr, { delay: 2000 });
    const duration = Date.now() - startTime;

    if (!data) {
      console.log('\n✗ Failed to scrape data');
      return false;
    }

    console.log(`\n✓ Successfully scraped ${data.name}`);
    console.log(`  - Duration: ${duration}ms`);
    console.log(`  - Delay respected: ${duration >= 2000 ? 'Yes' : 'No'}`);

    return true;
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    return false;
  }
}

/**
 * Test error handling
 */
async function testErrorHandling() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Error handling');
  console.log('='.repeat(80));

  const invalidOrgnr = '0000000000';

  console.log(`\nTrying to scrape invalid orgnr: ${invalidOrgnr}...`);

  try {
    const data = await scrapeCompany(invalidOrgnr, { delay: 500 });

    if (data === null) {
      console.log('✓ Correctly returned null for invalid orgnr');
      return true;
    } else {
      console.log('✗ Should have returned null for invalid orgnr');
      return false;
    }
  } catch (error) {
    console.error('\n✗ Unexpected error:', error.message);
    return false;
  }
}

/**
 * Test data structure validation
 */
async function testDataStructure() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 4: Data structure validation');
  console.log('='.repeat(80));

  const orgnr = '5567676827';

  console.log(`\nValidating data structure for ${orgnr}...`);

  try {
    const data = await scrapeCompany(orgnr);

    if (!data) {
      console.log('\n✗ Failed to scrape data');
      return false;
    }

    // Required fields
    const requiredFields = ['orgnr', 'name', 'source_basic'];
    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
      console.log(`✗ Missing required fields: ${missingFields.join(', ')}`);
      return false;
    }

    // Array fields
    const arrayFields = ['roles', 'financials', 'industries', 'announcements', 'related_companies'];
    const invalidArrays = arrayFields.filter(field => data[field] && !Array.isArray(data[field]));

    if (invalidArrays.length > 0) {
      console.log(`✗ Fields should be arrays: ${invalidArrays.join(', ')}`);
      return false;
    }

    // Role structure
    if (data.roles && data.roles.length > 0) {
      const role = data.roles[0];
      const roleFields = ['name', 'role_type', 'role_category', 'source'];
      const missingRoleFields = roleFields.filter(field => !role[field]);

      if (missingRoleFields.length > 0) {
        console.log(`✗ Role missing fields: ${missingRoleFields.join(', ')}`);
        return false;
      }

      // Validate role_category
      const validCategories = ['BOARD', 'MANAGEMENT', 'AUDITOR', 'OTHER'];
      if (!validCategories.includes(role.role_category)) {
        console.log(`✗ Invalid role_category: ${role.role_category}`);
        return false;
      }
    }

    // Financial structure
    if (data.financials && data.financials.length > 0) {
      const fin = data.financials[0];
      const finFields = ['period_year', 'period_months', 'is_consolidated', 'source'];
      const missingFinFields = finFields.filter(field => fin[field] === undefined);

      if (missingFinFields.length > 0) {
        console.log(`✗ Financial missing fields: ${missingFinFields.join(', ')}`);
        return false;
      }

      // Validate is_consolidated
      if (fin.is_consolidated !== 0 && fin.is_consolidated !== 1) {
        console.log(`✗ Invalid is_consolidated: ${fin.is_consolidated}`);
        return false;
      }
    }

    console.log('✓ Data structure is valid');
    console.log(`  - All required fields present`);
    console.log(`  - Array fields are arrays`);
    console.log(`  - Role structure valid`);
    console.log(`  - Financial structure valid`);

    return true;
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    return false;
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('ALLABOLAG SCRAPER TEST SUITE (Node.js)');
  console.log('='.repeat(80));

  const results = {
    basicScraping: await testBasicScraping(),
    customDelay: await testCustomDelay(),
    errorHandling: await testErrorHandling(),
    dataStructure: await testDataStructure()
  };

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));

  const passed = Object.values(results).filter(r => r === true).length;
  const failed = Object.values(results).filter(r => r === false).length;

  for (const [test, result] of Object.entries(results)) {
    const status = result ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${test}`);
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
