const fs=require("fs"),a=require("node:assert/strict"),users=require("./users.json");
const base="http://127.0.0.1:5021/api",wait=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,token,body,method=body?"POST":"GET"){
 const r=await fetch(base+route,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:body&&JSON.stringify(body)});
 const obj=await r.json();a.ok(r.ok,route+" "+obj.message);return obj.data??obj;
}
(async()=>{
 const c=(await api("/auth/login",null,users.consumer)).token,p=(await api("/auth/login",null,users.provider)).token;
 const slot=(await api("/gpus?mine=true",p)).find(x=>x.agentId);
 const share=enabled=>api("/agents/slots/"+slot._id,p,{enabled,rate:"12345"},"PUT");
 const spec={source:"import time\ntime.sleep(4)\nopen('done','w').write('ok')",outputs:["done"],profile:"python-cpu",seconds:30};
 const pair=await Promise.all([api("/batch/jobs",c,spec),api("/batch/jobs",c,spec)]);
 const jobs=()=>Promise.all(pair.map(j=>api("/jobs/"+j._id,c)));
 await Promise.all(pair.map(j=>api("/jobs/"+j._id+"/fund",c,{})));
 async function until(pred){for(let i=0;i<220;i++){const j=await jobs();if(pred(j))return j;await wait(400);}throw Error("Timed out waiting for state");}
 const running=await until(j=>j.some(x=>x.status==="RUNNING"));const first=running.find(x=>x.status==="RUNNING")._id;
 let paused;try{await share(false);await until(j=>j.find(x=>x._id===first).status==="REVIEW");
 await wait(7000);paused=await jobs();a.equal(paused.find(x=>x._id!==first).status,"QUEUED");a.equal(paused.find(x=>x._id!==first).receipts.some(x=>x.action==="JobAssigned"),false);
 }finally{await share(true);}
 await until(j=>j.every(x=>x.status==="REVIEW"));
 for(const j of pair)await api("/jobs/"+j._id+"/review",c,{decision:"accept"});
 const done=await jobs();const chronological=done.sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));for(const j of done)a.equal(j.status,"COMPLETED");
 fs.writeFileSync("evidence/qa-n19/drain.json",JSON.stringify({observedAfterSevenSeconds:paused.map(j=>({id:j._id,status:j.status})),jobs:chronological.map(j=>({id:j._id,started:j.startedAt,slot:j.gpuId._id,payment:j.receipts.find(v=>v.action==="PaymentReleased").txHash}))},null,2));console.log("PASS funded waiter remained queued across two scheduler ticks while paused");
})().catch(e=>{console.error(e.message);process.exitCode=1});
