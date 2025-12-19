/**
 * Example Usage - How to use API keys in your main application
 */

const { getApiKey, getAllApiKeys, initializeApiKeys } = require('./get-api-keys');

// Example 1: Get a single API key
async function example1() {
  console.log('Example 1: Get single API key\n');

  try {
    const twoCaptchaKey = await getApiKey('TWOCAPTCHA_API_KEY');
    console.log('2Captcha Key:', twoCaptchaKey.substring(0, 10) + '...');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 2: Get all API keys as an object
async function example2() {
  console.log('\nExample 2: Get all API keys\n');

  try {
    const keys = await getAllApiKeys();
    console.log('Available keys:', Object.keys(keys));
    console.log('\nKey values (first 10 chars):');
    for (const [name, value] of Object.entries(keys)) {
      console.log(`  ${name}: ${value.substring(0, 10)}...`);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 3: Initialize API keys into process.env
async function example3() {
  console.log('\nExample 3: Initialize keys into process.env\n');

  try {
    await initializeApiKeys();
    console.log('Keys loaded into environment:');
    console.log('  process.env.TWOCAPTCHA_API_KEY:', process.env.TWOCAPTCHA_API_KEY?.substring(0, 10) + '...');
    console.log('  process.env.ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY?.substring(0, 10) + '...');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 4: Use in your main application
async function example4() {
  console.log('\nExample 4: Real-world usage in your app\n');

  try {
    // Initialize all keys at startup
    await initializeApiKeys();

    // Now you can use them anywhere in your app
    console.log('✅ All API keys loaded!');
    console.log('You can now use:');
    console.log('  - process.env.TWOCAPTCHA_API_KEY');
    console.log('  - process.env.ANTICAPTCHA_API_KEY');
    console.log('  - process.env.TWILIO_ACCOUNT_SID');
    console.log('  - process.env.ANTHROPIC_API_KEY');
    console.log('  - etc.\n');

    // Example: Make a request with the key
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      console.log('Making API request with Anthropic key...');
      // Your API logic here
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Example 5: Integration in your main app.js
function example5() {
  console.log('\nExample 5: Integration pattern\n');

  console.log(`
// In your main application file (e.g., app.js or index.js)

const { initializeApiKeys } = require('./admin-verktyg/02-api-nycklar/get-api-keys');

async function main() {
  try {
    // Load all API keys at startup
    console.log('Loading API keys from Supabase...');
    await initializeApiKeys();
    console.log('✅ API keys loaded successfully!');

    // Start your application
    const scraper = require('./src/scraper');
    await scraper.run();
  } catch (error) {
    console.error('Failed to initialize:', error.message);
    process.exit(1);
  }
}

main();
  `);
}

// Run all examples
async function runAllExamples() {
  console.log('━'.repeat(60));
  console.log('API Key Usage Examples');
  console.log('━'.repeat(60));

  // Check if environment is configured
  if (!process.env.SUPABASE_URL || !process.env.ENCRYPTION_KEY) {
    console.error('\n❌ Error: Environment not configured');
    console.error('Please set up .env file with:');
    console.error('  - SUPABASE_URL');
    console.error('  - SUPABASE_SERVICE_KEY');
    console.error('  - ENCRYPTION_KEY\n');
    return;
  }

  await example1();
  await example2();
  await example3();
  await example4();
  example5();

  console.log('\n' + '━'.repeat(60));
  console.log('Examples complete!');
  console.log('━'.repeat(60) + '\n');
}

// Run if executed directly
if (require.main === module) {
  require('dotenv').config();
  runAllExamples().catch(console.error);
}

module.exports = {
  example1,
  example2,
  example3,
  example4,
  example5
};
