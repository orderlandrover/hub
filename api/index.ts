// api/index.ts
import "./shared/secure-all";  // MÅSTE vara först

// === Auth & health (måste alltid funka) ===
import "./auth-login";
import "./auth-logout";
import "./auth-me";
import "./auth-diag";
import "./ping";

// === Safe loader för resten (så hosten inte dör om en modul spricker) ===
type NodeRequire = NodeJS.Require;
// eval("require") undviker bundlers/cirklar vid build
const req: NodeRequire = eval("require");

function safe(mod: string) {
  try {
    req(mod); // laddar modulen synkront → registrerar endpoints
    console.log("[BOOT] OK:", mod);
  } catch (e: any) {
    console.error("[BOOT] DISABLED:", mod, "-", e?.message ?? e);
  }
}

// === Produkt-CRUD ===
safe("./products-list");
safe("./products-update");
safe("./products-delete");
safe("./products-update-bulk");
safe("./products-delete-bulk");

// === Britpart ===
safe("./britpart-products");
safe("./britpart-categories");
safe("./britpart-subcategories");
safe("./britpart-getall");
safe("./britpart-probe");
safe("./britpart-probe-categories");
safe("./sync-britpart-categories");

// === WooCommerce ===
safe("./wc-categories");
safe("./wc-products-bulk");
safe("./wc-products-verify");

// === Importflöden ===
safe("./import-one");
safe("./import-probe");
safe("./import-dry-run");
safe("./import-run");

// === Prisuppladdning ===
safe("./price-upload");
safe("./price-upload-from-blob");
safe("./price-upload-probe");
safe("./price-upload-sas");
