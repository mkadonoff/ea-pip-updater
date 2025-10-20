#!/usr/bin/env node
// Simple test script to call Google Custom Search API using .env keys
try { require('dotenv').config({ path: require('path').join(process.cwd(), '.env') }); } catch (e) {}
const https = require('https');

const key = process.env.GOOGLE_CSE_KEY;
const cx = process.env.GOOGLE_CX;
const query = process.argv.slice(2).join(' ') || 'Archetal MD official website';

if (!key || !cx) {
  console.error('Missing GOOGLE_CSE_KEY or GOOGLE_CX in .env');
  process.exit(2);
}

const params = new URLSearchParams({ key, cx, q: query });
const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

https.get(url, { headers: { 'User-Agent': 'ea-pip-updater-test/1.0' } }, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (!json.items || json.items.length === 0) {
        console.log('No results');
        return;
      }
      for (let i = 0; i < Math.min(5, json.items.length); i++) {
        const it = json.items[i];
        console.log(`Result #${i+1}:`);
        console.log(` Title: ${it.title}`);
        console.log(` Link: ${it.link}`);
        if (it.snippet) console.log(` Snippet: ${it.snippet}`);
        console.log('');
      }
    } catch (e) {
      console.error('Failed to parse response:', e.message);
      console.error(data);
    }
  });
}).on('error', (err) => {
  console.error('Request failed:', err.message);
});
