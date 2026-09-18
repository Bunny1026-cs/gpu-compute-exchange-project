/**
 * services/ipfsService.js
 * IPFS Integration — GPU Compute Exchange
 *
 * Supports two modes:
 *   1. REAL IPFS: Connects to a running IPFS node (IPFS_API_URL)
 *   2. MOCK IPFS: Stores files locally, generates CID-like identifiers
 *
 * The mock mode allows the full pipeline to work without an IPFS daemon.
 * In production, switch to a real IPFS node or pinning service (Pinata, web3.storage).
 */

"use strict";

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

// ── Mock storage directory ────────────────────────────────────
const MOCK_STORAGE_DIR = path.join(__dirname, "../.ipfs-mock");

class IPFSService {
  constructor() {
    this.mode = "mock"; // "real" or "mock"
    this.apiUrl = null;
    this.gatewayUrl = null;
    this.initialized = false;
  }

  /**
   * initialize
   * Sets up IPFS connection or mock storage.
   */
  async initialize() {
    const apiUrl = process.env.IPFS_API_URL;
    const gatewayUrl = process.env.IPFS_GATEWAY || "https://ipfs.io/ipfs/";

    if (apiUrl) {
      try {
        // Try to connect to the IPFS node
        const res = await fetch(`${apiUrl}/api/v0/id`, { method: "POST" });
        if (res.ok) {
          this.mode = "real";
          this.apiUrl = apiUrl;
          this.gatewayUrl = gatewayUrl;
          console.log(`[IPFS] ✅ Connected to IPFS node at ${apiUrl}`);
        } else {
          throw new Error(`IPFS node responded with status ${res.status}`);
        }
      } catch (err) {
        console.warn(`[IPFS] ⚠️  Could not connect to IPFS at ${apiUrl}: ${err.message}`);
        console.log("[IPFS] Falling back to mock IPFS mode.");
        this._initMock();
      }
    } else {
      console.log("[IPFS] ℹ️  IPFS_API_URL not set. Using mock IPFS mode (local file storage).");
      this._initMock();
    }

    this.gatewayUrl = gatewayUrl;
    this.initialized = true;
  }

  _initMock() {
    this.mode = "mock";
    if (!fs.existsSync(MOCK_STORAGE_DIR)) {
      fs.mkdirSync(MOCK_STORAGE_DIR, { recursive: true });
    }
  }

  isAvailable() {
    return this.initialized;
  }

  getMode() {
    return this.mode;
  }

  /**
   * uploadJSON(data)
   * Uploads a JSON object to IPFS (or mock storage).
   * Returns { cid, url, size }.
   */
  async uploadJSON(data) {
    const content = JSON.stringify(data, null, 2);
    return this.uploadContent(Buffer.from(content, "utf-8"), "application/json");
  }

  /**
   * uploadContent(buffer, contentType)
   * Uploads raw content to IPFS (or mock storage).
   * Returns { cid, url, size }.
   */
  async uploadContent(buffer, contentType = "application/octet-stream") {
    if (this.mode === "real") {
      return this._uploadReal(buffer);
    }
    return this._uploadMock(buffer);
  }

  /**
   * retrieve(cid)
   * Retrieves content from IPFS (or mock storage) by CID.
   * Returns { content, contentType } or null if not found.
   */
  async retrieve(cid) {
    if (this.mode === "real") {
      return this._retrieveReal(cid);
    }
    return this._retrieveMock(cid);
  }

  // ── Real IPFS ─────────────────────────────────────────────

  async _uploadReal(buffer) {
    const formData = new FormData();
    formData.append("file", new Blob([buffer]));

    const res = await fetch(`${this.apiUrl}/api/v0/add`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`IPFS add failed: ${res.status} ${res.statusText}`);
    }

    const result = await res.json();
    return {
      cid:  result.Hash,
      url:  `${this.gatewayUrl}${result.Hash}`,
      size: parseInt(result.Size, 10),
    };
  }

  async _retrieveReal(cid) {
    const res = await fetch(`${this.gatewayUrl}${cid}`);
    if (!res.ok) return null;
    const content = await res.text();
    return { content, contentType: res.headers.get("content-type") };
  }

  // ── Mock IPFS ─────────────────────────────────────────────

  _generateMockCid(buffer) {
    // Generate a CIDv1-like identifier using SHA-256
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    // Prefix with 'Qm' to mimic a CIDv0 (visual similarity only)
    return `QmMock${hash.substring(0, 44)}`;
  }

  async _uploadMock(buffer) {
    const cid = this._generateMockCid(buffer);
    const filePath = path.join(MOCK_STORAGE_DIR, cid);

    fs.writeFileSync(filePath, buffer);

    // Also write metadata
    const metaPath = path.join(MOCK_STORAGE_DIR, `${cid}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      cid,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    }));

    console.log(`[IPFS Mock] 📦 Stored ${buffer.length} bytes → ${cid}`);

    return {
      cid,
      url: `mock://ipfs/${cid}`,
      size: buffer.length,
    };
  }

  async _retrieveMock(cid) {
    const filePath = path.join(MOCK_STORAGE_DIR, cid);
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, "utf-8");
    return { content, contentType: "application/octet-stream" };
  }
}

// ── Singleton export ──────────────────────────────────────────
const ipfsService = new IPFSService();
module.exports = ipfsService;
