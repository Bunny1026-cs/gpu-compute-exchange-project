import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Brand from "./Brand";

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const provider = user?.role === "PROVIDER";
  const root = provider ? "/provider" : "/consumer";
  return <header className="header"><div className="header-inner">
    <Link to="/" className="logo" aria-label="BDGCE home"><Brand /></Link>
    {isAuthenticated ? <>
      <nav className="workspace-nav" aria-label="Workspace">
        <NavLink end to={root}>Dashboard</NavLink>
        {provider && <NavLink to="/provider/gpus">My GPUs</NavLink>}
        <NavLink to={root + "/jobs"}>Jobs</NavLink>
      </nav>
      <div className="account-nav"><span className="account-name">{user.name}<small>{provider ? "Provider" : "Consumer"}</small></span>
        <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate("/login"); }}>Logout</button></div>
    </> : <nav className="public-nav" aria-label="Main navigation">
      <NavLink to="/login">Sign in</NavLink><Link className="btn btn-primary" to="/register">Create account</Link>
    </nav>}
  </div></header>;
}
