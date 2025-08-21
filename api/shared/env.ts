export const env = {
  // WooCommerce
  WP_URL: process.env.WP_URL as string,
  WC_KEY: process.env.WC_KEY as string,
  WC_SECRET: process.env.WC_SECRET as string,

  // Britpart
  BRITPART_TOKEN: process.env.BRITPART_TOKEN as string, // <— tokenen
  BRITPART_API_BASE: process.env.BRITPART_API_BASE as string | undefined, // valfri bas
  BRITPART_GETALL_URL: process.env.BRITPART_GETALL_URL as string | undefined, // ex: https://www.britpart.com/api/v1/part/getall
  BRITPART_GETCATEGORIES_URL: process.env.BRITPART_GETCATEGORIES_URL as string | undefined, // ex: https://www.britpart.com/api/v1/part/getall/categories
};

export function assertEnv() {
  const required = ["WP_URL", "WC_KEY", "WC_SECRET", "BRITPART_TOKEN"];
  for (const k of required) {
    if (!((env as any)[k])) throw new Error(`Missing App Setting: ${k}`);
  }
}