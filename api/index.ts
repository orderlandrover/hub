// api/index.ts
import "./shared/secure-all";        // <-- must be first to wrap app.http


// AUTH (läggs tidigt så de finns)
import "./auth-login";
import "./auth-logout";
import "./auth-me";


import "./ping";
import "./products-list";
import "./products-update";
import "./products-delete";
import "./products-update-bulk";
import "./products-delete-bulk";
import "./wc-categories";
import "./wc-products-bulk";

import "./britpart-products";
import "./britpart-categories";
import "./britpart-getall";
import "./britpart-subcategories";  // <-- VIKTIGT: bindestreck
import "./sync-britpart-categories";
import "./britpart-probe-categories";

import "./import-one";
import "./import-dry-run";
import "./import-run";
import "./price-upload";

import "./price-upload-sas";
import "./price-upload-from-blob"; 
import "./price-upload-probe"; 
import "./import-probe";



