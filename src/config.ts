import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const ENV_PATH = path.join(process.cwd(), ".env");

export function loadEnv() {
  const parsed = dotenv.config({ path: ENV_PATH });
  if (parsed.error) {
    return process.env as any;
  }
  return { ...process.env, ...(parsed.parsed ?? {}) } as any;
}

export function showConfigMasked() {
  const env = loadEnv();
  return {
    API_KEY: env.API_KEY ? `***${String(env.API_KEY).slice(-4)}` : "(not set)",
    API_BASE_URL: env.API_BASE_URL || "(not set)"
  };
}

export function setEnvKey(key: string, value: string) {
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const idx = lines.findIndex(l => l.startsWith(key + "="));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n"), { mode: 0o600 });
}
