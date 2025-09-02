import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import crypto from "node:crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

app.http("price-upload-sas", {
  route: "price-upload-sas",
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };

    try {
      const body = (await req.json().catch(() => ({}))) as { filename?: string };
      const safeName = String(body.filename || "prices.csv").replace(/[^\w.\-]/g, "_");

      // App settings i SWA:
      // STORAGE_ACCOUNT_NAME, STORAGE_ACCOUNT_KEY, STORAGE_CONTAINER
      const accountName = process.env.STORAGE_ACCOUNT_NAME!;
      const accountKey = process.env.STORAGE_ACCOUNT_KEY!;
      const container = process.env.STORAGE_CONTAINER || "uploads";
      if (!accountName || !accountKey) {
        return {
          status: 500,
          headers: CORS,
          jsonBody: { ok: false, error: "Missing STORAGE_ACCOUNT_NAME/KEY" },
        };
      }

      const cred = new StorageSharedKeyCredential(accountName, accountKey);
      const blobService = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        cred
      );

      // Privat container (ingen public access)
      const cont = blobService.getContainerClient(container);
      await cont.createIfNotExists();

      // Unikt blobnamn
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rand = crypto.randomBytes(6).toString("hex");
      const blobName = `price/${stamp}-${rand}-${safeName}`;
      const blobUrl = `https://${accountName}.blob.core.windows.net/${container}/${blobName}`;

      // SAS endast för PUT (create+write), 30 min
      const startsOn = new Date(Date.now() - 60_000);
      const expiresOn = new Date(Date.now() + 30 * 60_000);
      const perms = BlobSASPermissions.parse("cw");

      const sas = generateBlobSASQueryParameters(
        { containerName: container, blobName, permissions: perms, startsOn, expiresOn },
        cred
      ).toString();

      const sasUrl = `${blobUrl}?${sas}`;

      return {
        status: 200,
        headers: CORS,
        jsonBody: { ok: true, container, blobName, blobUrl, sasUrl },
      };
    } catch (e: any) {
      return {
        status: 500,
        headers: CORS,
        jsonBody: { ok: false, error: e?.message || "price-upload-sas failed" },
      };
    }
  },
});
