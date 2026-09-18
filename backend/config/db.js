/**
 * config/db.js
 * MongoDB connection module — GPU Compute Exchange
 *
 * Reads MONGODB_URI from environment variables.
 * Never hard-code credentials here.
 *
 * Usage:
 *   const connectDB = require('./config/db');
 *   await connectDB();
 */

const mongoose = require("mongoose");

/**
 * connectDB
 * Establishes a Mongoose connection to MongoDB.
 * Logs success or error; does NOT crash the process on failure
 * (allows the server to still serve non-DB routes / health checks).
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error(
      "❌  MONGODB_URI is not defined in environment variables.\n" +
        "    Copy backend/.env.example to backend/.env and set MONGODB_URI."
    );
    // Do not exit — let the server stay up so health-check still works
    return;
  }

  try {
    const conn = await mongoose.connect(uri, {
      // Recommended Mongoose 7+ options
      serverSelectionTimeoutMS: 5000, // Fail fast if Mongo unreachable
      socketTimeoutMS: 45000,
    });

    console.log(`✅  MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`❌  MongoDB connection failed: ${err.message}`);
    // Do not call process.exit() — keep server alive for debugging
  }
};

// Re-emit Mongoose connection events for operational visibility
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️   MongoDB disconnected.");
});

mongoose.connection.on("reconnected", () => {
  console.log("🔄  MongoDB reconnected.");
});

module.exports = connectDB;
