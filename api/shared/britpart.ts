import { env } from "./env";

/**
 * Bygg korrekt URL mot Britparts "getall".
 * - BRITPART_API_BASE ska vara t.ex. "https://www.britpart.com/api/v1/part/getall"
 * - queryOrPath kan vara "?subcategory=44" eller "/parts?subcategory=44"
 *   ("/parts?" normaliseras till bara "?").
 * - Lägger alltid på token som query-param och skickar även Token-header.
 */
function buildBritpartUrl(queryOrPath: string): string {
  const base = (env.BRITPART_API_BASE || "").replace(/\/+$/, ""); // utan trailing slash
  let suffix = String(queryOrPath || "");

  // Normalisera "/parts?x=y" → "?x=y" för att undvika ".../getall/parts?..."
  if (suffix.startsWith("/parts?")) {
    suffix = "?" + suffix.split("?")[1];
  }

  // Se till att vi har en ?-del
  if (!suffix.startsWith("?")) {
    // om någon skickar tomt eller annat, gör den till tom query
    suffix = suffix ? `?${suffix.replace(/^\?/, "")}` : "?";
  }

  // Lägg på token som queryparam (oavsett om den redan finns)
  const hasQuery = suffix.includes("?");
  const sep = hasQuery ? "&" : "?";
  const withToken = `${suffix}${suffix.includes("token=") ? "" : `${sep}token=${encodeURIComponent(env.BRITPART_API_KEY || "")}`}`;

  return `${base}${withToken}`;
}

/**
 * Anropa Britpart "getall" med Token-header + token query-param.
 * Kastar tydligt felmeddelande om status != 2xx.
 */
export async function britpart(queryOrPath: string, init: RequestInit = {}) {
  if (!env.BRITPART_API_BASE) {
    throw new Error("Missing App Setting: BRITPART_API_BASE");
  }
  if (!env.BRITPART_API_KEY) {
    throw new Error("Missing App Setting: BRITPART_API_KEY");
  }

  const url = buildBritpartUrl(queryOrPath);

  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      // Britpart vill ha Token-header (inte Authorization)
      Token: env.BRITPART_API_KEY,
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    // gör felet lättare att läsa i loggen
    const body = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    throw new Error(`Britpart ${res.status} ${res.statusText}: ${body}`);
  }

  return res;
}