/**
 * middleware/roleMiddleware.js
 * Role-based authorization middleware — GPU Compute Exchange
 *
 * Usage (after protect):
 *   router.post('/gpus', protect, requireRole('PROVIDER'), handler);
 *   router.get('/admin', protect, requireRole(['PROVIDER', 'CONSUMER']), handler);
 */

const { ROLES } = require("../models/User");

/**
 * requireRole
 * Factory that returns middleware restricting access to specific role(s).
 *
 * @param {string|string[]} roles - Allowed role(s)
 */
const requireRole = (roles) => {
  // Normalise to array
  const allowed = Array.isArray(roles) ? roles : [roles];

  // Validate roles at definition time to catch typos early
  allowed.forEach((r) => {
    if (!Object.values(ROLES).includes(r)) {
      throw new Error(
        `Invalid role '${r}' passed to requireRole(). Valid roles: ${Object.values(ROLES).join(", ")}`
      );
    }
  });

  return (req, res, next) => {
    // protect() must run before requireRole()
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated.",
      });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowed.join(" or ")}. Your role: ${req.user.role}.`,
      });
    }

    next();
  };
};

module.exports = { requireRole };
