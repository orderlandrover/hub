import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import crypto from "node:crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

app.http("price-upload-sas", {
  route: "price-upload-sas",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 204, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as { filename?: string };
      const safeName = String(body.filename || "prices.csv").replace(/[^\w.\-]/g, "_");

      const accountName = process.env.STORAGE_ACCOUNT_NAME!;
      const accountKey  = process.env.STORAGE_ACCOUNT_KEY!;
      const container   = process.env.STORAGE_CONTAINER || "pricelistupload";
      if (!accountName || !accountKey) {
        return { status: 500, headers: CORS, jsonBody: { ok: false, error: "Missing STORAGE_ACCOUNT_NAME/KEY" } };
      }

      const cred = new StorageSharedKeyCredential(accountName, accountKey);
      const svc  = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, cred);

      // privat container (ingen public access)
      const cont = svc.getContainerClient(container);
      await cont.createIfNotExists();

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rand  = crypto.randomBytes(6).toString("hex");
      const blobName = `price/${stamp}-${rand}-${safeName}`;

      // SAS för create + write (30 min)
      const startsOn  = new Date(Date.now() - 60_000);
      const expiresOn = new Date(Date.now() + 30 * 60_000);
      const perms = BlobSASPermissions.parse("cw");
      const sas = generateBlobSASQueryParameters(
        { containerName: container, blobName, permissions: perms, startsOn, expiresOn },
        cred
      ).toString();

      const blobUrl = `https://${accountName}.blob.core.windows.net/${container}/${blobName}`;
      const sasUrl  = `${blobUrl}?${sas}`;

      return {
        status: 200,
        headers: CORS,
        jsonBody: { ok: true, container, blobName, blobUrl, sasUrl },
      };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: e?.message || "price-upload-sas failed" } };
    }
  },
});
