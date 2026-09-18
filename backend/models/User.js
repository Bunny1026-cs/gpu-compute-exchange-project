/**
 * models/User.js
 * User model — GPU Compute Exchange
 *
 * Represents both consumers (who submit jobs) and providers (who own GPUs).
 *
 * Relationships:
 *   User._id ← GPU.providerId   (one user owns many GPUs)
 *   User._id ← Job.consumerId   (one user submits many jobs)
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// ── Constants ─────────────────────────────────────────────────
const ROLES = Object.freeze({
  CONSUMER: "CONSUMER",
  PROVIDER: "PROVIDER",
});

// ── Schema ────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,           // enforced by index below
      lowercase: true,
      trim: true,
      match: [
        /^\S+@\S+\.\S+$/,
        "Please provide a valid email address",
      ],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,          // Never returned in queries by default
    },

    role: {
      type: String,
      enum: {
        values: Object.values(ROLES),
        message: "Role must be CONSUMER or PROVIDER",
      },
      default: ROLES.CONSUMER,
    },

    // Optional until wallet integration (Phase 3)
    walletAddress: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,         // adds createdAt + updatedAt automatically
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────
// email uniqueness is enforced by the `unique: true` field option above,
// which Mongoose translates to a unique index in MongoDB.
// No additional index needed here — email is already indexed.

// ── Pre-save Hook: Hash password ──────────────────────────────
userSchema.pre("save", async function () {
  // Only hash if password was modified (creation OR explicit change)
  // Mongoose 8.x: async pre-save resolves via returned Promise — no next()
  if (!this.isModified("password")) return;
  const saltRounds = 12;
  this.password = await bcrypt.hash(this.password, saltRounds);
});

// ── Instance Methods ──────────────────────────────────────────
/**
 * comparePassword
 * Securely compares a plain-text candidate password against the stored hash.
 * Usage: const isMatch = await user.comparePassword(candidatePassword);
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ── Exports ───────────────────────────────────────────────────
const User = mongoose.model("User", userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
