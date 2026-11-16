/**
 * test/helpers/httpMocks.js
 * Minimal Express req/res doubles for calling controllers directly.
 */
"use strict";

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function mockReq({ params = {}, body = {}, user = null, headers = {}, query = {} } = {}) {
  return { params, body, user, headers, query };
}

module.exports = { mockReq, mockRes };
