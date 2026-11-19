"use strict";
// Run against a provisioned local CPU rehearsal with a worker already online.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const origin = "http://127.0.0.1:5173";
async function main() {
  const directory = path.resolve(process.env.EVIDENCE_DIR || "evidence/browser-rehearsal");
  const accounts = JSON.parse(await fs.readFile("runtime/accounts.json"));
  await fs.mkdir(directory, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const role of ["consumer", "provider"]) {
      const registration = await browser.newPage();
      await registration.goto(origin + "/register");
      await registration.locator("[name=name]").fill("Browser rehearsal " + role);
      await registration.locator("[name=email]").fill(crypto.randomUUID() + "@bdgce.local");
      await registration.locator("[name=password]").fill(crypto.randomBytes(20).toString("hex"));
      await registration.getByRole("button", { name: new RegExp(role, "i") }).click();
      await registration.locator("button[type=submit]").click();
      await registration.waitForURL(origin + "/" + role);
      await registration.close();
    }
    async function login(role) {
      const page = await browser.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin + "/login");
      await page.locator("[name=email]").fill(accounts[role].email);
      await page.locator("[name=password]").fill(accounts[role].password);
      await page.locator("button[type=submit]").click();
      await page.waitForURL(origin + "/" + role);
      return page;
    }
    const provider = await login("provider");
    await provider.getByText("Worker online", { exact: false }).first().waitFor();
    const consumer = await login("consumer");
    await consumer.getByText(/CPU development test.*Matrix multiplication/).waitFor();
    await consumer.locator("[name=size]").fill("64");
    await consumer.getByRole("button", { name: /Submit Job/ }).click();
    const funding = consumer.getByRole("button", { name: "Fund with Demo Wallet" });
    await funding.waitFor();
    const jobId = (await consumer.getByText(/Job [a-f0-9]{24} · AWAITING_FUNDING/).innerText()).match(/[a-f0-9]{24}/)[0];
    await funding.click();
    await consumer.getByText("Job status · COMPLETED").waitFor({ timeout: 180000 });
    await consumer.getByText(/CPU reference verified/).waitFor();
    await consumer.getByText(/Verified matrix preview/).click();
    assert.equal(await consumer.locator("table td").count(), 16);
    const expected = (await consumer.getByText(/SHA-256 ·/).innerText()).match(/[a-f0-9]{64}/)[0];
    const pending = consumer.waitForEvent("download");
    await consumer.getByRole("button", { name: /Download result/ }).click();
    const downloaded = await pending;
    const hash = crypto.createHash("sha256").update(await fs.readFile(await downloaded.path())).digest("hex");
    assert.equal(hash, expected);
    await consumer.screenshot({ path: path.join(directory, "consumer.png"), fullPage: true });
    await provider.getByRole("link", { name: /Jobs on My GPUs/ }).click();
    const card = provider.locator(".job-card").filter({ hasText: jobId });
    await card.getByText("Workload, results and payment").click();
    await card.getByText("Job status · COMPLETED").waitFor();
    await card.getByText(/Confirmed local-chain receipts/).click();
    await card.getByText("PaymentReleased", { exact: true }).waitFor();
    await card.screenshot({ path: path.join(directory, "provider.png") });
    await consumer.locator("[name=requiredGpuMemory]").fill("99999");
    await consumer.getByRole("button", { name: /Submit Job/ }).click();
    await funding.click();
    await consumer.getByText("Job status · QUEUED").waitFor();
    await consumer.getByRole("button", { name: "Cancel / refund" }).click();
    await consumer.getByText("Job status · REFUNDED").waitFor();
    await consumer.getByText(/Confirmed local-chain receipts/).click();
    await consumer.getByText("RefundIssued", { exact: true }).waitFor();
    await provider.goto(origin + "/provider");
    const created = provider.waitForResponse(response => response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/gpus");
    await provider.getByRole("button", { name: "+ Register GPU" }).click();
    const slotId = (await (await created).json()).data._id;
    const slot = provider.locator(`[data-slot-id="${slotId}"]`);
    await slot.getByText(/Worker offline/).waitFor();
    await slot.locator("input").fill(accounts.provider.walletAddress);
    await slot.getByRole("button", { name: /rotate worker credential/ }).click();
    await slot.getByRole("button", { name: "Hide credential" }).click();
    await slot.getByRole("button", { name: /Edit/ }).click();
    await provider.locator("[name=status]").selectOption("INACTIVE");
    await provider.getByRole("button", { name: "Save Changes" }).click();
    await slot.getByText(/Slot status · INACTIVE/).waitFor();
    provider.once("dialog", dialog => dialog.accept());
    await slot.getByRole("button", { name: /Delete/ }).click();
    await slot.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(directory, "browser.json"), JSON.stringify({ jobId, hash,
      mode: "real_cpu_test", verifiedPreviewCells: 16, browserErrors: errors, paymentEvent: "PaymentReleased",
      registeredRoles: ["consumer", "provider"], refundEvent: "RefundIssued", retiredOfflineSlot: slotId }, null, 2));
    console.log("Both dashboard roles, verified download and payment receipt passed", jobId);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
