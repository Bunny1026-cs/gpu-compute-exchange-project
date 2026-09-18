/**
 * controllers/authController.js
 * Authentication controller — GPU Compute Exchange
 *
 * Handles: POST /api/auth/register
 *          POST /api/auth/login
 *
 * Security rules:
 *   - Password is NEVER returned in any response.
 *   - Password is NEVER logged.
 *   - JWT_SECRET is read from environment only.
 *   - bcrypt hashing is handled by User.js pre-save hook.
 */

const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ── Helpers ───────────────────────────────────────────────────

/**
 * generateToken
 * Creates a signed JWT for the given user.
 * Payload carries only non-sensitive identity fields.
 */
const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};

/**
 * sanitizeUser
 * Returns a safe user object stripped of the password hash.
 * Never pass the raw Mongoose document directly to the client.
 */
const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  walletAddress: user.walletAddress,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// ── Validation helpers ────────────────────────────────────────
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
const VALID_ROLES = ["CONSUMER", "PROVIDER"];

// ── Controllers ───────────────────────────────────────────────

/**
 * register
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { name, email, password, role, walletAddress } = req.body;

    // ── Required field validation ──────────────────────────────
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required." });
    }

    // ── Format validation ──────────────────────────────────────
    if (!EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Invalid email format." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    // ── Role validation ────────────────────────────────────────
    const assignedRole = role ? role.toUpperCase() : "CONSUMER";
    if (!VALID_ROLES.includes(assignedRole)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${VALID_ROLES.join(", ")}.`,
      });
    }

    // ── Duplicate email check ──────────────────────────────────
    // Check before creation for a cleaner error message than the
    // Mongo duplicate key error (which we also catch below as fallback).
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email is already registered." });
    }

    // ── Create user ────────────────────────────────────────────
    // bcrypt hashing is handled by the pre-save hook in User.js
    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      role: assignedRole,
      walletAddress: walletAddress ? walletAddress.trim() : null,
    });

    // ── Generate JWT ───────────────────────────────────────────
    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    // Mongo duplicate key (race condition fallback)
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Email is already registered." });
    }
    // Mongoose validation error
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(" ") });
    }
    console.error("Register error:", err.message);
    return res.status(500).json({ success: false, message: "Server error during registration." });
  }
};

/**
 * login
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ── Required field validation ──────────────────────────────
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required." });
    }

    // ── Find user (explicitly select password for comparison) ──
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+password");

    if (!user) {
      // Generic message — do not reveal whether email exists
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // ── Compare password ───────────────────────────────────────
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // ── Generate JWT ───────────────────────────────────────────
    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
};

module.exports = { register, login };
