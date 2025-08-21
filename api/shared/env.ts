// api/shared/env.ts

// Enkel helper för att läsa miljövariabler (Azure App Settings eller local.settings.json)
export function env(name: string, required = true): string {
  const v = process.env[name];
  if (required && !v) throw new Error(`Missing env: ${name}`);
  return v ?? "";
}

// Kolla flera env samtidigt. Om keys utelämnas => kolla alla nedan.
export function assertEnv(...keys: string[]) {
  const all = {
    BRITPART_BASE: process.env.BRITPART_BASE ?? "",
    BRITPART_TOKEN: process.env.BRITPART_TOKEN ?? "",
  };

  const toCheck = keys.length ? keys : Object.keys(all);
  for (const k of toCheck) {
    const v = (all as Record<string, string>)[k];
    if (!v) throw new Error(`Missing App Setting: ${k}`);
  }
}