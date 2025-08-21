export const env = {
  WP_URL: process.env.WP_URL ?? "",
  WC_KEY: process.env.WC_KEY ?? "",
  WC_SECRET: process.env.WC_SECRET ?? "",
  BRITPART_BASE: process.env.BRITPART_BASE ?? "",   // ska vara "https://www.britpart.com"
  BRITPART_TOKEN: process.env.BRITPART_TOKEN ?? ""
};

// Kasta tydligt fel om något saknas
export function assertEnv(...keys: (keyof typeof env)[]) {
  const list = keys.length ? keys : (Object.keys(env) as (keyof typeof env)[]);
  for (const k of list) {
    if (!env[k]) throw new Error(`Missing env: ${k}`);
  }
}