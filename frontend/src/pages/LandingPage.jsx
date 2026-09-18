/**
 * pages/LandingPage.jsx
 * Public landing page — preserves existing design from Phase 1
 */
import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <div className="app">
      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-badge">⚡ Complete — Full Pipeline Live</div>
        <h1 className="hero-title">
          Decentralized<br />
          <span className="gradient-text">GPU Compute</span><br />
          Marketplace
        </h1>
        <p className="hero-subtitle">
          Rent GPU compute on-demand. Submit ML jobs. Track results.
          Powered by MongoDB Atlas, Express, and React.
        </p>
        <div className="hero-actions">
          <Link to="/register" className="btn btn-primary btn-lg">Get Started →</Link>
          <Link to="/login"    className="btn btn-ghost btn-lg">Sign In</Link>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="section">
        <h2 className="section-title">System Architecture</h2>
        <div className="arch-flow">
          {[
            { icon: "👤", label: "Consumer" },
            { icon: "⚙️", label: "Backend API" },
            { icon: "🗄️", label: "MongoDB Atlas" },
            { icon: "📋", label: "Job Queue" },
            { icon: "🔀", label: "Scheduler" },
            { icon: "🖥️", label: "GPU Worker" },
            { icon: "🐳", label: "Docker" },
            { icon: "🌐", label: "IPFS" },
          ].map((step, i) => (
            <div key={i} className="arch-step">
              <div className="arch-icon">{step.icon}</div>
              <div className="arch-label">{step.label}</div>
              {i < 7 && <div className="arch-arrow">→</div>}
            </div>
          ))}
        </div>
        <div className="arch-blockchain">
          <span className="arch-icon">📜</span>
          <span>Smart Contract (Solidity) → Blockchain → Escrow / Payment</span>
        </div>
      </section>

      {/* ── Roles ── */}
      <section className="section">
        <h2 className="section-title">Choose Your Role</h2>
        <div className="role-cards-row">
          <div className="role-feature-card">
            <div className="role-card-icon">🧑‍💻</div>
            <h3>Consumer</h3>
            <ul className="feature-list">
              <li>✅ Register &amp; Login</li>
              <li>✅ Browse available GPUs</li>
              <li>✅ Submit ML compute jobs</li>
              <li>✅ Track job status in real-time</li>
              <li>✅ Pay via blockchain escrow</li>
              <li>✅ Retrieve results from IPFS</li>
            </ul>
            <Link to="/register" className="btn btn-primary" style={{ marginTop: 20, textDecoration: "none" }}>Start as Consumer</Link>
          </div>
          <div className="role-feature-card">
            <div className="role-card-icon">🖥️</div>
            <h3>GPU Provider</h3>
            <ul className="feature-list">
              <li>✅ Register &amp; Login</li>
              <li>✅ Register GPU (model, VRAM, CUDA)</li>
              <li>✅ Set price &amp; availability</li>
              <li>✅ Manage your GPU fleet</li>
              <li>✅ Execute assigned jobs</li>
              <li>✅ Receive payment on completion</li>
            </ul>
            <Link to="/register" className="btn btn-primary" style={{ marginTop: 20, textDecoration: "none" }}>Start as Provider</Link>
          </div>
        </div>
      </section>

      {/* ── Dev Phases ── */}
      <section className="section">
        <h2 className="section-title">Development Progress</h2>
        <div className="phases-grid">
          {[
            { phase: "Phase 1", label: "Project Scaffold",         status: "done" },
            { phase: "Phase 2", label: "Database — MongoDB Atlas",  status: "done" },
            { phase: "Phase 3", label: "Auth + Backend APIs",       status: "done" },
            { phase: "Phase 4", label: "React Frontend",            status: "done" },
            { phase: "Phase 5", label: "Smart Contracts",           status: "done" },
            { phase: "Phase 6", label: "GPU Worker + Docker",       status: "done" },
            { phase: "Phase 7", label: "Scheduler + Job Queue",     status: "done" },
            { phase: "Phase 8", label: "IPFS + Full Pipeline",      status: "done" },
          ].map((p, i) => (
            <div key={i} className={`phase-card ${p.status}`}>
              <div className="phase-badge">{p.phase}</div>
              <div className="phase-label">{p.label}</div>
              <div className="phase-status">{p.status === "done" ? "✅ Complete" : "⏳ Pending"}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <p>GPU Compute Exchange · Decentralized · Trustless · Scalable</p>
      </footer>
    </div>
  );
}
