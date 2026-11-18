"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const storage = require("../backend/services/artifactStorage");

async function main() {
  const [reportFile, expected] = process.argv.slice(2);
  assert.ok(["local_file", "ipfs_and_local_file"].includes(expected));
  const report = JSON.parse(await fs.readFile(reportFile));
  const base = process.env.BACKEND_URL || "http://127.0.0.1:5000/api";
  const accounts = JSON.parse(await fs.readFile("runtime/accounts.json"));
  const login = await fetch(base + "/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(accounts.consumer) });
  assert.ok(login.ok);
  const headers = { Authorization: "Bearer " + (await login.json()).token };
  const checks = [];
  for (const { jobId, resultHash } of report.samples) {
    const result = await fetch(base + "/jobs/" + jobId + "/result", { headers });
    assert.ok(result.ok);
    const data = (await result.json()).data;
    assert.equal(data.storage, expected);
    const download = await fetch(base + "/jobs/" + jobId + "/artifact", { headers });
    assert.ok(download.ok);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(storage.hash(bytes), resultHash);
    if (expected === "ipfs_and_local_file") {
      const api = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
      const cat = await fetch(api + "/api/v0/cat?arg=" + encodeURIComponent(data.ipfsCid), { method: "POST" });
      assert.ok(cat.ok);
      assert.deepEqual(Buffer.from(await cat.arrayBuffer()), bytes);
    } else assert.equal(data.ipfsCid, null);
    // Alter only a temporary copy. Paid artifacts remain intact.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bdgce-integrity-"));
    const copy = path.join(dir, "modified.npy");
    try {
      bytes[bytes.length - 1] ^= 1;
      await fs.writeFile(copy, bytes);
      await assert.rejects(storage.readVerified({ artifactPath: copy, resultHash }), /integrity failure/);
    } finally {
      await fs.unlink(copy);
      await fs.rmdir(dir);
    }
    checks.push({ jobId, storage: expected, cid: data.ipfsCid, sha256: resultHash, corruptCopyRejected: true });
  }
  assert.ok(checks.length);
  await fs.writeFile(path.join(path.dirname(reportFile), "artifact-checks.json"), JSON.stringify(checks, null, 2));
  console.log("Verified artifact bytes and corruption rejection for", checks.length, expected, "jobs");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
