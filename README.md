# ea-pip-updater

CLI to fetch PyPI package metadata and push updates to an external API.

Quick start:

1. Copy your API settings to `.env` (see `.env.example`)
2. npm install
3. npm run dev -- sync <package> [--dry-run]

Commands

- `sync <package>`: fetches PyPI metadata and posts to configured API (dry-run by default)
- `websites`: (script provided under `scripts/update-websites.js`) bulk update PIP customer websites

