// api/shared/env.ts
export const env = {
  BRITPART_BASE: process.env.BRITPART_BASE as string,
  BRITPART_TOKEN: process.env.BRITPART_TOKEN as string,
  WP_URL: process.env.WP_URL as string,
  WC_KEY: process.env.WC_KEY as string,
  WC_SECRET: process.env.WC_SECRET as string,
};

/**
 * Validera att nödvändiga App Settings finns.
 * - Utan argument: kolla ALLA.
 * - Med argument: kolla bara de angivna nycklarna.
 */
export function assertEnv(...keys: (keyof typeof env)[]) {
  const toCheck = keys.length ? keys : (Object.keys(env) as (keyof typeof env)[]);
  for (const k of toCheck) {
    if (!env[k] || String(env[k]).trim() === "") {
      throw new Error(`Missing App Setting: ${k}`);
    }
  }
}