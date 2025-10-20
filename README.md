# Enhanced Customer Website Updater

Automated tool to find and update customer website URLs in e-automate via the PIP API.

## Features

**Three-Tier Search Strategy:**
1. **Smart Domain Guessing** (FREE, fast) - Tries common domain patterns with DNS validation
2. **Google Custom Search** (optional) - Enhanced search with result scoring
3. **OpenAI API** (optional) - AI-powered search as fallback

## Installation

```bash
npm install
```

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

## Configuration

### Required (e-automate credentials):
```env
EA_USERNAME=your_username
EA_PASSWORD=your_password
EA_COMPANYID=your_company_id
```

### Optional (Search APIs):
```env
# Google Custom Search (Tier 2)
GOOGLE_CSE_KEY=your_key
GOOGLE_CX=your_cx_id

# OpenAI (Tier 3 - disabled by default)
OPENAI_API_KEY=your_key
ENABLE_OPENAI=true
OPENAI_MODEL=gpt-4o-mini
```

## Usage

### Interactive Mode

Process customers one at a time with prompts:

```bash
node scripts/update-websites.js
```

### Single Customer

```bash
node scripts/update-websites.js --codes WE01
```

### Multiple Customers

```bash
node scripts/update-websites.js --codes "WE01,4W00,ABC123"
```

### Batch Mode with CSV

Create a CSV file (`customers.csv`):
```csv
WE01
4W00
ABC123
```

Run in non-interactive mode:
```bash
node scripts/update-websites.js --file customers.csv --yes
```

With output results:
```bash
node scripts/update-websites.js --file customers.csv --yes --output results.csv
```

### Enable OpenAI Fallback

```bash
node scripts/update-websites.js --enable-openai --file customers.csv --yes
```

Or set in `.env`:
```env
ENABLE_OPENAI=true
```

### Force Override Existing Websites

```bash
node scripts/update-websites.js --file customers.csv --force --yes
```

## Command Line Options

### Credentials
- `--username` - e-automate username
- `--password` - e-automate password
- `--companyID` - e-automate company ID

### Input Methods
- `--codes "CODE1,CODE2"` - Process specific customer codes
- `--file customers.csv` - Process customers from CSV file
- `--interactive` - Force interactive prompts even with file

### Search Configuration
- `--enable-openai` - Enable OpenAI as fallback search
- `--disable-domain-guessing` - Skip domain guessing tier
- `--disable-google` - Skip Google search tier
- `--openai-model gpt-4o` - Specify OpenAI model
- `--openai-key KEY` - OpenAI API key (alternative to .env)
- `--google-key KEY` - Google API key (alternative to .env)
- `--google-cx CX` - Google Custom Search CX (alternative to .env)

### Behavior
- `--yes` - Auto-confirm all updates (non-interactive)
- `--force` - Overwrite existing websites without asking
- `--output results.csv` - Write results to CSV file
- `--debug` - Show detailed SOAP requests/responses
- `--force-www` - Always add www. prefix (default: true)
- `--no-force-www` - Don't force www. prefix

## How It Works

### Tier 1: Smart Domain Guessing (FREE, ~70% success rate)

Tries common domain patterns:
- Company name cleaned: `4Print Wraps, Inc.` → `4printwraps.com`
- Hyphenated: `4-print-wraps.com`
- Without numbers: `printwraps.com`
- City prefixed: `glenburnie4printwraps.com`

Each pattern is validated with:
1. DNS lookup (does domain exist?)
2. HTTP check (does website respond?)

### Tier 2: Google Custom Search (Optional)

Enhanced Google search with:
- Multiple results analyzed (top 5)
- Intelligent scoring system
- Filters out social media and directories
- Confidence levels (high/medium/low)

### Tier 3: OpenAI Fallback (Optional)

Uses GPT models to:
- Search and analyze results
- Make intelligent domain matches
- Handle complex/unusual company names
- Return confidence assessment

## Search Method Selection

By default, all enabled search methods run in sequence until a match is found:

```
Domain Guessing → Google CSE → OpenAI → Manual Entry
```

You can disable specific tiers:

```bash
# Only use domain guessing
node scripts/update-websites.js --disable-google --file customers.csv --yes

# Skip domain guessing, use Google + OpenAI
node scripts/update-websites.js --disable-domain-guessing --enable-openai --file customers.csv --yes
```

## Cost Estimates (for 11,000 customers)

### Tier 1: Domain Guessing
- **Cost:** FREE
- **Success Rate:** ~60-70%
- **Time:** ~1-2 hours

### Tier 2: Google Custom Search
- **Cost:** $5 per 1,000 queries (~$20-40 for remaining customers)
- **Success Rate:** ~80-85%
- **Time:** ~2-3 hours

### Tier 3: OpenAI
- **Cost with gpt-4o-mini:** ~$0.001 per query (~$3-10 for remaining)
- **Cost with gpt-4o:** ~$0.01 per query (~$30-100 for remaining)
- **Success Rate:** ~85-90%
- **Time:** ~3-4 hours

### Recommended Strategy for 11k Customers:

```bash
node scripts/update-websites.js \
  --file all-customers.csv \
  --enable-openai \
  --openai-model gpt-4o-mini \
  --yes \
  --output results.csv
```

**Expected Results:**
- Tier 1 (Domain Guessing): ~7,000 found (FREE)
- Tier 2 (Google CSE): ~3,000 found (~$15)
- Tier 3 (OpenAI): ~800 found (~$1)
- Manual review: ~200 remaining

**Total Cost:** ~$16  
**Total Time:** 2-4 hours  
**Success Rate:** ~98%

## Output Files

When using `--output results.csv`, you'll get:

```csv
code,status,url,error
WE01,updated,www.webowers.com,
4W00,updated,www.4printus.com,
ABC123,skipped,,website already exists
XYZ999,failed,,HTTP 500: Invalid customer code
```

## Troubleshooting

### "Missing credentials" error
- Ensure `.env` file exists with EA_USERNAME, EA_PASSWORD, EA_COMPANYID
- Or pass via CLI: `--username user --password pass --companyID id`

### Google CSE returns no results
- Verify GOOGLE_CSE_KEY and GOOGLE_CX are correct
- Check API quota at https://console.cloud.google.com
- Try with `--debug` to see full responses

### OpenAI not working
- Verify OPENAI_API_KEY is set
- Enable with `--enable-openai` or `ENABLE_OPENAI=true` in .env
- Check API quota at https://platform.openai.com/usage

### Domain guessing too slow
- Adjust timeouts in code (CONFIG.dnsTimeout, CONFIG.httpTimeout)
- Or disable: `--disable-domain-guessing`

### Rate limiting
- Add delays between requests if hitting API limits
- Process in smaller batches
- Use `--debug` to see which API is rate-limiting

## Examples

### Test with single customer:
```bash
node scripts/update-websites.js --codes WE01 --debug
```

### Process 10 customers with OpenAI:
```bash
node scripts/update-websites.js --codes "WE01,4W00,ABC1,ABC2,ABC3,ABC4,ABC5,ABC6,ABC7,ABC8" --enable-openai --yes
```

### Bulk update with all features:
```bash
node scripts/update-websites.js \
  --file customers.csv \
  --enable-openai \
  --openai-model gpt-4o-mini \
  --yes \
  --output results.csv
```

### Overwrite all existing websites:
```bash
node scripts/update-websites.js --file customers.csv --force --yes
```

### Interactive review mode (best for first run):
```bash
node scripts/update-websites.js --file customers.csv --interactive
```

## Best Practices

1. **Start small:** Test with 5-10 customers first
2. **Review results:** Check `results.csv` before bulk processing
3. **Use tiers strategically:** Domain guessing first (free), then paid APIs
4. **Set budgets:** Monitor API costs, set limits in cloud console
5. **Backup data:** Export customer list before bulk updates
6. **Manual review:** Always review low-confidence matches

## Support

For issues with the e-automate PIP API, contact your e-automate support team.

For issues with this tool, check the debug output with `--debug` flag.