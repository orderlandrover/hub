import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("wc-categories",{
  methods:["GET"], authLevel:"anonymous",
  handler: async (_req:HttpRequest, ctx:InvocationContext):Promise<HttpResponseInit>=>{
    try{
      assertEnv();
      const out:any[]=[]; let page=1;
      while(true){
        const res = await wcRequest(`/products/categories?per_page=100&hide_empty=false&page=${page}`);
        const items = await res.json();
        out.push(...items);
        const totalPages = Number(res.headers.get("x-wp-totalpages")||1);
        if(page>=totalPages) break;
        page++;
      }
      return { jsonBody:{ items: out } };
    }catch(e:any){ ctx.error(e); return {status:500, jsonBody:{error:e.message}}; }
  }
});
