/**
 * components/Navbar.jsx
 * Role-aware navigation bar
 */
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="logo" style={{ textDecoration: "none" }}>
          <span className="logo-icon">⚡</span>
          <span className="logo-text">GPU Compute Exchange</span>
        </Link>

        <nav className="nav">
          {!isAuthenticated ? (
            <>
              <Link to="/" className="nav-link">Home</Link>
              <Link to="/login" className="nav-link">Login</Link>
              <Link to="/register" className="btn btn-primary" style={{ textDecoration: "none", padding: "8px 18px", borderRadius: "8px" }}>
                Register
              </Link>
            </>
          ) : user?.role === "CONSUMER" ? (
            <>
              <Link to="/consumer" className="nav-link">Dashboard</Link>
              <Link to="/consumer/jobs" className="nav-link">My Jobs</Link>
              <span className="nav-user">👤 {user.name}</span>
              <button className="btn btn-ghost" onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <>
              <Link to="/provider" className="nav-link">Dashboard</Link>
              <Link to="/provider/gpus" className="nav-link">My GPUs</Link>
              <span className="nav-user">🖥️ {user.name}</span>
              <button className="btn btn-ghost" onClick={handleLogout}>Logout</button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
