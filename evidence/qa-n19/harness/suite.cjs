module.exports=async({c,p,post,get,job,waitJob,call,ct,pt,ot,slot,root,out,source,spec,outputs,contract,expiry,record,save,shot,wait,buttons,sha,A,fs,path,users,rpc})=>{
 const scenario=async(name,fn)=>{try{const details=await fn();record(name,"PASS",details||{});}catch(e){record(name,"FAIL",{reason:e.message.substring(0,480)});}};
 const state=(j)=>contract.getJob(j.blockchainJobId);
 const getSlots=async()=>get("/gpus?mine=true",pt);
 const slotId=(await getSlots()).find(s=>s.agentId)._id;
 const share=enabled=>call("/agents/slots/"+slotId,{method:"PUT",token:pt,body:{enabled,rate:"12345"}});
 const funds=id=>post("/jobs/"+id+"/fund");const accept=id=>post("/jobs/"+id+"/review",{decision:"accept"});
 const form=async(code,files,time,upload)=>{
  await c.goto(root+"/consumer");await c.getByLabel("Workload",{exact:true}).selectOption("script");
  if(upload)await c.getByLabel("Upload Python file").setInputFiles({name:"qa.py",mimeType:"text/plain",buffer:Buffer.from(code)});
  else await c.getByLabel("Python source").fill(code);
  await c.getByLabel("Expected output filenames",{exact:false}).fill(files.join(", "));await c.getByLabel("Time limit in seconds").fill(String(time));
  const response=c.waitForResponse(r=>r.url().endsWith("/batch/jobs"));await buttons(c,"Save and quote").click();
  const j=(await (await response).json()).data;A.equal(j.escrowAmountWei,"12345");return j;
 };
 const ui=async(status)=>c.getByText("Python batch · "+status,{exact:true}).waitFor({timeout:120000});
 const events=(j,name)=>contract.queryFilter(contract.filters[name](j.blockchainJobId));
 async function terminal(j,type){
  const logs=await events(j,type);A.equal(logs.length,1);const r=await rpc.getTransactionReceipt(logs[0].transactionHash);A.equal(r.status,1);
  A.equal(r.hash,j.receipts.find(v=>v.action===type).txHash);A.equal(logs[0].args.amount.toString(),j.escrowAmountWei);
  const provider=(await state(j)).provider;
  if(type==="PaymentReleased"){A.equal(logs[0].args.provider.toLowerCase(),users.provider.walletAddress.toLowerCase());A.equal(provider.toLowerCase(),users.provider.walletAddress.toLowerCase());}
  A.notEqual((await getSlots()).find(v=>v._id===slotId)?.activeJob,j._id);
  return {id:j._id,amountWei:j.escrowAmountWei,tx:r.hash,provider,reason:j.error,exit:j.resultMetadata?.exitCode};
 }
 let primary;
 await scenario("Uploaded Python in two browsers, downloaded outputs and accepted payment",async()=>{
  primary=await form(source,outputs,45,true);const id=primary._id;await shot(c,"02-consumer-submission");
  const providerJobs=await p.context().newPage();await providerJobs.goto(root+"/provider/jobs");
  await buttons(c,"Fund with Demo Wallet").click();await waitJob(id,"RUNNING");await ui("RUNNING");await shot(c,"03-consumer-progress");
  const card=providerJobs.locator(".job-card").filter({hasText:id});await card.waitFor();await card.locator("summary").first().click();await shot(providerJobs,"04-provider-progress");
  await slot.getByRole("button",{name:"Stop accepting jobs"}).click();await slot.getByRole("button",{name:"Enable device"}).waitFor();
  const pending=await post("/batch/jobs",spec);A.equal(pending.status,"DRAFT");
  const j=await waitJob(id,"REVIEW");await ui("REVIEW");
  record("Pause during active run","PASS",{id,draft:pending._id,activeFinished:j.status});await share(true);
  A.equal(j.resultMetadata.exitCode,0);A.equal(j.resultMetadata.device,"cpu");A.equal(j.resultMetadata.runtime,"3.12.10");A.ok(j.resultMetadata.elapsedMs>=12000);A.match(j.liveLog,/QA_TOTAL=12/);A.equal(j.spec.scriptHash,sha(source));
  const expected={"metrics.json":'{"count":3,"sum":12}',"rows.csv":"value,square\n2,4\n4,16\n6,36\n"};
  const files=[];for(const f of outputs){const d=c.waitForEvent("download");await buttons(c,"Download "+f).click();const dest=path.join(out,f);await (await d).saveAs(dest);const b=fs.readFileSync(dest);A.equal(b.toString(),expected[f]);const hash=sha(b);A.equal(j.verification.files.find(v=>v.name===f).sha256,hash);files.push({name:f,actual:b.toString(),expected:expected[f],sha256:hash});}
  A.equal(Number((await state(j)).status),4);A.equal((await events(j,"PaymentReleased")).length,0);A.equal((await state(j)).resultHash,"0x"+j.resultHash);
  const bytes=fs.readFileSync(fs.readdirSync(path.join(__dirname,"artifacts")).map(v=>path.join(__dirname,"artifacts",v)).find(v=>path.basename(v).startsWith(id)));
  A.equal(sha(bytes),j.resultHash);await shot(c,"05-consumer-results");
  await buttons(c,"Accept and pay").click();await ui("COMPLETED");await c.getByText(/Escrow receipts \(/).click();await shot(c,"06-consumer-payment");
  await providerJobs.reload();await card.waitFor();await card.locator("summary").first().click();await card.getByText(/Escrow receipts \(/).click();await shot(providerJobs,"07-provider-payment");
  await accept(id);await post("/jobs/"+id+"/reconcile");const paid=await job(id);
  const trace=await terminal(paid,"PaymentReleased");save("successful-job",{...trace,files,sourceHash:j.spec.scriptHash,bundleHash:j.resultHash,metadata:j.resultMetadata,receipts:paid.receipts,stdout:j.liveLog,preAcceptanceChainStatus:4});return trace;
 });
 await share(true);
 await scenario("Foreign consumer denied job and named artifacts",async()=>{
  const statuses=[];for(const route of ["/jobs/"+primary._id,"/jobs/"+primary._id+"/outputs/metrics.json"]){await call(route,{token:ot,expect:403});statuses.push(403);}return {id:primary._id,statuses};
 });
 await scenario("Identical live worker upload retry and repeated acceptance/settlement",async()=>{
  const retry=JSON.parse(fs.readFileSync(path.join(out,"upload-retry.json")));A.equal(retry.originalHash,retry.retriedHash);A.equal(retry.status,200);
  await accept(primary._id);await post("/jobs/"+primary._id+"/reconcile");return terminal(await job(primary._id),"PaymentReleased");
 });
 await scenario("Run again creates a fresh quote with original inputs",async()=>{
  await c.goto(root+"/consumer/jobs?job="+primary._id);const resp=c.waitForResponse(r=>r.url().endsWith("/repeat"));await buttons(c,"Run again").click();const j=(await (await resp).json()).data;
  A.notEqual(j._id,primary._id);A.deepEqual(j.spec,primary.spec);A.equal(j.escrowAmountWei,"12345");A.equal(j.receipts.length,0);return {id:j._id,original:primary._id,amount:j.escrowAmountWei};
 });
 await scenario("Pasted Python executes and settles",async()=>{
  const j=await form("print('PASTE_OK')\nopen('paste.txt','w').write('paste-ok')",["paste.txt"],20,false);await buttons(c,"Fund with Demo Wallet").click();await ui("REVIEW");const d=c.waitForEvent("download");await buttons(c,"Download paste.txt").click();A.equal(fs.readFileSync(await (await d).path(),"utf8"),"paste-ok");await buttons(c,"Accept and pay").click();return terminal(await waitJob(j._id,"COMPLETED"),"PaymentReleased");
 });
 await scenario("Invalid or oversized source rejected before execution",async()=>{
  for(const source of ["","a".repeat(49153)])await post("/batch/jobs",{...spec,source},ct,400);
  await c.goto(root+"/consumer");await c.getByLabel("Workload",{exact:true}).selectOption("script");await c.getByLabel("Upload Python file").setInputFiles({name:"oversize.py",mimeType:"text/plain",buffer:Buffer.alloc(49153,65)});await c.getByText("Choose a .py file up to 48 KiB").waitFor();return {api:[400,400],browser:"48 KiB validation"};
 });
 for(const [label,code,seconds,pattern] of [["Syntax error","def invalid(:",10,/exited/i],["Missing output","print('no file')",10,/Missing or unreadable/],["Timeout","import time\nprint('before timeout',flush=True)\ntime.sleep(45)",2,/Runtime limit exceeded/]]){
  await scenario(label+" refunds and releases slot",async()=>{
   const j=await post("/batch/jobs",{...spec,source:code,outputs:["result.txt"],seconds});await funds(j._id);const f=await waitJob(j._id,"REFUNDED");A.match(f.error,pattern);
   await c.goto(root+"/consumer/jobs?job="+j._id);await ui("REFUNDED");await c.getByText(f.error,{exact:true}).first().waitFor();if(label==="Timeout"){await c.getByText(/Escrow receipts \(/).click();await shot(c,"08-timeout-refund");}
   if(label==="Syntax error")A.match(f.liveLog,/SyntaxError/);
   await post("/jobs/"+j._id+"/cancel");return terminal(await job(j._id),"RefundIssued");
  });
 }
 await scenario("Two funded jobs share one slot serially",async()=>{
  const body={...spec,seconds:20,source:"import time\ntime.sleep(3)\nopen('x','w').write('1')",outputs:["x"]};
  const jobs=await Promise.all([post("/batch/jobs",body),post("/batch/jobs",body)]);await Promise.all(jobs.map(j=>funds(j._id)));
  const seen=[];for(let i=0;i<360;i++){const states=await Promise.all(jobs.map(j=>job(j._id)));const names=states.map(j=>j.status);if(JSON.stringify(seen.at(-1))!==JSON.stringify(names))seen.push(names);
   A.ok(states.filter(j=>["ASSIGNED","RUNNING","RESULT_UPLOADED"].includes(j.status)).length<=1);if(states.every(j=>j.status==="REVIEW"))break;await wait(400);}
  for(const j of jobs){A.equal((await job(j._id)).status,"REVIEW");await accept(j._id);}
  return {jobs:await Promise.all(jobs.map(async j=>terminal(await job(j._id),"PaymentReleased"))),observed:seen};
 });
 await scenario("Agent link disconnect, real lease expiry and stale upload rejection",async()=>{
  const j=await post("/batch/jobs",{...spec,source:"import time\nprint('QA_DISCONNECT',flush=True)\ntime.sleep(12)\nopen('x','w').write('done')",outputs:["x"],seconds:30});await funds(j._id);await waitJob(j._id,"RUNNING");const f=await waitJob(j._id,"REFUNDED");A.match(f.error,/lease expired/i);
  for(let i=0;i<100 && !fs.existsSync(path.join(out,"disconnect-end.json"));i++)await wait(1000);
  const link=JSON.parse(fs.readFileSync(path.join(out,"disconnect-end.json")));A.equal(link.staleUpload,409);return {...await terminal(f,"RefundIssued"),link};
 });
 await scenario("Expired unused pairing code rejected after genuine expiry",async()=>{
  await wait(Math.max(0,new Date(expiry.expires)-Date.now()+1000));await post("/agents/pair",{wallet:users.provider.walletAddress,code:expiry.code},pt,403);return {expires:expiry.expires,testedAt:new Date(),http:403};
 });
 rpc.destroy();
};
