export const env = {
  BRITPART_API_BASE: process.env.BRITPART_API_BASE as string,
  BRITPART_API_KEY: process.env.BRITPART_API_KEY as string,
  WP_URL: process.env.WP_URL as string,
  WC_KEY: process.env.WC_KEY as string,
  WC_SECRET: process.env.WC_SECRET as string,
};

export function assertEnv() {
  for (const [k, v] of Object.entries(env)) {
    if (!v) throw new Error(`Missing App Setting: ${k}`);
  }
}