export type Env = {
  WP_URL: string;
  WC_KEY: string;
  WC_SECRET: string;
  BRITPART_BASE: string;     // ex: "https://www.britpart.com"
  BRITPART_TOKEN: string;

  // Valfria "tunables" för Britpart-klienten
  BRITPART_CONCURRENCY?: string | number; // ex: 4–8
  BRITPART_THROTTLE_MS?: string | number; // ex: 80–200 ms
};

export const env: Env = {
  WP_URL: process.env.WP_URL ?? "",
  WC_KEY: process.env.WC_KEY ?? "",
  WC_SECRET: process.env.WC_SECRET ?? "",
  BRITPART_BASE: process.env.BRITPART_BASE ?? "",
  BRITPART_TOKEN: process.env.BRITPART_TOKEN ?? "",

  // Valfria – saknas de används bra defaults i koden
  BRITPART_CONCURRENCY: process.env.BRITPART_CONCURRENCY,
  BRITPART_THROTTLE_MS: process.env.BRITPART_THROTTLE_MS,
};

// Kasta tydligt fel om något saknas
export function assertEnv(...keys: (keyof Env)[]) {
  const list = keys.length ? keys : (Object.keys(env) as (keyof Env)[]);
  for (const k of list) {
    if (!env[k]) throw new Error(`Missing env: ${k}`);
  }
}
