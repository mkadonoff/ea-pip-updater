import axios from "axios";
import { loadEnv } from "./config";

export function transformPyPiToPayload(meta: any) {
  return {
    name: meta.info.name,
    version: meta.info.version,
    summary: meta.info.summary || "",
    home_page: meta.info.home_page || "",
    releases: Object.keys(meta.releases || {}),
    raw: meta
  };
}

export async function pushUpdate(payload: any, dryRun = true) {
  const env = loadEnv();
  const base = env.API_BASE_URL || "https://example.api";
  const key = env.API_KEY;
  if (dryRun) {
    return { ok: true, payload };
  }
  if (!key) throw new Error("API_KEY not set in environment");
  const res = await axios.post(`${base}/packages/update`, payload, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    validateStatus: () => true
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data };
}
