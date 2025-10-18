#!/usr/bin/env node
// Customer Website Bulk Updater for e-automate PIP Interface
// Save as: scripts/update-websites.js
// Run interactive: node scripts/update-websites.js
// Run non-interactive (CSV): node scripts/update-websites.js --file customers.csv --yes --username user --password pass --companyID 123

const https = require('https');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Simple argv parser (no extra deps)
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

// Configuration - load from .env if present
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
  version: '25.0'
};

// Create readline interface for interactive input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise((res) => rl.question(q, res));

// Make SOAP request
async function soapRequest(method, body) {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" \n               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" \n               xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <soap:Body>\n    <${method} xmlns="${CONFIG.namespace}">\n      <Auth>\n        <User>${CONFIG.username}</User>\n        <Password>${CONFIG.password}</Password>\n        <CompanyID>${CONFIG.companyID}</CompanyID>\n        <Version>${CONFIG.version}</Version>\n      </Auth>\n      ${body}\n    </${method}>\n  </soap:Body>\n</soap:Envelope>`;

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
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(soapEnvelope);
    req.end();
  });
}

// Parse XML response (simple regex-based parser)
function parseXmlValue(xml, tagName) {
  const regex = new RegExp(`<${tagName}>\\s*<Value>([\\s\\S]*?)</Value>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlCode(xml, tagName) {
  const regex = new RegExp(`<${tagName}>[\\s\\S]*?<Code>\\s*<Value>([\\s\\S]*?)</Value>\\s*</Code>[\\s\\S]*?</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlId(xml, tagName) {
  const regex = new RegExp(`<${tagName}>[\\s\\S]*?<ID>\\s*<Value>([\\s\\S]*?)</Value>\\s*</ID>[\\s\\S]*?</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

// Get customer data
async function getCustomer(customerCode) {
  const body = `\n    <CustomerNumber>\n      <ID><Value>0</Value><Valid>false</Valid></ID>\n      <Code><Value>${customerCode}</Value><Valid>true</Valid></Code>\n    </CustomerNumber>`;

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

// Search web for company website (placeholder)
async function searchForWebsite(customerName, city, state) {
  // This is intentionally a stub. For automation, integrate Google/Bing or another datasource.
  return null;
}

// Normalize domain
function normalizeDomain(url) {
  if (!url) return '';
  url = url.trim();
  // If user entered a full URL, keep it but normalize
  if (/^https?:\/\//i.test(url)) {
    // remove trailing path but keep protocol
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}`;
    } catch (e) {
      // fallthrough
    }
  }

  // Remove protocol and path
  url = url.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0];
  return `https://${url}`;
}

// Save customer website
async function saveCustomerWebsite(customerId, customerCode, websiteUrl) {
  const body = `\n    <customer>\n      <CustomerNumber>\n        <ID><Value>${customerId}</Value><Valid>true</Valid></ID>\n        <Code><Value>${customerCode}</Value><Valid>true</Valid></Code>\n      </CustomerNumber>\n      <WebSite>\n        <Value>${websiteUrl}</Value>\n        <Valid>true</Valid>\n      </WebSite>\n    </customer>`;

  const response = await soapRequest('saveCustomer', body);
  // Basic success heuristic
  if (response && response.toLowerCase().includes('savecustomerresult')) {
    return true;
  }
  return false;
}

// Process a single customer (interactive by default)
async function processCustomer(customerCode, opts = {}) {
  try {
    const customer = await getCustomer(customerCode);

    console.log('\n--- Customer Information ---');
    console.log(`ID: ${customer.id}`);
    console.log(`Code: ${customer.code}`);
    console.log(`Name: ${customer.name}`);
    console.log(`Location: ${customer.city}, ${customer.state}`);
    console.log(`Phone: ${customer.phone}`);
    console.log(`Current Website: ${customer.currentWebsite || '(empty)'}');
    console.log('---------------------------\n');

    // If website exists and not forcing override, ask or skip
    if (customer.currentWebsite && customer.currentWebsite.trim() !== '' && !opts.force) {
      if (opts.nonInteractive) {
        return { success: true, skipped: true };
      }
      const overwrite = await question(`Website already exists. Overwrite? (y/n): `);
      if (overwrite.toLowerCase() !== 'y') return { success: true, skipped: true };
    }

    // If a website was provided in opts, use it (non-interactive mode)
    let websiteUrl = opts.website;
    if (!websiteUrl) {
      // Attempt automated search (stub)
      await searchForWebsite(customer.name, customer.city, customer.state);
      if (opts.nonInteractive) {
        return { success: true, skipped: true };
      }
      websiteUrl = await question('Enter website URL (or press Enter to skip): ');
    }

    if (!websiteUrl || websiteUrl.trim() === '') return { success: true, skipped: true };

    const normalizedUrl = normalizeDomain(websiteUrl);
    console.log(`Normalized URL: ${normalizedUrl}`);

    if (!opts.nonInteractive) {
      const confirm = await question(`Save this website? (y/n): `);
      if (confirm.toLowerCase() !== 'y') return { success: true, skipped: true };
    }

    const saved = await saveCustomerWebsite(customer.id, customer.code, normalizedUrl);
    if (saved) console.log('✓ Website updated successfully!');
    else console.log('✗ Failed to update website');
    return { success: saved, skipped: false };
  } catch (error) {
    console.error(`Error processing customer ${customerCode}: ${error.message}`);
    return { success: false, skipped: false, error: error.message };
  }
}

// Process list (supports non-interactive CSV rows with columns: code,website)
async function processCustomerList(customerCodes, opts = {}) {
  const results = { total: customerCodes.length, updated: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < customerCodes.length; i++) {
    const item = customerCodes[i];
    const code = typeof item === 'string' ? item : item.code;
    const website = typeof item === 'object' ? item.website : undefined;

    console.log(`\n========================================`);
    console.log(`Processing ${i+1} of ${results.total}`);
    console.log(`========================================`);

    const res = await processCustomer(code, { nonInteractive: opts.nonInteractive, website, force: opts.force });
    if (res.skipped) results.skipped++; else if (res.success) results.updated++; else results.failed++;

    if (!opts.nonInteractive && i < customerCodes.length - 1) {
      const cont = await question('\nContinue to next customer? (y/n): ');
      if (cont.toLowerCase() !== 'y') break;
    }
  }

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`Total processed: ${results.updated + results.skipped + results.failed}`);
  console.log(`Updated: ${results.updated}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Failed: ${results.failed}`);
  console.log('========================================\n');
}

// Utility: read CSV file with header or simple rows: code,website
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

// Main
async function main() {
  console.log('\nCustomer Website Bulk Updater\n');

  const args = parseArgs(process.argv);
  if (args.username) CONFIG.username = args.username;
  if (args.password) CONFIG.password = args.password;
  if (args.companyID) CONFIG.companyID = args.companyID;
  if (args.endpoint) CONFIG.endpoint = args.endpoint;
  if (args.namespace) CONFIG.namespace = args.namespace;

  const nonInteractive = !!(args.file || args.codes || args.yes || args['non-interactive']);
  const autoYes = !!args.yes;

  try {
    if (args.file) {
      const filePath = path.resolve(process.cwd(), args.file);
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const rows = readCsvFile(filePath);
      console.log(`Loaded ${rows.length} rows from ${filePath}`);
      await processCustomerList(rows, { nonInteractive: true, force: !!args.force });
      rl.close();
      return;
    }

    if (args.codes) {
      const codes = args.codes.split(',').map(s => s.trim()).filter(Boolean);
      await processCustomerList(codes, { nonInteractive: true, force: !!args.force });
      rl.close();
      return;
    }

    // If missing credentials and running non-interactively, error
    if (nonInteractive && (!CONFIG.username || !CONFIG.password || !CONFIG.companyID)) {
      throw new Error('Missing credentials/companyID for non-interactive run. Provide --username --password --companyID');
    }

    // Interactive mode: prompt for credentials if not provided
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
    console.error('Fatal error:', err.message || err);
    rl.close();
    process.exit(1);
  }
}

// invoke
if (require.main === module) {
  main();
}
