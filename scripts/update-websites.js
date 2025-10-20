#!/usr/bin/env node
// Enhanced Customer Website Bulk Updater for e-automate PIP Interface
// Features: Smart domain guessing, improved Google CSE, OpenAI fallback
// Run: node scripts/update-websites.js

const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Simple argv parser
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i+1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// Load environment
try {
  require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
} catch (e) {
  // dotenv optional
}

const CONFIG = {
  endpoint: 'https://sfs.rpg.com/pip/PublicAPIService.asmx',
  namespace: 'http://digitalgateway.com/WebServices/PublicAPIService',
  username: process.env.EA_USERNAME || '',
  password: process.env.EA_PASSWORD || '',
  companyID: process.env.EA_COMPANYID || '',
  version: '25.0',
  forceWww: true,
  debug: false,
  
  // Search API keys
  googleCseKey: process.env.GOOGLE_CSE_KEY || '',
  googleCx: process.env.GOOGLE_CX || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
  
  // Feature flags
  enableDomainGuessing: true,
  enableGoogleSearch: true,
  enableOpenAI: false, // Default off, enable with --enable-openai or env var
  
  // Tuning parameters
  dnsTimeout: 3000,
  httpTimeout: 5000,
  openaiModel: 'gpt-4o-mini' // cheaper, faster; use gpt-4o for better quality
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise((res) => rl.question(q, res));

// ========================================
// SOAP API Functions
// ========================================

async function soapRequest(method, body) {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${method} xmlns="${CONFIG.namespace}">
      <Auth>
        <User>${CONFIG.username}</User>
        <Password>${CONFIG.password}</Password>
        <CompanyID>${CONFIG.companyID}</CompanyID>
        <Version>${CONFIG.version}</Version>
      </Auth>
      ${body}
    </${method}>
  </soap:Body>
</soap:Envelope>`;

  if (CONFIG.debug) {
    console.log('\n--- SOAP Request ---');
    console.log(soapEnvelope);
    console.log('--- End SOAP Request ---\n');
  }

  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soapEnvelope),
        'SOAPAction': `${CONFIG.namespace}/${method}`
      }
    };

    const req = https.request(CONFIG.endpoint, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (CONFIG.debug) {
            console.log('\n--- SOAP Response ---');
            console.log(data);
            console.log('--- End SOAP Response ---\n');
          }
          resolve(data);
        } else {
          if (CONFIG.debug) {
            console.error(`\n--- SOAP Error Response ---\nHTTP ${res.statusCode}:\n${data}\n--- End ---\n`);
          }
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(soapEnvelope);
    req.end();
  });
}

function parseXmlValue(xml, tagName) {
  const regex = new RegExp(`<${tagName}>\\s*<Value>([\\s\\S]*?)</Value>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlCode(xml, tagName) {
  const regex = new RegExp(`<${tagName}>.*?<Code>.*?<Value>(.*?)</Value>.*?</Code>.*?</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlId(xml, tagName) {
  const regex = new RegExp(`<${tagName}>.*?<ID>.*?<Value>(.*?)</Value>.*?</ID>.*?</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

async function getCustomer(customerCode) {
  const body = `
    <CustomerNumber>
      <ID><Value>0</Value><Valid>false</Valid></ID>
      <Code><Value>${customerCode}</Value><Valid>true</Valid></Code>
    </CustomerNumber>`;

  const response = await soapRequest('getCustomer', body);

  return {
    id: parseXmlId(response, 'CustomerNumber'),
    code: parseXmlCode(response, 'CustomerNumber'),
    name: parseXmlValue(response, 'CustomerName'),
    city: parseXmlValue(response, 'City'),
    state: parseXmlValue(response, 'State'),
    phone: parseXmlValue(response, 'Phone1'),
    currentWebsite: parseXmlValue(response, 'WebSite')
  };
}

async function saveCustomerWebsite(customerId, customerCode, websiteUrl) {
  const outId = (customerId && customerId.trim() !== '') ? customerId : '0';
  const outCode = (customerCode && customerCode.trim() !== '') ? customerCode : '';
  
  // Ensure URL is lowercase
  const normalizedUrl = websiteUrl.toLowerCase();
  
  const body = `
    <customer>
      <CustomerNumber>
        <ID><Value>${outId}</Value><Valid>true</Valid></ID>
        <Code><Value>${outCode}</Value><Valid>true</Valid></Code>
      </CustomerNumber>
      <WebSite>
        <Value>${normalizedUrl}</Value>
        <Valid>true</Valid>
      </WebSite>
    </customer>`;

  const response = await soapRequest('saveCustomer', body);
  return response && response.toLowerCase().includes('savecustomerresult');
}

// ========================================
// Domain Normalization
// ========================================

function normalizeDomain(url) {
  if (!url) return '';
  url = url.trim();
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    let host = u.hostname;
    if (CONFIG.forceWww && !host.startsWith('www.')) host = `www.${host}`;
    return host;
  } catch (e) {
    url = url.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0];
    if (CONFIG.forceWww && !/^www\./i.test(url)) url = `www.${url}`;
    return url;
  }
}

// ========================================
// TIER 1: Smart Domain Guessing
// ========================================

function cleanCompanyName(name) {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|corp|ltd|limited|incorporated|corporation|company|co|l\.l\.c\.|l\.l\.c)\b\.?/gi, '')
    .replace(/^the\s+/i, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();
}

function generateDomainPatterns(companyName, city) {
  const cleaned = cleanCompanyName(companyName);
  const noSpaces = cleaned.replace(/\s+/g, '');
  const hyphenated = cleaned.replace(/\s+/g, '-');
  const noNumbers = noSpaces.replace(/\d+/g, '');
  
  const patterns = [
    `${noSpaces}.com`,
    `${hyphenated}.com`,
    `${noNumbers}.com`,
  ];
  
  // Add city-based patterns if city provided
  if (city) {
    const cityClean = city.toLowerCase().replace(/[^a-z0-9]/g, '');
    patterns.push(`${cityClean}${noSpaces}.com`);
    patterns.push(`${noSpaces}${cityClean}.com`);
  }
  
  // Remove duplicates and add www prefix
  const unique = [...new Set(patterns)].map(p => {
    return CONFIG.forceWww && !p.startsWith('www.') ? `www.${p}` : p;
  });
  
  return unique;
}

async function checkDomainExists(domain) {
  try {
    // Remove www. for DNS lookup
    const bareHost = domain.replace(/^www\./i, '');
    await Promise.race([
      dns.resolve(bareHost),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), CONFIG.dnsTimeout))
    ]);
    return true;
  } catch (err) {
    return false;
  }
}

async function checkWebsiteResponds(domain) {
  return new Promise((resolve) => {
    const options = {
      method: 'HEAD',
      timeout: CONFIG.httpTimeout,
      headers: { 'User-Agent': 'ea-pip-updater/2.0' }
    };
    
    const protocol = domain.startsWith('http') ? (domain.startsWith('https') ? https : http) : https;
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    
    const req = protocol.request(url, options, (res) => {
      // Consider 2xx, 3xx as success
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function guessDomain(companyName, city) {
  if (!CONFIG.enableDomainGuessing) return null;
  
  console.log(`[Domain Guessing] Trying patterns for: ${companyName}`);
  const patterns = generateDomainPatterns(companyName, city);
  
  for (const pattern of patterns) {
    console.log(`  Checking: ${pattern}...`);
    
    // First check DNS (fast)
    const exists = await checkDomainExists(pattern);
    if (!exists) {
      console.log(`    ✗ DNS failed`);
      continue;
    }
    
    // Then check if website responds (slower)
    const responds = await checkWebsiteResponds(pattern);
    if (responds) {
      console.log(`    ✓ Found!`);
      return { url: pattern, confidence: 'high', source: 'domain_guess' };
    } else {
      console.log(`    ✗ No response`);
    }
  }
  
  console.log(`  No valid domain found via guessing`);
  return null;
}

// ========================================
// TIER 2: Improved Google Custom Search
// ========================================

async function searchGoogleCSE(query) {
  if (!CONFIG.enableGoogleSearch || !CONFIG.googleCseKey || !CONFIG.googleCx) {
    return null;
  }
  
  console.log(`[Google CSE] Searching: "${query}"`);
  
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      key: CONFIG.googleCseKey,
      cx: CONFIG.googleCx,
      q: query,
      num: 5 // Get top 5 results for better matching
    });
    
    const options = {
      method: 'GET',
      headers: { 'User-Agent': 'ea-pip-updater/2.0' }
    };
    
    const req = https.request(
      `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
      options,
      (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.items || json.items.length === 0) {
              console.log(`  No results found`);
              return resolve(null);
            }
            
            // Score and rank results
            const scored = json.items.map(item => {
              const url = item.link;
              const title = (item.title || '').toLowerCase();
              const snippet = (item.snippet || '').toLowerCase();
              
              let score = 0;
              
              // Higher score for official-looking domains
              if (url.includes('.com')) score += 10;
              if (title.includes('official') || title.includes('home')) score += 5;
              if (snippet.includes('official website')) score += 5;
              
              // Penalize social media, directories, etc.
              const badDomains = ['facebook.com', 'linkedin.com', 'twitter.com', 'yelp.com', 'yellowpages.com', 'bbb.org'];
              if (badDomains.some(bad => url.includes(bad))) score -= 20;
              
              return { url, title, score };
            });
            
            // Sort by score
            scored.sort((a, b) => b.score - a.score);
            
            console.log(`  Found ${scored.length} results, top match: ${scored[0].url} (score: ${scored[0].score})`);
            
            if (scored[0].score < 0) {
              console.log(`  Top result has negative score, skipping`);
              return resolve(null);
            }
            
            try {
              const u = new URL(scored[0].url);
              const normalized = normalizeDomain(u.hostname);
              return resolve({
                url: normalized,
                confidence: scored[0].score >= 10 ? 'high' : 'medium',
                source: 'google_cse',
                allResults: scored.map(s => s.url)
              });
            } catch (e) {
              return resolve(null);
            }
          } catch (e) {
            console.log(`  Error parsing results: ${e.message}`);
            return resolve(null);
          }
        });
      }
    );
    
    req.on('error', (e) => {
      console.log(`  Error: ${e.message}`);
      resolve(null);
    });
    req.end();
  });
}

// ========================================
// TIER 3: OpenAI Fallback
// ========================================

async function searchWithOpenAI(companyName, city, state, phone) {
  if (!CONFIG.enableOpenAI || !CONFIG.openaiKey) {
    return null;
  }
  
  console.log(`[OpenAI] Searching for: ${companyName}`);
  
  const prompt = `Find the official website URL for this company. Return ONLY the website URL in the format www.example.com or return NOT_FOUND if you cannot find it with high confidence.

Company Name: ${companyName}
Location: ${city}, ${state}
Phone: ${phone || 'N/A'}

Important: Return ONLY the website URL (www.example.com format) or NOT_FOUND. No explanations.`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: CONFIG.openaiModel,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that finds official company websites. Return only the URL or NOT_FOUND.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      max_tokens: 100
    });
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.openaiKey}`,
        'User-Agent': 'ea-pip-updater/2.0'
      }
    };
    
    const req = https.request('https://api.openai.com/v1/chat/completions', options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            console.log(`  Error: ${json.error.message}`);
            return resolve(null);
          }
          
          const content = json.choices[0].message.content.trim();
          console.log(`  OpenAI response: ${content}`);
          
          if (content === 'NOT_FOUND' || content.includes('NOT_FOUND')) {
            return resolve(null);
          }
          
          const normalized = normalizeDomain(content);
          return resolve({
            url: normalized,
            confidence: 'medium',
            source: 'openai'
          });
        } catch (e) {
          console.log(`  Error parsing response: ${e.message}`);
          return resolve(null);
        }
      });
    });
    
    req.on('error', (e) => {
      console.log(`  Error: ${e.message}`);
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

// ========================================
// Unified Website Search (All Tiers)
// ========================================

async function findWebsite(customer) {
  console.log(`\n[Website Search] Starting search for: ${customer.name}`);
  
  // Tier 1: Domain Guessing
  if (CONFIG.enableDomainGuessing) {
    const guessed = await guessDomain(customer.name, customer.city);
    if (guessed) {
      return guessed;
    }
  }
  
  // Tier 2: Google Custom Search
  if (CONFIG.enableGoogleSearch) {
    const query = `${customer.name} ${customer.city} ${customer.state} official website`;
    const googleResult = await searchGoogleCSE(query);
    if (googleResult) {
      return googleResult;
    }
  }
  
  // Tier 3: OpenAI
  if (CONFIG.enableOpenAI) {
    const openaiResult = await searchWithOpenAI(customer.name, customer.city, customer.state, customer.phone);
    if (openaiResult) {
      return openaiResult;
    }
  }
  
  console.log(`[Website Search] No results found from any source`);
  return null;
}

// ========================================
// Customer Processing
// ========================================

async function processCustomer(customerCode, opts = {}) {
  try {
    const customer = await getCustomer(customerCode);

    console.log(`\n========================================`);
    console.log(`Processing: ${customer.code || customerCode}`);
    console.log(`Name: ${customer.name || '(no name)'}`);
    console.log(`Location: ${customer.city || ''}${customer.state ? ', ' + customer.state : ''}`);
    console.log(`Phone: ${customer.phone || ''}`);
    console.log(`Current Website: ${customer.currentWebsite || '(empty)'}`);
    console.log(`========================================`);

    // Check if website already exists
    if (customer.currentWebsite && customer.currentWebsite.trim() !== '' && !opts.force) {
      if (opts.nonInteractive) {
        console.log(`Skipping - website already exists`);
        return { success: true, skipped: true };
      }
      const resp = (await question(`\nWebsite exists: ${customer.currentWebsite}\nChoose: (o)verwrite, (e)nter new, (s)kip: `)).trim().toLowerCase();
      if (resp === 's') {
        console.log(`Skipped by user`);
        return { success: true, skipped: true };
      }
      if (resp === 'e') {
        const manual = await question('Enter website URL (or press Enter to skip): ');
        if (!manual || manual.trim() === '') return { success: true, skipped: true };
        const normalized = normalizeDomain(manual);
        const saved = await saveCustomerWebsite(customer.id, customer.code, normalized);
        return { success: saved, skipped: false };
      }
    }

    let websiteUrl = opts.website;
    let result = null;
    
    if (!websiteUrl) {
      // Run automated search
      result = await findWebsite(customer);
      
      if (result) {
        console.log(`\n✓ Found: ${result.url}`);
        console.log(`  Source: ${result.source}`);
        console.log(`  Confidence: ${result.confidence}`);
        
        if (opts.nonInteractive) {
          if (result.confidence === 'high' || opts.force) {
            websiteUrl = result.url;
          } else {
            console.log(`Skipping - confidence too low for non-interactive mode`);
            return { success: true, skipped: true };
          }
        } else {
          const choice = (await question(`\nUse this website? (y/n/e for enter manually): `)).trim().toLowerCase();
          if (choice === 'y') {
            websiteUrl = result.url;
          } else if (choice === 'e') {
            const manual = await question('Enter website URL (or press Enter to skip): ');
            if (manual && manual.trim() !== '') websiteUrl = manual;
            else return { success: true, skipped: true };
          } else {
            console.log(`Skipped by user`);
            return { success: true, skipped: true };
          }
        }
      } else {
        if (opts.nonInteractive) {
          console.log(`No website found - skipping`);
          return { success: true, skipped: true };
        }
        const manual = await question('\nNo website found. Enter URL manually (or press Enter to skip): ');
        if (!manual || manual.trim() === '') return { success: true, skipped: true };
        websiteUrl = manual;
      }
    }

    if (!websiteUrl || websiteUrl.trim() === '') {
      return { success: true, skipped: true };
    }

    const normalizedUrl = normalizeDomain(websiteUrl);
    console.log(`\nSaving: ${normalizedUrl}`);

    if (!opts.nonInteractive && !opts.autoConfirm) {
      const confirm = (await question(`Confirm save? (y/n): `)).trim().toLowerCase();
      if (confirm !== 'y') {
        console.log(`Cancelled by user`);
        return { success: true, skipped: true };
      }
    }

    const saved = await saveCustomerWebsite(customer.id, customer.code, normalizedUrl);
    if (saved) {
      console.log('✓ Website updated successfully!');
      return { success: true, skipped: false, updated: true, url: normalizedUrl };
    } else {
      console.log('✗ Failed to update website');
      return { success: false, skipped: false };
    }
  } catch (error) {
    console.error(`\n✗ Error processing customer ${customerCode}: ${error.message}`);
    return { success: false, skipped: false, error: error.message };
  }
}

async function processCustomerList(customerCodes, opts = {}) {
  const results = { total: customerCodes.length, updated: 0, skipped: 0, failed: 0 };
  const detailed = [];
  
  for (let i = 0; i < customerCodes.length; i++) {
    const item = customerCodes[i];
    const code = typeof item === 'string' ? item : item.code;
    const website = typeof item === 'object' ? item.website : undefined;

    console.log(`\n\n========================================`);
    console.log(`Progress: ${i+1} of ${results.total}`);
    console.log(`========================================`);

    const res = await processCustomer(code, { 
      nonInteractive: opts.nonInteractive, 
      website, 
      force: opts.force,
      autoConfirm: opts.autoConfirm 
    });
    
    if (res.skipped) {
      results.skipped++;
    } else if (res.success) {
      results.updated++;
      if (res.url) {
        detailed.push({ code, url: res.url, status: 'updated' });
      }
    } else {
      results.failed++;
      detailed.push({ code, error: res.error || 'unknown', status: 'failed' });
    }
  }

  console.log('\n\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`Total processed: ${results.total}`);
  console.log(`Updated: ${results.updated}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Failed: ${results.failed}`);
  console.log('========================================\n');
  
  return { results, detailed };
}

// ========================================
// CSV Utilities
// ========================================

function readCsvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const rows = [];
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length === 1) rows.push(parts[0]);
    else rows.push({ code: parts[0], website: parts[1] || '' });
  }
  return rows;
}

function writeResultsCsv(filePath, detailed) {
  const lines = ['code,status,url,error'];
  for (const item of detailed) {
    const url = item.url || '';
    const error = item.error || '';
    lines.push(`${item.code},${item.status},${url},${error}`);
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ========================================
// Main
// ========================================

async function main() {
  console.log('\n========================================');
  console.log('Enhanced Customer Website Bulk Updater');
  console.log('========================================\n');

  const args = parseArgs(process.argv);
  
  // Apply CLI args to config
  if (args.username) CONFIG.username = args.username;
  if (args.password) CONFIG.password = args.password;
  if (args.companyID) CONFIG.companyID = args.companyID;
  if (args.endpoint) CONFIG.endpoint = args.endpoint;
  if (args.namespace) CONFIG.namespace = args.namespace;
  if (args['openai-key']) CONFIG.openaiKey = args['openai-key'];
  if (args['google-key']) CONFIG.googleCseKey = args['google-key'];
  if (args['google-cx']) CONFIG.googleCx = args['google-cx'];
  
  // Feature flags
  if (args['enable-openai'] || process.env.ENABLE_OPENAI === 'true') CONFIG.enableOpenAI = true;
  if (args['disable-domain-guessing']) CONFIG.enableDomainGuessing = false;
  if (args['disable-google']) CONFIG.enableGoogleSearch = false;
  if (args['openai-model']) CONFIG.openaiModel = args['openai-model'];
  
  if (args['force-www']) CONFIG.forceWww = true;
  if (args['no-force-www']) CONFIG.forceWww = false;
  if (args.debug) CONFIG.debug = true;

  console.log('Active search methods:');
  console.log(`  Domain Guessing: ${CONFIG.enableDomainGuessing ? '✓' : '✗'}`);
  console.log(`  Google CSE: ${CONFIG.enableGoogleSearch && CONFIG.googleCseKey ? '✓' : '✗'}`);
  console.log(`  OpenAI: ${CONFIG.enableOpenAI && CONFIG.openaiKey ? '✓' : '✗'}`);
  console.log('');

  const nonInteractive = !!(args.codes || args.yes || args['non-interactive']);
  const autoConfirm = !!args.yes;

  try {
    // File mode
    if (args.file) {
      const filePath = path.resolve(process.cwd(), args.file);
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const rows = readCsvFile(filePath);
      console.log(`Loaded ${rows.length} customers from ${filePath}\n`);
      
      const { results, detailed } = await processCustomerList(rows, { 
        nonInteractive: !args.interactive, 
        force: !!args.force,
        autoConfirm 
      });
      
      // Write results to CSV
      if (args.output) {
        const outputPath = path.resolve(process.cwd(), args.output);
        writeResultsCsv(outputPath, detailed);
        console.log(`\nResults written to: ${outputPath}`);
      }
      
      rl.close();
      return;
    }

    // Codes mode
    if (args.codes) {
      const codes = args.codes.split(',').map(s => s.trim()).filter(Boolean);
      await processCustomerList(codes, { nonInteractive: true, force: !!args.force, autoConfirm });
      rl.close();
      return;
    }

    // Validate credentials for non-interactive
    if (nonInteractive && (!CONFIG.username || !CONFIG.password || !CONFIG.companyID)) {
      throw new Error('Missing credentials for non-interactive run. Use --username --password --companyID');
    }

    // Interactive mode - prompt for credentials if needed
    if (!CONFIG.username) CONFIG.username = await question('Enter username: ');
    if (!CONFIG.password) CONFIG.password = await question('Enter password: ');
    if (!CONFIG.companyID) CONFIG.companyID = await question('Enter company ID: ');

    const mode = await question('\nProcess (1) single customer or (2) multiple customers? Enter 1 or 2: ');
    if (mode === '1') {
      const customerCode = await question('Enter customer code: ');
      await processCustomer(customerCode, { nonInteractive: false });
    } else if (mode === '2') {
      const codesInput = await question('Enter customer codes (comma-separated): ');
      const customerCodes = codesInput.split(',').map(c => c.trim()).filter(c => c);
      await processCustomerList(customerCodes, { nonInteractive: false });
    } else {
      console.log('Invalid option.');
    }

    rl.close();
  } catch (err) {
    console.error('\n✗ Fatal error:', err.message || err);
    rl.close();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { 
  processCustomer, 
  processCustomerList, 
  findWebsite, 
  guessDomain,
  searchGoogleCSE,
  searchWithOpenAI
};