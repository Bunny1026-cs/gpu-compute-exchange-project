import { Link } from "react-router-dom";
import accelerator from "../assets/accelerator.webp";

export default function LandingPage() {
  return <div className="landing">
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Distributed GPU Compute Exchange</p>
        <h1>GPU compute,<br /><em>on demand.</em></h1>
        <p className="hero-intro">Run matrix workloads on provider hardware. Track each job from reservation to verified output and escrow settlement.</p>
        <div className="hero-actions"><Link to="/register" className="btn btn-primary">Create an account <span aria-hidden="true">↗</span></Link><Link to="/login" className="btn btn-ghost">Sign in</Link></div>
      </div>
      <img className="hero-image" src={accelerator} alt="Studio illustration of a GPU accelerator with exposed cooling fins" />
    </section>
    <section className="workflow"><h2>How the exchange works</h2><div className="workflow-grid">
      <article><h3>Reserve compute</h3><p>Set matrix dimensions, hardware requirements and runtime. Review the quote before funding with local test ETH.</p></article>
      <article><h3>Connect a worker</h3><p>Register a provider slot and connect your worker. The scheduler matches funded jobs with available hardware.</p></article>
      <article><h3>Verify and settle</h3><p>Inspect the numerical result, download the artifact and trace payment through the confirmed transaction receipts.</p></article>
    </div></section>
  </div>;
}
