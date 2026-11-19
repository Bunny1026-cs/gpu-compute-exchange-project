/**
 * pages/Register.jsx
 * User registration page — Consumer or Provider
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Alert from "../components/Alert";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: "", email: "", password: "", role: "CONSUMER", walletAddress: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Basic client-side validation
    if (!form.name.trim())  return setError("Name is required.");
    if (!form.email.trim()) return setError("Email is required.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");

    setLoading(true);
    try {
      const payload = { name: form.name, email: form.email, password: form.password, role: form.role };
      if (form.walletAddress.trim()) payload.walletAddress = form.walletAddress.trim();

      const user = await register(payload);
      navigate(user.role === "PROVIDER" ? "/provider" : "/consumer", { replace: true });
    } catch (err) {
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Choose a role to set up your workspace.</p>
        </div>

        <Alert type="error" message={error} onClose={() => setError("")} />

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label" htmlFor="name">Full Name</label>
            <input className="form-input" type="text" id="name" name="name" value={form.name} onChange={handleChange} placeholder="Your name" required disabled={loading} />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input className="form-input" type="email" id="email" name="email" value={form.email} onChange={handleChange} placeholder="you@example.com" required disabled={loading} />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input className="form-input" type="password" id="password" name="password" value={form.password} onChange={handleChange} placeholder="Min. 8 characters" required disabled={loading} />
          </div>

          <div className="form-group">
            <label className="form-label">I am a…</label>
            <div className="role-toggle">
              {["CONSUMER", "PROVIDER"].map((r) => (
                <button key={r} type="button"
                  aria-pressed={form.role === r}
                  className={`role-btn ${form.role === r ? "active" : ""}`}
                  onClick={() => setForm((f) => ({ ...f, role: r }))}
                  disabled={loading}
                >
                  {r === "CONSUMER" ? "Consumer" : "Provider"}
                </button>
              ))}
            </div>
            <p className="form-hint">
              {form.role === "CONSUMER" ? "Submit compute jobs and retrieve verified results." : "Register GPUs and earn by executing jobs."}
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="walletAddress">Wallet Address <span className="form-optional">(optional)</span></label>
            <input className="form-input" type="text" id="walletAddress" name="walletAddress" value={form.walletAddress} onChange={handleChange} placeholder="0x…" disabled={loading} />
          </div>

          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? "Creating Account…" : "Create Account"}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login" className="auth-link">Log in</Link>
        </p>
      </div>
    </div>
  );
}
