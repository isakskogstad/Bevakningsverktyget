/**
 * Tester för Supabase Edge Functions
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Supabase Edge Functions', () => {
  const functionsDir = path.join(__dirname, '..', 'supabase', 'functions');

  const expectedFunctions = [
    'parse-pdf',
    'generate-article',
    'budget',
    'poit-kungorelse',
    'allabolag-proxy',
    'scrape-press-images',
    'send-sms',
    'purchase-document',
    'twilio-webhook'
  ];

  it('alla förväntade edge functions ska finnas', () => {
    for (const fn of expectedFunctions) {
      const fnPath = path.join(functionsDir, fn);
      assert.ok(fs.existsSync(fnPath), `${fn} mapp borde finnas`);

      const indexPath = path.join(fnPath, 'index.ts');
      assert.ok(fs.existsSync(indexPath), `${fn}/index.ts borde finnas`);
    }
  });

  it('_shared mapp ska finnas med claude-client', () => {
    const sharedPath = path.join(functionsDir, '_shared');
    assert.ok(fs.existsSync(sharedPath), '_shared mapp borde finnas');

    const claudeClientPath = path.join(sharedPath, 'claude-client.ts');
    assert.ok(fs.existsSync(claudeClientPath), 'claude-client.ts borde finnas');
  });

  it('parse-pdf ska ha korrekt CORS-headers', () => {
    const parsePdfPath = path.join(functionsDir, 'parse-pdf', 'index.ts');
    const content = fs.readFileSync(parsePdfPath, 'utf-8');

    assert.ok(content.includes('corsHeaders'), 'Borde ha corsHeaders');
    assert.ok(content.includes('Access-Control-Allow-Origin'), 'Borde ha CORS origin');
  });

  it('budget ska hantera GET och POST', () => {
    const budgetPath = path.join(functionsDir, 'budget', 'index.ts');
    const content = fs.readFileSync(budgetPath, 'utf-8');

    assert.ok(content.includes('req.method'), 'Borde kontrollera request method');
    assert.ok(content.includes('"GET"'), 'Borde hantera GET');
    assert.ok(content.includes('"POST"'), 'Borde hantera POST');
  });

  it('allabolag-proxy ska ha rate limiting', () => {
    const proxyPath = path.join(functionsDir, 'allabolag-proxy', 'index.ts');
    const content = fs.readFileSync(proxyPath, 'utf-8');

    assert.ok(content.includes('checkRateLimit'), 'Borde ha rate limit funktion');
    assert.ok(content.includes('RATE_LIMIT'), 'Borde ha rate limit konstant');
  });
});

describe('Claude Client', () => {
  const claudeClientPath = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'claude-client.ts');

  it('claude-client ska stödja Opus 4.5', () => {
    const content = fs.readFileSync(claudeClientPath, 'utf-8');

    assert.ok(content.includes('claude-opus-4-5'), 'Borde stödja Opus 4.5');
    assert.ok(content.includes('EffortLevel'), 'Borde ha effort level typ');
  });

  it('claude-client ska exportera nödvändiga funktioner', () => {
    const content = fs.readFileSync(claudeClientPath, 'utf-8');

    assert.ok(content.includes('export class ClaudeClient'), 'Borde exportera ClaudeClient');
    assert.ok(content.includes('export function createClaudeClient'), 'Borde exportera createClaudeClient');
    assert.ok(content.includes('export function validatePdf'), 'Borde exportera validatePdf');
  });
});
