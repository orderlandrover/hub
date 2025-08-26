import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters } from "@azure/storage-blob";
// (valfritt ESM-vänligt import-namn)
import crypto from "node:crypto"; // <-- byt till node:crypto för NodeNext/ESM

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
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


      // Kräver att du sätter följande app settings:
      // STORAGE_ACCOUNT_NAME, STORAGE_ACCOUNT_KEY, STORAGE_CONTAINER (t.ex. "uploads")
      const accountName = process.env.STORAGE_ACCOUNT_NAME!;
      const accountKey  = process.env.STORAGE_ACCOUNT_KEY!;
      const container   = process.env.STORAGE_CONTAINER || "uploads";
      if (!accountName || !accountKey) {
        return { status: 500, jsonBody: { error: "Missing STORAGE_ACCOUNT_NAME/KEY" }, headers: CORS };
      }

      const cred = new StorageSharedKeyCredential(accountName, accountKey);
      const blobService = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, cred);

      // Se till att containern finns
      const cont = blobService.getContainerClient(container);
      await cont.createIfNotExists({ access: "container" });

      // Unikt blob-namn (datum + random)
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rand  = crypto.randomBytes(6).toString("hex");
      const blobName = `price/${stamp}-${rand}-${safeName}`;

      // SAS med write (PUT) + create och 30 min giltighet
      const startsOn  = new Date(Date.now() - 60_000);
      const expiresOn = new Date(Date.now() + 30 * 60_000);
      const perms = BlobSASPermissions.parse("cw"); // create+write
      const sas = generateBlobSASQueryParameters(
        { containerName: container, blobName, permissions: perms, startsOn, expiresOn },
        cred
      ).toString();

      const blobUrl = `https://${accountName}.blob.core.windows.net/${container}/${blobName}`;
      const sasUrl  = `${blobUrl}?${sas}`;

      return { status: 200, jsonBody: { ok: true, blobUrl, sasUrl }, headers: CORS };
    } catch (e: any) {
      return { status: 500, jsonBody: { error: e?.message || "price-upload-sas failed" }, headers: CORS };
    }
  }
});