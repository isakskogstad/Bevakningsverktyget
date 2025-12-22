/**
 * Tester för frontendkonfiguration
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Frontend Config', () => {
  const configPath = path.join(__dirname, '..', 'docs', 'assets', 'js', 'config.js');

  it('config.js ska finnas', () => {
    assert.ok(fs.existsSync(configPath), 'config.js borde finnas');
  });

  it('config.js ska innehålla Supabase-konfiguration', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    assert.ok(content.includes('supabase:'), 'Borde innehålla supabase-sektion');
    assert.ok(content.includes('url:'), 'Borde innehålla url');
    assert.ok(content.includes('anonKey:'), 'Borde innehålla anonKey');
  });

  it('config.js ska ha definierade app-inställningar', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    assert.ok(content.includes('app:'), 'Borde innehålla app-sektion');
    assert.ok(content.includes('defaultPageSize:'), 'Borde innehålla defaultPageSize');
  });
});

describe('CSS-filer', () => {
  const cssDir = path.join(__dirname, '..', 'docs', 'assets', 'css');

  it('main.css ska finnas och importera andra CSS-filer', () => {
    const mainCssPath = path.join(cssDir, 'main.css');
    assert.ok(fs.existsSync(mainCssPath), 'main.css borde finnas');

    const content = fs.readFileSync(mainCssPath, 'utf-8');
    assert.ok(content.includes('@import'), 'main.css borde importera andra filer');
    assert.ok(content.includes('variables.css'), 'Borde importera variables.css');
    assert.ok(content.includes('components.css'), 'Borde importera components.css');
  });

  it('alla nödvändiga CSS-filer ska finnas', () => {
    const requiredFiles = ['variables.css', 'reset.css', 'components.css', 'layout.css', 'utilities.css'];

    for (const file of requiredFiles) {
      const filePath = path.join(cssDir, file);
      assert.ok(fs.existsSync(filePath), `${file} borde finnas`);
    }
  });
});

describe('JavaScript-moduler', () => {
  const jsDir = path.join(__dirname, '..', 'docs', 'assets', 'js');

  it('alla nödvändiga JS-filer ska finnas', () => {
    const requiredFiles = ['api.js', 'auth.js', 'config.js', 'utils.js'];

    for (const file of requiredFiles) {
      const filePath = path.join(jsDir, file);
      assert.ok(fs.existsSync(filePath), `${file} borde finnas`);
    }
  });

  it('api.js ska exportera API-objekt', () => {
    const apiPath = path.join(jsDir, 'api.js');
    const content = fs.readFileSync(apiPath, 'utf-8');
    assert.ok(content.includes('const API'), 'Borde definiera API-variabel');
    assert.ok(content.includes('getCompanies'), 'Borde ha getCompanies-funktion');
  });

  it('auth.js ska exportera Auth-objekt', () => {
    const authPath = path.join(jsDir, 'auth.js');
    const content = fs.readFileSync(authPath, 'utf-8');
    assert.ok(content.includes('const Auth'), 'Borde definiera Auth-variabel');
    assert.ok(content.includes('login'), 'Borde ha login-funktion');
    assert.ok(content.includes('logout'), 'Borde ha logout-funktion');
  });
});
