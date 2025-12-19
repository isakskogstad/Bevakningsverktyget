/**
 * Database Setup Script
 * Creates the api_keys table in Supabase
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function setupDatabase() {
  console.log('Setting up database tables...\n');

  // SQL to create the api_keys table
  const createTableSQL = `
    -- Create api_keys table
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key_name VARCHAR(255) UNIQUE NOT NULL,
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      description TEXT,
      service_name VARCHAR(255),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Create index for faster lookups
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_name ON api_keys(key_name);
    CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);

    -- Enable Row Level Security
    ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

    -- Create policy to allow service role full access
    DROP POLICY IF EXISTS "Service role has full access" ON api_keys;
    CREATE POLICY "Service role has full access" ON api_keys
      FOR ALL
      USING (true)
      WITH CHECK (true);

    -- Create updated_at trigger
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';

    DROP TRIGGER IF EXISTS update_api_keys_updated_at ON api_keys;
    CREATE TRIGGER update_api_keys_updated_at
      BEFORE UPDATE ON api_keys
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `;

  try {
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: createTableSQL
    });

    if (error) {
      // If rpc doesn't exist, try direct query
      console.log('Attempting to create table directly...');

      // Split SQL into individual statements
      const statements = createTableSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const statement of statements) {
        const { error: execError } = await supabase
          .from('_exec')
          .select('*')
          .limit(0); // This will fail, but we'll use the SQL editor instead

        if (execError) {
          console.log('\n⚠️  Please execute the following SQL in Supabase SQL Editor:\n');
          console.log('━'.repeat(80));
          console.log(createTableSQL);
          console.log('━'.repeat(80));
          console.log('\nSteps:');
          console.log('1. Go to Supabase Dashboard > SQL Editor');
          console.log('2. Create a new query');
          console.log('3. Paste the SQL above');
          console.log('4. Click "Run"\n');
          return;
        }
      }
    }

    console.log('✅ Database setup complete!');
    console.log('\nTable created: api_keys');
    console.log('Columns:');
    console.log('  - id (UUID, primary key)');
    console.log('  - key_name (unique identifier)');
    console.log('  - encrypted_value (AES-256 encrypted)');
    console.log('  - iv (initialization vector)');
    console.log('  - description');
    console.log('  - service_name');
    console.log('  - is_active');
    console.log('  - created_at');
    console.log('  - updated_at\n');

  } catch (error) {
    console.error('Error setting up database:', error.message);
    console.log('\n⚠️  Please execute the following SQL in Supabase SQL Editor:\n');
    console.log('━'.repeat(80));
    console.log(createTableSQL);
    console.log('━'.repeat(80));
    console.log('\nSteps:');
    console.log('1. Go to Supabase Dashboard > SQL Editor');
    console.log('2. Create a new query');
    console.log('3. Paste the SQL above');
    console.log('4. Click "Run"\n');
  }
}

setupDatabase();
