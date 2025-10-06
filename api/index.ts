// api/index.ts
import "./shared/secure-all"; // måste vara först

// AUTH
import "./auth-login/index";
import "./auth-logout/index";
import "./auth-me/index";

// HÄLSA
import "./ping/index";

// PRODUKTER (Woo)
import "./products-list/index";
import "./products-update/index";
import "./products-delete/index";
import "./products-update-bulk/index";
import "./products-delete-bulk/index";
import "./wc-categories/index";
import "./wc-products-bulk/index";
import "./wc-products-verify";        // fil, inte mapp

// BRITPART
import "./britpart-products/index";
import "./britpart-categories/index";
import "./britpart-getall/index";
import "./britpart-subcategories/index";
import "./britpart-probe/index";
import "./britpart-probe-categories/index";
// OBS: i din vy såg "sync-britpart-categories" ut som en FIL (inte mapp):
import "./sync-britpart-categories";  // <-- om det i stället är en mapp: byt till "/index"

// IMPORT/FILER
import "./import-one/index";
import "./import-dry-run/index";
import "./import-run/index";
import "./import-probe/index";
import "./price-upload/index";
import "./price-upload-sas/index";
import "./price-upload-from-blob/index";
import "./price-upload-probe/index";
