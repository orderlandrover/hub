import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { assertEnv } from "../shared/env";
import { wcRequest } from "../shared/wc";

app.http("import-one",{
  methods:["POST"], authLevel:"anonymous",
  handler: async (req:HttpRequest, ctx:InvocationContext):Promise<HttpResponseInit>=>{
    try{
      assertEnv();
      const b = await req.json() as {
        sku:string, name?:string, description?:string,
        price?:number, stock?:number, status?:"publish"|"draft"|"pending"|"private",
        categoryId?:number
      };
      if(!b?.sku) return {status:400, jsonBody:{error:"sku required"}};

      const list = await (await wcRequest(`/products?sku=${encodeURIComponent(b.sku)}`)).json();
      const patch:any={};
      if(b.name) patch.name=b.name;
      if(b.description) patch.description=b.description;
      if(b.price!=null) patch.regular_price=String(b.price);
      if(b.stock!=null){ patch.manage_stock=true; patch.stock_quantity=b.stock; patch.stock_status=b.stock>0?"instock":"outofstock";}
      if(b.status) patch.status=b.status;
      if(b.categoryId) patch.categories=[{id:b.categoryId}];

      if(list.length>0){
        const id=list[0].id;
        const res=await wcRequest(`/products/${id}`,{method:"PUT",body:JSON.stringify(patch)});
        return { jsonBody:{ ok:true, action:"update", item: await res.json() } };
      }else{
        const create={ sku:b.sku, name:b.name??b.sku, status:b.status??"draft", ...patch };
        const res=await wcRequest(`/products`,{method:"POST",body:JSON.stringify(create)});
        return { jsonBody:{ ok:true, action:"create", item: await res.json() } };
      }
    }catch(e:any){ ctx.error(e); return {status:500, jsonBody:{error:e.message}}; }
  }
});
