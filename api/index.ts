// api/index.ts
import "./shared/secure-all";          // måste vara först

// === öppna/auth endpoints som ska fungera nu ===
import "./auth-login";
import "./auth-logout";
import "./auth-me";
import "./ping";

// === ALLT nedan AV för tillfället (orsakar crash i Node 18) ===
// import "./products-list";
// import "./products-update";
// import "./products-delete";
// import "./products-update-bulk";
// import "./products-delete-bulk";
// import "./wc-categories";
// import "./wc-products-bulk";
// import "./britpart-products";
// import "./britpart-categories";
// import "./britpart-getall";
// import "./britpart-subcategories";
// import "./sync-britpart-categories";
// import "./britpart-probe-categories";
// import "./import-one";
// import "./import-dry-run";
// import "./import-run";
// import "./price-upload";
// import "./price-upload-sas";
// import "./price-upload-from-blob";
// import "./price-upload-probe";
// import "./import-probe";
