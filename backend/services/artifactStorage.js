"use strict";
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cidPattern = /^b[a-z2-7]{20,120}$/;
const api = () => (process.env.IPFS_API_URL ?? "http://127.0.0.1:5001").replace(/\/+$/, "");

async function kubo(path, body) {
  const response = await fetch(api() + "/api/v0/" + path, {
    method: "POST", body, signal: AbortSignal.timeout(5000), redirect: "error",
  });
  if (!response.ok) throw new Error(`Kubo responded with HTTP ${response.status}`);
  return response;
}

async function cat(cid) {
  if (!cidPattern.test(cid)) throw new Error("Invalid stored Kubo CID");
  return Buffer.from(await (await kubo("cat?arg=" + cid)).arrayBuffer());
}

async function pinVerified(bytes) {
  if (!api()) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes]), "result.npy");
    const { Hash: cid } = await (await kubo("add?pin=true&cid-version=1", form)).json();
    if (!(await cat(cid)).equals(bytes)) throw new Error("Kubo read-back mismatch");
    return cid;
  } catch (error) {
    console.warn("Using verified local result file:", error.message);
    return null;
  }
}

async function readVerified(job) {
  if (job.ipfsCid && api()) {
    try {
      const bytes = await cat(job.ipfsCid);
      if (hash(bytes) === job.resultHash) return bytes;
    } catch (error) {
      console.warn("Reading local artifact copy:", error.message);
    }
  }
  const bytes = await fs.readFile(job.artifactPath);
  if (hash(bytes) !== job.resultHash) {
    throw Object.assign(new Error("Stored artifact integrity failure"), { statusCode: 409 });
  }
  return bytes;
}

module.exports = { hash, pinVerified, readVerified, kuboConfigured: () => Boolean(api()) };
