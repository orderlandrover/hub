import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("products-delete",{
  methods:["POST"], authLevel:"anonymous",
  handler: async (req:HttpRequest, ctx:InvocationContext):Promise<HttpResponseInit>=>{
    try{
      assertEnv();
      const body = await req.json() as { ids:number[] };
      const ids = Array.isArray(body?.ids)?body.ids:[];
      if(ids.length===0) return {status:400, jsonBody:{error:"ids required"}};

      const pool=8; let i=0; const errors:{id:number;error:string}[]=[];
      async function worker(){ while(i<ids.length){ const id=ids[i++]; try{
        await wcRequest(`/products/${id}?force=true`,{method:"DELETE"});
      }catch(e:any){ errors.push({id, error:e?.message||"delete failed"});} } }
      await Promise.all(Array.from({length:Math.min(pool, ids.length)}, worker));

      return { jsonBody:{ ok:true, deleted: ids.length - errors.length, errors } };
    }catch(e:any){ ctx.error(e); return {status:500, jsonBody:{error:e.message}}; }
  }
});
