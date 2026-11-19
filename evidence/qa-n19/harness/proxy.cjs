// Test-only link between this provider and the isolated API. No request headers are logged.
const http=require("http"),fs=require("fs"),path=require("path");
const out=path.resolve("evidence/qa-n19"),api="http://127.0.0.1:5021";
let offline=false, previousResult, disconnected;
const post=(url,headers,body)=>fetch(api+url,{method:"POST",headers,body});
http.createServer(async(req,res)=>{
 try {
  const parts=[];for await(const p of req) parts.push(p);const bytes=Buffer.concat(parts);
  const headers={...req.headers};delete headers.host;delete headers.connection; delete headers["content-length"];
  if(offline){res.destroy();return;}
  const options={method:req.method,headers};if(req.method!=="GET")options.body=bytes;
  const response=await fetch(api+req.url,options);const data=Buffer.from(await response.arrayBuffer());
  if(req.url.endsWith("/result") && response.ok && !previousResult){
    const repeat=await post(req.url,headers,bytes);const prior=JSON.parse(data).data;const next=(await repeat.json()).data;
    previousResult={headers,bytes};fs.writeFileSync(out+"/upload-retry.json",JSON.stringify({job:prior._id,status:repeat.status,originalHash:prior.resultHash,retriedHash:next?.resultHash}));
  }
  if(req.url.endsWith("/log") && bytes.includes("QA_DISCONNECT") && !disconnected){
    disconnected=Date.now();offline=true;
    const job=req.url.split("/").at(-2);
    fs.writeFileSync(out+"/disconnect-start.json",JSON.stringify({job,at:new Date()}));
    setTimeout(async()=>{try{
      const old={...previousResult.headers,"x-job-lease":headers["x-job-lease"],"x-worker-session":headers["x-worker-session"]};
      const stale=await post("/api/worker/jobs/"+job+"/result",old,previousResult.bytes);
      fs.writeFileSync(out+"/disconnect-end.json",JSON.stringify({job,offlineMs:Date.now()-disconnected,staleUpload:stale.status,reason:(await stale.json()).message}));
    }finally{offline=false;}},80000);
  }
  res.writeHead(response.status,{"content-type":response.headers.get("content-type")||"application/json"});res.end(data);
 }catch{res.destroy();}
}).listen(5022,"127.0.0.1");
