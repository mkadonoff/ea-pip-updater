import * as https from 'https';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { loadEnv } from "./config";

export interface WebsitesOptions {
  file?: string;
  username?: string;
  password?: string;
  companyID?: string;
  endpoint?: string;
  namespace?: string;
  force?: boolean;
  yes?: boolean;
  codes?: string;
}

const env = loadEnv();
const DEFAULT_CONFIG = {
  endpoint: 'https://sfs.rpg.com/pip/PublicAPIService.asmx',
  namespace: 'http://digitalgateway.com/WebServices/PublicAPIService',
  username: env.EA_USERNAME || '',
  password: env.EA_PASSWORD || '',
  companyID: env.EA_COMPANYID || '',
  version: '25.0'
};

function createReadline() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((res) => rl.question(q, answer => res(answer)));
}

async function soapRequest(method: string, body: string, config: typeof DEFAULT_CONFIG): Promise<string> {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" \n               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" \n               xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <soap:Body>\n    <${method} xmlns="${config.namespace}">\n      <Auth>\n        <User>${config.username}</User>\n        <Password>${config.password}</Password>\n        <CompanyID>${config.companyID}</CompanyID>\n        <Version>${config.version}</Version>\n      </Auth>\n      ${body}\n    </${method}>\n  </soap:Body>\n</soap:Envelope>`;

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soapEnvelope),
        'SOAPAction': `${config.namespace}/${method}`
      }
    };

    const req = https.request(config.endpoint, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });

    req.on('error', reject);
    req.write(soapEnvelope);
    req.end();
  });
}

function parseXmlValue(xml: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}>\\s*<Value>([\\s\\S]*?)</Value>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlCode(xml: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}>[\\s\\S]*?<Code>\\s*<Value>([\\s\\S]*?)</Value>\\s*</Code>[\\s\\S]*?</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseXmlId(xml: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}>[\\s\\S]*?<ID>\\s*<Value>([\\s\\S]*?)</Value>\\s*</ID>[\\s\\S]*?</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

async function getCustomer(customerCode: string, config: typeof DEFAULT_CONFIG): Promise<any> {
  const body = `\n    <CustomerNumber>\n      <ID><Value>0</Value><Valid>false</Valid></ID>\n      <Code><Value>${customerCode}</Value><Valid>true</Valid></Code>\n    </CustomerNumber>`;

  const response = await soapRequest('getCustomer', body, config);

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

async function saveCustomerWebsite(customerId: string, customerCode: string, websiteUrl: string, config: typeof DEFAULT_CONFIG): Promise<boolean> {
  const body = `\n    <customer>\n      <CustomerNumber>\n        <ID><Value>${customerId}</Value><Valid>true</Valid></ID>\n        <Code><Value>${customerCode}</Value><Valid>true</Valid></Code>\n      </CustomerNumber>\n      <WebSite>\n        <Value>${websiteUrl}</Value>\n        <Valid>true</Valid>\n      </WebSite>\n    </customer>`;

  const response = await soapRequest('saveCustomer', body, config);
  if (response && response.toLowerCase().includes('savecustomerresult')) return true;
  return false;
}

function normalizeDomain(url?: string): string {
  if (!url) return '';
  url = url.trim();
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    let host = u.hostname;
    if (!host.startsWith('www.')) host = `www.${host}`;
    return host;
  } catch (e) {
    url = url.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0];
    if (!/^www\./i.test(url)) url = `www.${url}`;
    return url;
  }
}

function readCsvFile(filePath: string): Array<string | { code: string; website: string }> {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const rows: Array<string | { code: string; website: string }> = [];
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length === 1) rows.push(parts[0]);
    else rows.push({ code: parts[0], website: parts[1] || '' });
  }
  return rows;
}

async function processCustomer(customerCode: string, opts: { nonInteractive?: boolean; website?: string; force?: boolean }, config: typeof DEFAULT_CONFIG, rl?: readline.Interface): Promise<any> {
  try {
    const customer = await getCustomer(customerCode, config);

    console.log('\n--- Customer Information ---');
    console.log(`ID: ${customer.id}`);
    console.log(`Code: ${customer.code}`);
    console.log(`Name: ${customer.name}`);
    console.log(`Location: ${customer.city}, ${customer.state}`);
    console.log(`Phone: ${customer.phone}`);
    console.log(`Current Website: ${customer.currentWebsite || '(empty)'}`);
    console.log('---------------------------\n');

    if (customer.currentWebsite && customer.currentWebsite.trim() !== '' && !opts.force) {
      if (opts.nonInteractive) return { success: true, skipped: true };
      if (!rl) throw new Error('readline required for interactive prompts');
      const overwrite = await question(rl, `Website already exists. Overwrite? (y/n): `);
      if (overwrite.toLowerCase() !== 'y') return { success: true, skipped: true };
    }

    let websiteUrl = opts.website;
    if (!websiteUrl) {
      if (opts.nonInteractive) return { success: true, skipped: true };
      if (!rl) throw new Error('readline required for interactive prompts');
      websiteUrl = await question(rl, 'Enter website URL (or press Enter to skip): ');
    }

    if (!websiteUrl || websiteUrl.trim() === '') return { success: true, skipped: true };

    const normalizedUrl = normalizeDomain(websiteUrl);
    console.log(`Normalized URL: ${normalizedUrl}`);

    if (!opts.nonInteractive) {
      if (!rl) throw new Error('readline required for interactive prompts');
      const confirm = await question(rl, `Save this website? (y/n): `);
      if (confirm.toLowerCase() !== 'y') return { success: true, skipped: true };
    }

  // Avoid sending empty <Value> elements - use '0' for missing IDs and fallback to customerCode for missing Code
  const outId = (customer.id && customer.id.trim() !== '') ? customer.id : '0';
  const outCode = (customer.code && customer.code.trim() !== '') ? customer.code : customerCode;
  const saved = await saveCustomerWebsite(outId, outCode, normalizedUrl, config);
    if (saved) console.log('✓ Website updated successfully!');
    else console.log('✗ Failed to update website');
    return { success: saved, skipped: false };
  } catch (error: any) {
    console.error(`Error processing customer ${customerCode}: ${error.message}`);
    return { success: false, skipped: false, error: error.message };
  }
}

async function processCustomerList(customerCodes: Array<string | { code: string; website: string }>, opts: { nonInteractive?: boolean; force?: boolean }, config: typeof DEFAULT_CONFIG, rl?: readline.Interface) {
  const results = { total: customerCodes.length, updated: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < customerCodes.length; i++) {
    const item = customerCodes[i];
    const code = typeof item === 'string' ? item : item.code;
    const website = typeof item === 'object' ? item.website : undefined;

    console.log(`\n========================================`);
    console.log(`Processing ${i+1} of ${results.total}`);
    console.log(`========================================`);

    const res = await processCustomer(code, { nonInteractive: opts.nonInteractive, website, force: opts.force }, config, rl);
    if (res.skipped) results.skipped++; else if (res.success) results.updated++; else results.failed++;

    if (!opts.nonInteractive && i < customerCodes.length - 1) {
      if (!rl) throw new Error('readline required for interactive prompts');
      const cont = await question(rl, '\nContinue to next customer? (y/n): ');
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

export async function runWebsites(opts: WebsitesOptions = {}) {
  const config = { ...DEFAULT_CONFIG };
  if (opts.endpoint) config.endpoint = opts.endpoint;
  if (opts.namespace) config.namespace = opts.namespace;
  if (opts.username) config.username = opts.username;
  if (opts.password) config.password = opts.password;
  if (opts.companyID) config.companyID = opts.companyID;

  const nonInteractive = !!(opts.file || opts.codes || opts.yes);
  const rl = createReadline();

  try {
    if (opts.file) {
      const filePath = path.resolve(process.cwd(), opts.file);
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const rows = readCsvFile(filePath);
      console.log(`Loaded ${rows.length} rows from ${filePath}`);
      await processCustomerList(rows, { nonInteractive: true, force: !!opts.force }, config, rl);
      rl.close();
      return;
    }

    if (opts.codes) {
      const codes = opts.codes.split(',').map(s => s.trim()).filter(Boolean);
      await processCustomerList(codes, { nonInteractive: true, force: !!opts.force }, config, rl);
      rl.close();
      return;
    }

    if (nonInteractive && (!config.username || !config.password || !config.companyID)) {
      throw new Error('Missing credentials/companyID for non-interactive run. Provide --username --password --companyID');
    }

    if (!config.username) config.username = await question(rl, 'Enter username: ');
    if (!config.password) config.password = await question(rl, 'Enter password: ');
    if (!config.companyID) config.companyID = await question(rl, 'Enter company ID: ');

    const mode = await question(rl, '\nProcess (1) single customer or (2) multiple customers? Enter 1 or 2: ');
    if (mode === '1') {
      const customerCode = await question(rl, 'Enter customer code: ');
      await processCustomer(customerCode, { nonInteractive: false }, config, rl);
    } else if (mode === '2') {
      const codesInput = await question(rl, 'Enter customer codes (comma-separated): ');
      const customerCodes = codesInput.split(',').map(c => c.trim()).filter(c => c);
      await processCustomerList(customerCodes, { nonInteractive: false }, config, rl);
    } else {
      console.log('Invalid option.');
    }

    rl.close();
  } catch (err: any) {
    console.error('Fatal error:', err.message || err);
    rl.close();
    process.exit(1);
  }
}

// If run directly (rare when integrated), allow executing
if (require.main === module) {
  // very small adapter to parse simple args like --file
  const simpleArgs: WebsitesOptions = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2) as keyof WebsitesOptions;
      const next = argv[i+1];
      if (!next || next.startsWith('--')) { simpleArgs[key] = true as any; }
      else { simpleArgs[key] = next as any; i++; }
    }
  }
  runWebsites(simpleArgs).catch(e => { console.error(e); process.exit(1); });
}
