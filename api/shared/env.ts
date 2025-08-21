export const env = {
  // WooCommerce
  WP_URL: process.env.WP_URL as string,
  WC_KEY: process.env.WC_KEY as string,
  WC_SECRET: process.env.WC_SECRET as string,

  // Britpart
  BRITPART_TOKEN: process.env.BRITPART_TOKEN as string,
  // Bas-URL utan efterföljande / – vi bygger hela sökvägen i helpers nedan
  BRITPART_BASE: (process.env.BRITPART_BASE as string) || "https://www.britpart.com",
};

export function assertEnv() {
  for (const [k, v] of Object.entries(env)) {
    if (!v) throw new Error(`Missing App Setting: ${k}`);
  }
}