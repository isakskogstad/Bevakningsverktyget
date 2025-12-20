#!/usr/bin/env node
"use strict";

const { createClient } = require('@supabase/supabase-js');
const { BonnierNewsScraper } = require('../src/scrapers/bonnier-news-scraper');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ARTICLE_URLS = (process.env.BONNIER_ARTICLE_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
const SESSION_DIR = process.env.BONNIER_SESSION_DIR || path.resolve(__dirname, '../data/bonnier-session');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

if (!ARTICLE_URLS.length) {
  console.error('Set BONNIER_ARTICLE_URLS to a comma-separated list of DI/DN urls');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const scraper = new BonnierNewsScraper({
    email: process.env.DI_EMAIL || process.env.BONNIER_EMAIL,
    password: process.env.DI_PASSWORD || process.env.BONNIER_PASSWORD,
    sessionDir: SESSION_DIR,
    headless: true,
    verbose: true
  });

  await scraper.init();

  for (const url of ARTICLE_URLS) {
    console.log(`Scraping article: ${url}`);
    try {
      const article = await scraper.scrapeArticle(url);
      if (!article || !article.title) {
        console.warn('No article data, skipping');
        continue;
      }

      const { title, lead, body, author, publishedAt, updatedAt, source } = article;
      const payload = {
        title,
        lead,
        body,
        author,
        published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
        updated_at: updatedAt ? new Date(updatedAt).toISOString() : null,
        source: source || 'bonnier',
        url,
        type: 'press',
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('news_articles')
        .upsert(payload, { onConflict: 'url' });

      if (error) {
        console.error('Supabase insert failed', error.message);
        continue;
      }

      console.log('Saved article', data?.[0]?.id || 'ok');
    } catch (err) {
      console.error('Scraper error', err.message);
    }
  }

  await scraper.close();
}

run().catch(err => {
  console.error('Collector failed', err);
  process.exit(1);
});
