/**
 * test/blockchainService.test.js
 * P1-8: nonce is read with an uncached "pending" JSON-RPC call, and
 * transactions from one address are serialized. (P1-7 and the end-to-end
 * nonce behaviour need a live chain: see scripts/check-local-chain.js.)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithStubs } = require("./helpers/loadWithStubs");

const fresh = () => loadWithStubs("blockchain/blockchainService.js");

test("_getNonce uses a raw eth_getTransactionCount call with the 'pending' tag", async () => {
  const bc = fresh();
  const calls = [];
  bc.provider = { send: async (method, params) => { calls.push([method, params]); return "0x2a"; } };
  assert.equal(await bc._getNonce("0xAbC"), 42);
  assert.deepEqual(calls, [["eth_getTransactionCount", ["0xAbC", "pending"]]]);
});

test("_serialized runs same-address jobs strictly one after another", async () => {
  const bc = fresh();
  const events = [];
  const job = (name, ms) => async () => {
    events.push(`start:${name}`);
    await new Promise((r) => setTimeout(r, ms));
    events.push(`end:${name}`);
    return name;
  };
  const out = await Promise.all([
    bc._serialized("0xA", job("a1", 20)),
    bc._serialized("0xa", job("a2", 1)),          // same address, different case
    bc._serialized("0xA", job("a3", 1)),
  ]);
  assert.deepEqual(out, ["a1", "a2", "a3"]);
  assert.deepEqual(events, ["start:a1", "end:a1", "start:a2", "end:a2", "start:a3", "end:a3"]);
});

test("_serialized: a failed transaction does not block the next one, and its error propagates", async () => {
  const bc = fresh();
  const first = bc._serialized("0xB", async () => { throw new Error("reverted"); });
  const second = bc._serialized("0xB", async () => "ok");
  await assert.rejects(first, /reverted/);
  assert.equal(await second, "ok");
});

test("_serialized: different addresses are not serialized against each other", async () => {
  const bc = fresh();
  const events = [];
  await Promise.all([
    bc._serialized("0xC", async () => { events.push("c:start"); await new Promise((r) => setTimeout(r, 20)); events.push("c:end"); }),
    bc._serialized("0xD", async () => { events.push("d:start"); events.push("d:end"); }),
  ]);
  assert.ok(events.indexOf("d:end") < events.indexOf("c:end"));
});
