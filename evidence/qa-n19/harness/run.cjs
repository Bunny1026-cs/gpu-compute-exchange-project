const {chromium}=require("playwright-core"),fs=require("fs"),path=require("path"),A=require("node:assert/strict"),crypto=require("crypto");
const {ethers}=require("../../backend/node_modules/ethers"),users=require("./users.json");
const root="http://127.0.0.1:5191",out=path.resolve("evidence/qa-n19");
const save=(name,obj)=>fs.writeFileSync(path.join(out,name+".json"),JSON.stringify(obj,null,2));
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const buttons=(p,name)=>p.getByRole("button",{name,exact:true});
const shot=(p,name)=>p.screenshot({path:path.join(out,name+".png"),fullPage:true,animations:"disabled"});
const report=[];
const record=(name,status,details)=>{report.push({name,status,details});save("checks",report);console.log(status,name);};
async function call(url,{method="GET",token,body,expect=200}={}) {
 const r=await fetch(root+"/api"+url,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const obj=await r.json();A.equal(r.status,expect,url+" "+(obj.message||r.status));return obj.data??obj;
}
async function main(){
 const browser=await chromium.launch();
 try {
 const account=async(role)=>{await call("/auth/register",{method:"POST",body:users[role],expect:201});return (await call("/auth/login",{method:"POST",body:users[role]})).token;};
 const [ct,pt,ot]=await Promise.all(["consumer","provider","other"].map(account));
 const login=async(role)=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();await page.goto(root+"/login");
  await page.locator("[name=email]").fill(users[role].email);await page.locator("[name=password]").fill(users[role].password);
  await page.locator("button[type=submit]").click();await page.waitForURL(root+"/"+role);return page;
 };
 const p=await login("provider"),c=await login("consumer");
 A.notEqual(await c.evaluate(()=>localStorage.getItem("token")),await p.evaluate(()=>localStorage.getItem("token")));
 const post=(url,body={},token=ct,expect=200)=>call(url,{method:"POST",token,body,expect});
 const get=(url,token=ct)=>call(url,{token});
 const job=id=>get("/jobs/"+id);
 const waitJob=async(id,status,limit=160000)=>{const start=Date.now();let j;while(Date.now()-start<limit){j=await job(id);if(j.status===status)return j;await wait(350);}throw Error(id+" expected "+status+" got "+j.status+" "+j.error);};
 const rpc=new ethers.JsonRpcProvider("http://127.0.0.1:8561"),contract=new ethers.Contract("0x5FbDB2315678afecb367f032d93F642f64180aa3",require("../../backend/blockchain/contractAbi").ESCROW_ABI,rpc);
 const expiry=await post("/agents/code",{},pt);
 const pairResponse=p.waitForResponse(r=>r.url().endsWith("/agents/code"));await buttons(p,"Pair local agent").click();
 const {data}=await (await pairResponse).json();fs.writeFileSync(path.join(__dirname,"pair"),data.code,{mode:0o600});
 const source="from pathlib import Path\nimport json,time\nvalues=[2,4,6]\nprint('QA_TOTAL='+str(sum(values)),flush=True)\ntime.sleep(12)\nPath('metrics.json').write_text(json.dumps({'count':len(values),'sum':sum(values)},separators=(',',':')))\nPath('rows.csv').write_bytes(b'value,square\\n2,4\\n4,16\\n6,36\\n')";
 const outputs=["metrics.json","rows.csv"],spec={profile:"python-cpu",seconds:45,outputs,args:[],source};
 const draft=await post("/batch/jobs",spec);A.equal(draft.status,"DRAFT");A.equal(draft.receipts.length,0);record("No online slot saves unfunded draft","PASS",{id:draft._id});
 const slot=p.locator(".provider-gpu").filter({hasText:"CPU runtime verified"}).first();await slot.waitFor({timeout:120000});
 await post("/agents/pair",{code:data.code,wallet:users.provider.walletAddress},undefined,403);
 await p.reload();await slot.getByLabel("Rate in wei/min").fill("12345");await slot.getByRole("button",{name:"Enable device"}).click();await slot.getByRole("button",{name:"Stop accepting jobs"}).waitFor();
 await shot(p,"01-provider-setup");record("Independent browser contexts, paired detected CPU and single-use code","PASS",{});
 while(!fs.existsSync(path.join(__dirname,"suite.cjs")))await wait(500);
 await require("./suite.cjs")({c,p,post,get,job,waitJob,call,ct,pt,ot,slot,root,out,source,spec,outputs,contract,expiry,record,save,shot,wait,buttons,sha,A,fs,path,users,rpc});
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
