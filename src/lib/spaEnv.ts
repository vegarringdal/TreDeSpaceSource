// Runtime config: a static host may serve a /spa-env.json (e.g. generated at
// deploy time from SPA_INJECT* env vars). Loaded once before the app renders;
// a missing file (npm run dev, plain static hosting) just means an empty config.

let env: Record<string, string> = {};

/** The known injection keys — every field is null until the container provides
 *  it, so code can feature-gate on `spaConfig().SPA_INJECT_… !== null`. */
export interface SpaConfig {
  /** Entra ID (Azure AD) app registration. */
  SPA_INJECT_ENTRAID_CLIENT_ID: string | null;
  SPA_INJECT_ENTRAID_TENANT_ID: string | null;
  SPA_INJECT_ENTRAID_SCOPE: string | null;
  /** Help/links. */
  SPA_INJECT_WIKI_URL: string | null;
  SPA_INJECT_TEAMS_URL: string | null;
  /** Telemetry (Application Insights). */
  SPA_INJECT_APPLICATION_INSIGHT_URL: string | null;
  /** API that hands out access tokens. */
  SPA_INJECT_ACCESS_API_URL: string | null;
  /** Azure storage account (container domain). */
  SPA_INJECT_AZURE_STORAGE_NAME: string | null;
  /** Project container + file within the storage account. */
  SPA_INJECT_AZURE_PROJECT_CONTAINER: string | null;
  SPA_INJECT_AZURE_PROJECT_FILE: string | null;
}

const DEFAULTS: SpaConfig = {
  SPA_INJECT_ENTRAID_CLIENT_ID: null,
  SPA_INJECT_ENTRAID_TENANT_ID: null,
  SPA_INJECT_ENTRAID_SCOPE: null,
  SPA_INJECT_WIKI_URL: null,
  SPA_INJECT_TEAMS_URL: null,
  SPA_INJECT_APPLICATION_INSIGHT_URL: null,
  SPA_INJECT_ACCESS_API_URL: null,
  SPA_INJECT_AZURE_STORAGE_NAME: null,
  SPA_INJECT_AZURE_PROJECT_CONTAINER: null,
  SPA_INJECT_AZURE_PROJECT_FILE: null,
};

let config: SpaConfig = { ...DEFAULTS };

/** Fetch /spa-env.json once at boot (called from main.tsx before render). */
export async function loadSpaEnv(): Promise<void> {
  try {
    const res = await fetch('./spa-env.json', { cache: 'no-store' });
    if (res.ok) {
      env = (await res.json()) as Record<string, string>;
    }
  } catch {
    // not running in the container — no runtime config
  }
  const merged: SpaConfig = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof SpaConfig)[]) {
    if (env[key] !== undefined && env[key] !== '') {
      merged[key] = env[key];
    }
  }
  config = merged;
}

/** The known keys, typed — each is null unless the container injected it. */
export function spaConfig(): Readonly<SpaConfig> {
  return config;
}

/** All injected variables (keys keep their full SPA_INJECT… name). */
export function spaEnv(): Readonly<Record<string, string>> {
  return env;
}

/** One injected variable, e.g. spaEnvGet('SPA_INJECT_API'). */
export function spaEnvGet(key: string): string | undefined {
  return env[key];
}
