import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

app.http("price-upload-probe", {
  route: "price-upload-probe",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === "OPTIONS") return { status: 200, headers: CORS };
    try {
      const c = req.query.get("c")!;
      const b = req.query.get("b")!;
      const accountName = process.env.STORAGE_ACCOUNT_NAME!;
      const accountKey  = process.env.STORAGE_ACCOUNT_KEY!;
      const cred = new StorageSharedKeyCredential(accountName, accountKey);
      const svc  = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, cred);
      const blob = svc.getContainerClient(c).getBlobClient(b);
      const exists = await blob.exists();
      if (!exists) return { status: 404, headers: CORS, jsonBody: { ok: false, error: "not_found" } };
      const props = await blob.getProperties();
      return { status: 200, headers: CORS, jsonBody: { ok: true, size: props.contentLength, type: props.contentType } };
    } catch (e: any) {
      return { status: 500, headers: CORS, jsonBody: { ok: false, error: e?.message || String(e) } };
    }
  }
});
