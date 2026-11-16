/**
 * test/helpers/loadWithStubs.js
 * Loads a backend module with selected backend modules replaced by stubs,
 * using a fresh module registry for every call (no state leaks between tests).
 */

"use strict";

const path = require("path");
const Module = require("module");

const BACKEND = path.resolve(__dirname, "../..");

/**
 * @param {string} entry  backend-relative path of the module to load
 * @param {object} stubs  { "models/Job.js": stubExports, ... } (backend-relative)
 */
function loadWithStubs(entry, stubs = {}) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(BACKEND) && !key.includes(`${path.sep}node_modules${path.sep}`) &&
        !key.includes(`${path.sep}test${path.sep}`)) {
      delete require.cache[key];
    }
  }
  for (const [rel, exportsValue] of Object.entries(stubs)) {
    const file = path.join(BACKEND, rel);
    const m = new Module(file);
    m.filename = file;
    m.loaded = true;
    m.exports = exportsValue;
    require.cache[file] = m;
  }
  return require(path.join(BACKEND, entry));
}

/** Silence console output while fn runs (scheduler/controllers log heavily). */
async function quiet(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = console.warn = console.error = (...a) => lines.push(a.join(" "));
  try { return await fn(lines); } finally { Object.assign(console, saved); }
}

module.exports = { loadWithStubs, quiet, BACKEND };
