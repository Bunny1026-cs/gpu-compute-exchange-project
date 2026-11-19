"use strict";
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const origin = process.env.FRONTEND_URL || "http://127.0.0.1:5173";
const out = process.env.EVIDENCE_DIR || "runtime/batch-evidence";
const accounts = require("../runtime/accounts.json");
async function main() {
  const browser = await chromium.launch();
  await fs.mkdir(out,{recursive:true});
  try {
    async function login(role) {
      const page = await browser.newPage();
      const register = await page.request.post(origin+"/api/auth/register",{data:accounts[role]});
      assert.ok([201,409].includes(register.status()));
      await page.goto(origin+"/login");
      await page.locator("[name=email]").fill(accounts[role].email);
      await page.locator("[name=password]").fill(accounts[role].password);
      await page.locator("button[type=submit]").click();
      await page.waitForURL(origin+"/"+role);
      return page;
    }
    const provider=await login("provider");
    const consumer=await login("consumer");
    const token=await consumer.evaluate(()=>localStorage.getItem("token"));
    async function api(route,body) {
      const r=await consumer.request.fetch(origin+"/api"+route,{method:body?"POST":"GET",data:body,headers:{Authorization:"Bearer "+token}});
      const payload=await r.json();
      assert.ok(r.ok(),route+" "+payload.message);
      return payload.data;
    }
    if (process.argv.includes("--pair")) {
      const issued=provider.waitForResponse(r=>r.url().endsWith("/agents/code") && r.status()===200);
      await provider.getByRole("button",{name:"Pair local agent"}).click();
      const {data}=await (await issued).json();
      await fs.writeFile("runtime/pilot-pair-code",data.code,{mode:0o600});
      console.log("Start the agent with the one-time code in runtime/pilot-pair-code");
    }
    const slot=provider.locator(".provider-gpu").filter({hasText:"CPU runtime verified"}).first();
    await slot.waitFor({timeout:180000});
    const rate="12345678901234567";
    await slot.getByLabel("Rate in wei/min").fill(rate);
    const enable=slot.getByRole("button",{name:"Enable device"});
    await (await enable.count()?enable:slot.getByRole("button",{name:"Save rate"})).click();
    await slot.getByRole("button",{name:"Stop accepting jobs"}).waitFor();
    async function submit(source,seconds) {
      await consumer.goto(origin+"/consumer");
      await consumer.getByLabel("Workload",{exact:true}).selectOption("script");
      await consumer.getByLabel("Upload Python file").setInputFiles({name:"pilot.py",mimeType:"text/plain",buffer:Buffer.from(source)});
      await consumer.getByLabel("Time limit in seconds").fill(String(seconds));
      await consumer.getByLabel("Arguments (JSON array)").fill('["21"]');
      const created=consumer.waitForResponse(r=>r.url().endsWith("/batch/jobs") && r.request().method()==="POST");
      await consumer.getByRole("button",{name:"Save and quote"}).click();
      const job=(await (await created).json()).data;
      assert.equal(job.escrowAmountWei,rate);
      await consumer.getByRole("button",{name:"Fund with Demo Wallet"}).click();
      return job._id;
    }
    const id=await submit("import os,sys,time\nassert os.getuid()==65534\nassert not os.getenv('PROVIDER_PRIVATE_KEY')\nprint('computing',flush=True)\ntime.sleep(2)\nopen('result.txt','w').write(str(int(sys.argv[1])*2))",25);
    await consumer.getByText("Python batch · REVIEW",{exact:true}).waitFor({timeout:180000});
    const review=await api("/jobs/"+id);
    assert.equal(review.resultMetadata.exitCode,0);
    assert.equal(review.receipts.some(r=>r.action==="PaymentReleased"),false);
    assert.match(review.liveLog,/computing/);
    const pending=consumer.waitForEvent("download");
    await consumer.getByRole("button",{name:"Download result.txt"}).click();
    assert.equal(await fs.readFile(await (await pending).path(),"utf8"),"42");
    await consumer.getByRole("button",{name:"Accept and pay"}).click();
    await consumer.getByText("Python batch · COMPLETED",{exact:true}).waitFor({timeout:60000});
    await api("/jobs/"+id+"/review",{decision:"accept"});
    const paid=await api("/jobs/"+id);
    assert.equal(paid.paymentWei,rate);
    assert.equal(paid.receipts.filter(r=>r.action==="PaymentReleased").length,1);
    const timeoutId=await submit("import time\nprint('started',flush=True)\ntime.sleep(45)",2);
    await consumer.getByText("Python batch · REFUNDED",{exact:true}).waitFor({timeout:120000});
    const refund=await api("/jobs/"+timeoutId);
    assert.match(refund.error,/Runtime limit exceeded/);
    assert.equal(refund.receipts.filter(r=>r.action==="RefundIssued").length,1);
    const againRefund=await api("/jobs/"+timeoutId+"/cancel",{});
    assert.equal(againRefund.receipts.filter(r=>r.action==="RefundIssued").length,1);
    const available=await api("/gpus");
    assert.ok(available.some(g=>g._id===refund.gpuId._id && !g.activeJob));
    await slot.getByRole("button",{name:"Stop accepting jobs"}).click();
    await slot.getByRole("button",{name:"Enable device"}).waitFor();
    const repeat=await api("/jobs/"+id+"/repeat",{});
    assert.equal(repeat.status,"DRAFT");
    assert.equal(repeat.spec.scriptHash,review.spec.scriptHash);
    await slot.getByRole("button",{name:"Enable device"}).click();
    await slot.getByRole("button",{name:"Stop accepting jobs"}).waitFor();
    const priced=await api("/jobs/"+repeat._id+"/quote",{});
    assert.equal(priced.escrowAmountWei,rate);
    await api("/jobs/"+repeat._id+"/fund",{});
    let repeated;
    for (let i=0;i<120;i++) {
      repeated=await api("/jobs/"+repeat._id);
      if (repeated.status==="REVIEW") break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.equal(repeated.status,"REVIEW");
    const disputed=await api("/jobs/"+repeat._id+"/review",{decision:"issue",reason:"Pilot operator-resolution exercise"});
    assert.equal(disputed.status,"DISPUTED");
    assert.equal(disputed.receipts.some(r=>r.action==="PaymentReleased"),false);
    await fs.writeFile(out+"/batch-pilot.json",JSON.stringify({job:id,timeoutJob:timeoutId,disputeJob:repeat._id,paid:paid.paymentWei,receipts:paid.receipts,
      metadata:paid.resultMetadata,files:paid.verification.files,refund:refund.receipts,timeout:refund.error,deviceReleased:true},null,2));
    console.log("PASS upload, container execution, output 42, review, acceptance, idempotent payment, timeout, refund and release",id,timeoutId);
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
