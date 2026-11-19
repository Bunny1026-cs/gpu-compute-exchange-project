const fs=require("fs"),path=require("path"),a=require("node:assert/strict"),{ethers}=require("../../backend/node_modules/ethers"),{MongoClient}=require("../../backend/node_modules/mongodb");
const cfg=require("../../backend/node_modules/dotenv").parse(fs.readFileSync(path.join(__dirname,"backend.env")));
const rpc=new ethers.JsonRpcProvider(cfg.BLOCKCHAIN_RPC_URL),conn=new MongoClient(cfg.MONGODB_URI);
(async()=>{await conn.connect();const escrow=new ethers.Contract(cfg.ESCROW_CONTRACT_ADDRESS,require("../../backend/blockchain/contractAbi").ESCROW_ABI,rpc),operator=await escrow.operator(),db=conn.db(),ledger=[];
 for(const j of await db.collection("jobs").find({status:{$in:["COMPLETED","REFUNDED"]}}).toArray()){
  const chain=await escrow.getJob(j.blockchainJobId);a.equal(Number(chain.status),j.status==="COMPLETED"?6:7);
  const terminal=j.status==="COMPLETED"?"PaymentReleased":"RefundIssued";
  const events=[];for(const event of ["FundsDeposited","JobAssigned","ResultSubmitted","PaymentReleased","RefundIssued"]){
   const all=await escrow.queryFilter(escrow.filters[event](j.blockchainJobId));a.ok(all.length<=1);
   if(event===terminal||event==="FundsDeposited"||event==="JobAssigned"||(event==="ResultSubmitted"&&j.status==="COMPLETED"))a.equal(all.length,1);
   if((event==="RefundIssued"||event==="PaymentReleased")&&event!==terminal)a.equal(all.length,0);
   for(const e of all){const r=await rpc.getTransactionReceipt(e.transactionHash);a.equal(r.status,1);const sender=event==="FundsDeposited"?chain.consumer:event==="ResultSubmitted"?chain.provider:operator;a.equal(r.from,sender);a.equal(r.to.toLowerCase(),escrow.target.toLowerCase());a.equal(j.receipts.find(v=>v.action===event).txHash,r.hash);
    if(e.args.amount!=null)a.equal(e.args.amount.toString(),j.escrowAmountWei);
    if(event==="ResultSubmitted")a.equal(chain.resultHash,"0x"+j.resultHash);
    events.push({event,from:r.from,tx:r.hash,block:r.blockNumber});}
  }
  a.notEqual(String((await db.collection("gpus").findOne({_id:j.gpuId})).activeJob),String(j._id));
  ledger.push({id:String(j._id),status:j.status,amountWei:j.escrowAmountWei,terminalTx:events.find(e=>e.event===terminal).tx,events,deviceReleased:true});
 }
 fs.writeFileSync("evidence/qa-n19/ledger.json",JSON.stringify(ledger,null,2));console.log("Verified terminal jobs",ledger.length);
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{rpc.destroy();await conn.close();});
