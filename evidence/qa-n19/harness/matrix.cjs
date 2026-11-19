const users=require("./users.json"),fs=require("fs"),path=require("path"),a=require("node:assert/strict"),crypto=require("crypto");
const {ethers}=require("../../backend/node_modules/ethers");
const out=path.resolve("evidence/qa-n19");
async function api(route,body,token,method=body?"POST":"GET"){const r=await fetch("http://127.0.0.1:5021/api"+route,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:body&&JSON.stringify(body)});const j=await r.json();a.ok(r.ok,route+" "+j.message);return j.data||j;}
(async()=>{
 const p=(await api("/auth/login",users.provider)).token,c=(await api("/auth/login",users.consumer)).token;
 if(process.argv[2]==="prepare"){
  const slot=await api("/gpus",{},p);const key=await api("/gpus/"+slot._id+"/worker-key",{walletAddress:users.provider.walletAddress},p);
  fs.writeFileSync(path.join(__dirname,"matrix.env"),fs.readFileSync(path.join(__dirname,"worker.env"),"utf8")+"\nWORKER_API_KEY="+key.workerApiKey+"\n",{mode:0o600});return;
 }
 const j=await api("/jobs",{taskType:"matrix_multiply",input:{size:64,seed:42},reservedMinutes:1},c);await api("/jobs/"+j._id+"/fund",{},c);
 let done;for(let i=0;i<100;i++){done=await api("/jobs/"+j._id,null,c);if(done.status==="COMPLETED")break;await new Promise(r=>setTimeout(r,1000));}
 a.equal(done.status,"COMPLETED");a.equal(done.verification.verified,true);a.equal(done.resultMetadata.spec.executionMode,"real_cpu_test");
 const dl=await fetch("http://127.0.0.1:5021/api/jobs/"+j._id+"/artifact",{headers:{Authorization:"Bearer "+c}});a.equal(dl.status,200);
 const bytes=Buffer.from(await dl.arrayBuffer());a.equal(crypto.createHash("sha256").update(bytes).digest("hex"),done.resultHash);
 fs.writeFileSync(path.join(out,"matrix.npy"),bytes);
 const rpc=new ethers.JsonRpcProvider("http://127.0.0.1:8561"),contract=new ethers.Contract("0x5FbDB2315678afecb367f032d93F642f64180aa3",require("../../backend/blockchain/contractAbi").ESCROW_ABI,rpc);
 const logs=await contract.queryFilter(contract.filters.PaymentReleased(done.blockchainJobId));a.equal(logs.length,1);a.equal(logs[0].args.amount.toString(),done.escrowAmountWei);a.equal(logs[0].args.provider.toLowerCase(),users.provider.walletAddress.toLowerCase());rpc.destroy();
 fs.writeFileSync(path.join(out,"matrix.json"),JSON.stringify({id:j._id,spec:done.spec,verification:done.verification,paymentWei:done.paymentWei,artifactSHA256:done.resultHash,receipts:done.receipts},null,2));console.log("PASS native CPU matrix",j._id);
})().catch(e=>{console.error(e.message);process.exitCode=1});
