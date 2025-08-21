export const env = {
  BRITPART_BASE: process.env.BRITPART_BASE ?? "",
  BRITPART_TOKEN: process.env.BRITPART_TOKEN ?? "",
  WC_KEY: process.env.WC_KEY ?? "",
  WC_SECRET: process.env.WC_SECRET ?? "",
  WP_URL: process.env.WP_URL ?? "", // om du inte använder WC just nu kan denna vara tom
};

// Kan anropas utan argument (kolla alla) eller med lista av nycklar.
export function assertEnv(...keys: (keyof typeof env)[]) {
  const toCheck = keys.length ? keys : (Object.keys(env) as (keyof typeof env)[]);
  for (const k of toCheck) {
    const v = env[k];
    if (!v) throw new Error(`Missing App Setting: ${k}`);
  }
}