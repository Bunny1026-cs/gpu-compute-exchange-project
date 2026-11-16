/**
 * config/devRoutes.js
 * Decides whether development-only routes (/api/dev/*) may be mounted.
 *
 * Rules (P0-1):
 *   - Disabled unless ENABLE_DEV_ROUTES is exactly "true".
 *   - Always disabled when NODE_ENV is "production", regardless of the flag.
 */

"use strict";

function isDevRoutesEnabled(env = process.env) {
  if (env.NODE_ENV === "production") return false;
  return env.ENABLE_DEV_ROUTES === "true";
}

module.exports = { isDevRoutesEnabled };
