// api/index.ts
import "./ping";
import "./products-list";
import "./products-update";
import "./products-delete";
import "./products-update-bulk";
import "./products-delete-bulk";
import "./wc-categories";

import "./britpart-products";
import "./britpart-categories";
import "./britpart-getall";
import "./britpart-subcategories";  // <-- VIKTIGT: bindestreck

import "./import-one";
import "./import-dry-run";
import "./import-run";
import "./price-upload";

import "./price-upload-sas";
import "./price-upload-from-blob"; // om du använder den efter SAS-steget
import "./price-upload-probe"; 
import "./import-probe";
