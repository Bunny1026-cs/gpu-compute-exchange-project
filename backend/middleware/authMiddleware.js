/**
 * middleware/authMiddleware.js
 * JWT authentication middleware — GPU Compute Exchange
 *
 * Reads the Authorization header, verifies the JWT,
 * and attaches the decoded user payload to req.user.
 *
 * Usage:
 *   router.get('/protected', protect, handler);
 */

const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * protect
 * Verifies Bearer JWT. Attaches req.user on success.
 * Returns 401 on missing/invalid/expired token.
 */
const protect = async (req, res, next) => {
  try {
    // ── Extract token ─────────────────────────────────────────
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Token missing after Bearer.",
      });
    }

    // ── Verify token ──────────────────────────────────────────
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Token has expired. Please log in again.",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    // ── Load user from DB ─────────────────────────────────────
    // Fetch fresh user so revocation/role changes are respected.
    // password is excluded via select:false on the schema.
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User belonging to this token no longer exists.",
      });
    }

    // ── Attach to request ─────────────────────────────────────
    req.user = user;
    next();
  } catch (err) {
    // Unexpected server error — do not expose internals
    console.error("Auth middleware error:", err.message);
    res.status(500).json({
      success: false,
      message: "Authentication error. Please try again.",
    });
  }
};

module.exports = { protect };
