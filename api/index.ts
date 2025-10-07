// api/index.ts
import "./shared/secure-all";

// === Auth & health ===
import "./auth-login";
import "./auth-logout";
import "./auth-me";
import "./auth-diag";
import "./ping";

// === Produkt-CRUD ===
import "./products-list";
import "./products-update";
import "./products-delete";
import "./products-update-bulk";
import "./products-delete-bulk";

// === Britpart ===
import "./britpart-products";
import "./britpart-categories";
import "./britpart-subcategories";
import "./britpart-getall";
import "./britpart-probe";
import "./britpart-probe-categories";
import "./sync-britpart-categories";

// === WooCommerce ===
import "./wc-categories";
import "./wc-products-bulk";
import "./wc-products-verify";

// === Importflöden ===
import "./import-one";
import "./import-probe";
import "./import-dry-run";
import "./import-run";

// === Prisuppladdning ===
import "./price-upload";
import "./price-upload-from-blob";
import "./price-upload-probe";
import "./price-upload-sas";
