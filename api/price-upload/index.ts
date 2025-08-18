import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";
import * as XLSX from "xlsx";

type Row = {
  sku?: string|number; SKU?: string|number;
  pris?: string|number; Pris?: string|number; price?: string|number;
  lager?: string|number; Lager?: string|number; stock?: string|number;
  status?: "publish"|"draft"|"pending"|"private"|string; Status?: "publish"|"draft"|"pending"|"private"|string;
  kategori?: string|number; Kategori?: string|number;
};

const num = (v:any)=> (v===undefined||v===null||v==="") ? undefined : (n=>isFinite(n)?n:undefined)(Number(String(v).replace(",",".")));
const skuOf = (r:Row)=>{const s=r.sku ?? r.SKU; return s==null?undefined:String(s).trim();};
const stOf  = (r:Row)=>{const s=String(r.status??r.Status??"").toLowerCase(); return ["publish","draft","pending","private"].includes(s)?(s as any):undefined;};
const catOf = (r:Row)=>{const n=num(r.kategori??r.Kategori); return n&&n>0?n:undefined;};

app.http("price-upload",{
  methods:["POST"], authLevel:"anonymous",
  handler: async (req:HttpRequest, ctx:InvocationContext):Promise<HttpResponseInit>=>{
    try{
      assertEnv();
      const ab = (req as any).arrayBuffer ? await (req as any).arrayBuffer() : null;
      const buf = ab?Buffer.from(ab):Buffer.from(await req.text(),"base64");
      const wb  = XLSX.read(buf,{type:"buffer"});
      const ws  = wb.Sheets[wb.SheetNames[0]];
      if(!ws) return {status:400, jsonBody:{error:"Ingen sheet i Excel-filen."}};
      const rows = XLSX.utils.sheet_to_json<Row>(ws,{defval:""});

      let created=0, updated=0; const errors:{sku:string|undefined;error:string}[]=[];
      for(const r of rows){
        const sku = skuOf(r); if(!sku) continue;
        const price=num(r.pris??r.Pris??r.price);
        const stock=num(r.lager??r.Lager??r.stock);
        const status=stOf(r);
        const categoryId=catOf(r);

        try{
          const listRes = await wcRequest(`/products?sku=${encodeURIComponent(sku)}`);
          const list = await listRes.json();
          const patch:any = {};
          if(price!==undefined) patch.regular_price=String(price);
          if(stock!==undefined){ patch.manage_stock=true; patch.stock_quantity=stock; patch.stock_status=stock>0?"instock":"outofstock"; }
          if(status) patch.status=status;
          if(categoryId) patch.categories=[{id:categoryId}];

          if(list.length>0){
            const id=list[0].id;
            if(Object.keys(patch).length>0){
              await wcRequest(`/products/${id}`,{method:"PUT",body:JSON.stringify(patch)});
              updated++;
            }
          }else{
            const create:any={ name: sku, sku, status: status??"draft" };
            if(price!==undefined) create.regular_price=String(price);
            if(stock!==undefined){ create.manage_stock=true; create.stock_quantity=stock; create.stock_status=stock>0?"instock":"outofstock"; }
            if(categoryId) create.categories=[{id:categoryId}];
            await wcRequest(`/products`,{method:"POST",body:JSON.stringify(create)});
            created++;
          }
        }catch(e:any){ errors.push({sku, error:e?.message||"okänt fel"}); }
      }
      return { jsonBody:{ ok:true, created, updated, errors } };
    }catch(e:any){ ctx.error(e); return {status:500, jsonBody:{error:e.message}}; }
  }
});
