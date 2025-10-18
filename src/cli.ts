#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv, showConfigMasked, setEnvKey } from "./config";
import { fetchPyPiPackage } from "./pypi";
import { transformPyPiToPayload, pushUpdate } from "./updater";
import { runWebsites } from "./websites";

const pkg = { name: "ea-pip-updater", version: "0.1.0" };

async function main() {
  const program = new Command();
  program.name(pkg.name).version(pkg.version);

  program
    .command("sync <package>")
    .description("Fetch PyPI metadata for <package> and push to external API")
    .option("--dry-run", "Print payload instead of sending", false)
    .option("--format <fmt>", "Output: pretty|json", "pretty")
    .action(async (pkgName: string, opts: any) => {
      const env = loadEnv();
      console.log("Config:", showConfigMasked());
      try {
        console.log(`Fetching ${pkgName} from PyPI...`);
        const meta = await fetchPyPiPackage(pkgName);
        const payload = transformPyPiToPayload(meta);
        if (opts.dryRun) {
          if (opts.format === "json") console.log(JSON.stringify(payload));
          else console.log("Payload:", JSON.stringify(payload, null, 2));
          return;
        }
        console.log("Pushing update...");
        const res = await pushUpdate(payload, false);
        console.log("Result:", res);
      } catch (err: any) {
        console.error("Error:", err?.message || err);
        process.exit(1);
      }
    });

  program
    .command("websites")
    .description("Run Customer Website Bulk Updater (interactive or --file CSV)")
    .option("--file <path>", "CSV file with customer codes or code,website rows")
    .option("--username <user>", "API username for SOAP auth")
    .option("--password <pass>", "API password for SOAP auth")
    .option("--companyID <id>", "Company ID for SOAP auth")
    .option("--endpoint <url>", "SOAP endpoint URL")
    .option("--namespace <ns>", "SOAP namespace")
    .option("--codes <codes>", "Comma-separated customer codes")
    .option("--force", "Force overwrite existing website values")
    .option("--yes", "Assume yes for prompts (non-interactive)")
    .action(async (opts: any) => {
      try {
        await runWebsites({
          file: opts.file,
          username: opts.username,
          password: opts.password,
          companyID: opts.companyID,
          endpoint: opts.endpoint,
          namespace: opts.namespace,
          force: opts.force,
          yes: opts.yes,
          codes: opts.codes
        });
      } catch (err: any) {
        console.error('Error running websites:', err.message || err);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch(e => { console.error(e); process.exit(1); });

