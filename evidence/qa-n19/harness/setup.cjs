const fs=require("fs"),crypto=require("crypto"),path=require("path");
const {ethers}=require("../../backend/node_modules/ethers");
const dotenv=require("../../backend/node_modules/dotenv");
(async()=>{
const rpc=new ethers.JsonRpcProvider("http://127.0.0.1:8561");
const [owner,operator]=await Promise.all([rpc.getSigner(0),rpc.getSigner(1)]);
const abi=require("../../blockchain/artifacts/contracts/GPUComputeEscrow.sol/GPUComputeEscrow.json");
const contract=await new ethers.ContractFactory(abi.abi,abi.bytecode,owner).deploy(await operator.getAddress());await contract.waitForDeployment();
const provider=ethers.Wallet.createRandom();await (await owner.sendTransaction({to:provider.address,value:ethers.parseEther("1")})).wait();
const env={...dotenv.parse(fs.readFileSync("runtime/backend.env")),JWT_SECRET:crypto.randomBytes(32).toString("hex"),MONGODB_URI:"mongodb://127.0.0.1:27017/bdgce_qa_"+crypto.randomBytes(5).toString("hex"),PORT:"5021",BLOCKCHAIN_RPC_URL:"http://127.0.0.1:8561",ESCROW_CONTRACT_ADDRESS:contract.target,RESULT_STORAGE_DIR:path.resolve(__dirname,"artifacts"),IPFS_API_URL:""};
const write=(name,data)=>fs.writeFileSync(path.join(__dirname,name),data,{mode:0o600});
const config=(name,obj)=>write(name,Object.entries(obj).map(([k,v])=>k+"="+v).join("\n"));
config("backend.env",env);config("worker.env",{BACKEND_URL:"http://127.0.0.1:5021/api",BLOCKCHAIN_RPC_URL:env.BLOCKCHAIN_RPC_URL,PROVIDER_PRIVATE_KEY:provider.privateKey,FINAL_DEMO:"false",EXECUTION_MODE:"real_cpu_test"});
const users={};for(const r of ["provider","consumer","other"]){users[r]={name:"QA "+r,email:r+"-"+crypto.randomUUID()+"@qa.local",password:crypto.randomBytes(20).toString("hex"),role:r==="provider"?"PROVIDER":"CONSUMER"};}
users.provider.walletAddress=provider.address;write("users.json",JSON.stringify(users));console.log("Deployed",contract.target,"database",env.MONGODB_URI.split("/").pop());rpc.destroy();
})().catch(e=>{console.error(e.message);process.exitCode=1});
