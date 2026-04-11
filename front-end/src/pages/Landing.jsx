import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import emblogo from "../assets/emblogo.svg";
import bplogo from "../assets/bagongpilipinaslogo.png";
import bgemb from "../assets/bgemb.webp";
import "./Landing.css";

export default function Landing() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("embr3-theme");
    if (stored) return stored;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    return "light";
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const landingRef = useRef(null);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-landing-theme", theme);
    localStorage.setItem("embr3-theme", theme);
    return () => document.documentElement.removeAttribute("data-landing-theme");
  }, [theme]);

  // Scroll effect for navbar
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-reveal animation
  useEffect(() => {
    const els = landingRef.current?.querySelectorAll(".animate-on-scroll");
    if (!els) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const parent = entry.target.parentElement;
            const siblings = parent ? Array.from(parent.querySelectorAll(".animate-on-scroll")) : [];
            const idx = siblings.indexOf(entry.target);
            setTimeout(() => entry.target.classList.add("visible"), idx >= 0 ? idx * 80 : 0);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Close mobile menu on scroll
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("scroll", close, { passive: true, once: true });
    return () => window.removeEventListener("scroll", close);
  }, [menuOpen]);

  // Lock body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  }, []);

  return (
    <div ref={landingRef} className={`landing-page ${theme === "dark" ? "landing-dark" : "landing-light"}`}>
      {/* NAVBAR */}
      <nav className={`lp-navbar${scrolled ? " scrolled" : ""}`}>
        <div className="lp-container lp-nav-inner">
          <a href="#" className="lp-nav-brand" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <div className="lp-nav-logos">
              <img src={emblogo} alt="EMBR3 Logo" className="lp-nav-logo" />
              <img src={bplogo} alt="Bagong Pilipinas" className="lp-nav-logo" />
            </div>
            <span className="lp-nav-title">EMBR3 <span className="lp-accent">ESWMP</span></span>
          </a>

          {/* Mobile backdrop */}
          {menuOpen && <div className="lp-mobile-backdrop" onClick={() => setMenuOpen(false)} />}

          <div className={`lp-mobile-menu${menuOpen ? " open" : ""}`}>
            <ul className="lp-nav-links">
              <li><a href="#features" onClick={(e) => { e.preventDefault(); scrollTo("features"); }}>Features</a></li>
              <li><a href="#preview" onClick={(e) => { e.preventDefault(); scrollTo("preview"); }}>Preview</a></li>
              <li><a href="#about" onClick={(e) => { e.preventDefault(); scrollTo("about"); }}>About</a></li>
              <li><a href="#modules" onClick={(e) => { e.preventDefault(); scrollTo("modules"); }}>Modules</a></li>
              <li><a href="#contact" onClick={(e) => { e.preventDefault(); scrollTo("contact"); }}>Contact</a></li>
            </ul>
            <div className="lp-mobile-menu-actions">
              <button className="lp-btn lp-btn-primary lp-btn-sm lp-mobile-cta" onClick={() => { setMenuOpen(false); scrollTo("contact"); }}>Get Started</button>
            </div>
          </div>

          <div className="lp-nav-actions">
            <button className="lp-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "light" ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>
              )}
            </button>
            <button className="lp-btn lp-btn-primary lp-btn-sm lp-nav-get-started" onClick={() => scrollTo("contact")}>Get Started</button>
            <button className={`lp-hamburger${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
              <span className="lp-hamburger-line" />
              <span className="lp-hamburger-line" />
              <span className="lp-hamburger-line" />
            </button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="lp-hero">
        <div className="lp-hero-bg-image" style={{ backgroundImage: `url(${bgemb})` }} />
        <div className="lp-hero-bg-overlay" />
        <div className="lp-hero-bg-shapes">
          <div className="lp-blur-orb lp-blur-orb-1" />
          <div className="lp-blur-orb lp-blur-orb-2" />
          <div className="lp-blur-orb lp-blur-orb-3" />
          <div className="lp-blur-orb lp-blur-orb-4" />
        </div>
        <div className="lp-container lp-hero-content">
          <div className="lp-hero-text animate-fade-up">
            <span className="lp-hero-badge">Environmental Management Bureau — Region III</span>
            <h1>Ecological Solid Waste<br /><span className="lp-gradient-text">Management Pipeline</span></h1>
            <p className="lp-hero-desc">
              A unified digital platform for streamlining solid waste management data collection,
              compliance monitoring, and environmental reporting across Region III.
            </p>
            <div className="lp-hero-cta">
              <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => navigate("/slfportal/login")}>
                <span>Access SLF Portal</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
              <button className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => navigate("/admin")}>Admin Dashboard</button>
            </div>
          </div>
          <div className="lp-hero-visual animate-fade-up delay-200">
            <div className="lp-devices-wrapper">
              {/* LAPTOP */}
              <div className="lp-laptop">
                <div className="lp-laptop-screen">
                  <div className="lp-browser-bar">
                    <div className="lp-browser-dots"><div className="lp-browser-dot" /><div className="lp-browser-dot" /><div className="lp-browser-dot" /></div>
                    <div className="lp-browser-url">embr3-onlinesystems.cloud/eswm-pipeline/admin</div>
                  </div>
                  <div className="lp-hero-mock-dashboard">
                    {/* Sidebar */}
                    <div className="lp-hero-mock-sidebar">
                      <div className="lp-hero-mock-sidebar-brand">
                        <img src={emblogo} alt="" className="lp-mock-sidebar-logo" />
                        <span className="lp-mock-sidebar-title">EMBR3 ESWMP</span>
                      </div>
                      {[
                        ["📊", "Dashboard", true],
                        ["🪤", "Trash Traps", false],
                        ["📋", "10-Yr SWM Plan", false],
                        ["🏢", "Funded MRFs", false],
                        ["🏗", "SLF Facilities", false],
                        ["🔄", "Transfer Stations", false],
                        ["📝", "PDS Scoping", false],
                        ["⚙️", "Settings", false],
                      ].map(([icon, label, active], i) => (
                        <div className={`lp-mock-sidebar-item${active ? " active" : ""}`} key={i}>
                          <span>{icon}</span><span>{label}</span>
                        </div>
                      ))}
                    </div>
                    {/* Main content */}
                    <div className="lp-hero-mock-main">
                      <div className="lp-hero-mock-topbar">
                        <div className="lp-hero-mock-topbar-title">Dashboard Overview</div>
                        <div className="lp-hero-mock-topbar-actions">
                          <div className="lp-hero-mock-topbar-year">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            <span>2026</span>
                          </div>
                          <div className="lp-hero-mock-avatar" />
                        </div>
                      </div>
                      <div className="lp-hero-mock-stats">
                        {[
                          ["Total LGUs", "142", "📊", "+12 this year"],
                          ["Compliant", "98", "✅", "69% rate"],
                          ["Non-Compliant", "44", "⚠️", "31% rate"],
                          ["Avg. Diversion %", "67.3%", "♻️", "+2.1% vs 2025"],
                        ].map(([label, value, icon, sub], i) => (
                          <div className="lp-hero-mock-stat-card" key={i}>
                            <div className="lp-hero-mock-stat-icon">{icon}</div>
                            <div className="lp-hero-mock-stat-info">
                              <div className="lp-hero-mock-stat-label">{label}</div>
                              <div className="lp-hero-mock-stat-value">{value}</div>
                              <div className="lp-hero-mock-stat-sub">{sub}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="lp-hero-mock-charts-row">
                        <div className="lp-hero-mock-chart-card lp-hero-mock-chart-wide">
                          <div className="lp-hero-mock-chart-header">
                            <span className="lp-mock-chart-title">Monthly Submissions — 10-Year SWM Plan</span>
                            <div className="lp-hero-mock-chart-tabs">
                              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
                                <span key={i} className={i <= 2 ? "lp-hero-mock-chart-tab-active" : ""}>{m}</span>
                              ))}
                            </div>
                          </div>
                          <div className="lp-hero-mock-bars-enhanced">
                            {[
                              { h: 62, label: "Bulacan" },
                              { h: 85, label: "Pampanga" },
                              { h: 48, label: "Tarlac" },
                              { h: 72, label: "N. Ecija" },
                              { h: 38, label: "Zambales" },
                              { h: 55, label: "Bataan" },
                              { h: 90, label: "Aurora" },
                            ].map((d, i) => (
                              <div className="lp-hero-mock-bar-group" key={i}>
                                <div className="lp-hero-mock-bar-track">
                                  <div className="lp-hero-mock-bar-fill" style={{ height: `${d.h}%`, animationDelay: `${i * 0.1}s` }} />
                                </div>
                                <span className="lp-hero-mock-bar-label">{d.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="lp-hero-mock-chart-card">
                          <span className="lp-mock-chart-title">Compliance by Province</span>
                          <div className="lp-hero-mock-donut-wrapper">
                            <div className="lp-hero-mock-donut">
                              <div className="lp-hero-mock-donut-center">
                                <span className="lp-hero-mock-donut-pct">69%</span>
                                <span className="lp-hero-mock-donut-sub">Compliant</span>
                              </div>
                            </div>
                          </div>
                          <div className="lp-hero-mock-legend">
                            {[
                              ["Compliant", "#2944A7", "98"],
                              ["Partial", "#39AC60", "26"],
                              ["Pending", "#4a6ae8", "12"],
                              ["Non-Comp.", "#ff6b6b", "6"],
                            ].map(([l, c, v], i) => (
                              <div className="lp-hero-mock-legend-item" key={i}>
                                <div className="lp-hero-mock-legend-dot" style={{ background: c }} />
                                <span className="lp-hero-mock-legend-label">{l}</span>
                                <span className="lp-hero-mock-legend-value">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="lp-hero-mock-table-card">
                        <div className="lp-hero-mock-chart-header">
                          <span className="lp-mock-chart-title">Recent Submissions</span>
                          <span className="lp-hero-mock-view-all">View All →</span>
                        </div>
                        <table className="lp-hero-mock-table">
                          <thead>
                            <tr><th>LGU / Company</th><th>Module</th><th>Status</th><th>Date</th></tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>City of San Fernando</td>
                              <td>10-Yr SWM Plan</td>
                              <td><span className="lp-mock-tag lp-mock-tag-ok">Compliant</span></td>
                              <td>Mar 28, 2026</td>
                            </tr>
                            <tr>
                              <td>Municipality of Guagua</td>
                              <td>Funded MRF</td>
                              <td><span className="lp-mock-tag lp-mock-tag-pending">Pending</span></td>
                              <td>Mar 25, 2026</td>
                            </tr>
                            <tr>
                              <td>Province of Bulacan</td>
                              <td>SLF Facility</td>
                              <td><span className="lp-mock-tag lp-mock-tag-ok">Compliant</span></td>
                              <td>Mar 22, 2026</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="lp-laptop-base">
                  <div className="lp-laptop-notch" />
                </div>
              </div>

              {/* PHONE */}
              <div className="lp-phone">
                <div className="lp-phone-notch" />
                <div className="lp-phone-screen">
                  <div className="lp-phone-statusbar">
                    <span>9:41</span>
                    <div className="lp-phone-statusbar-icons">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 0 0-6 0zm-4-4l2 2a7.074 7.074 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="17" y="4" width="4" height="16" rx="1"/><rect x="11" y="8" width="4" height="12" rx="1"/><rect x="5" y="12" width="4" height="8" rx="1"/></svg>
                    </div>
                  </div>
                  <div className="lp-phone-app">
                    <div className="lp-phone-app-header">
                      <img src={emblogo} alt="" className="lp-phone-app-logo" />
                      <div>
                        <div className="lp-phone-app-title">EMBR3 ESWMP</div>
                        <div className="lp-phone-app-subtitle">SLF Portal</div>
                      </div>
                    </div>
                    <div className="lp-phone-app-card">
                      <div className="lp-phone-app-card-title">Sample SLF Facility</div>
                      <div className="lp-phone-app-card-sub">Pampanga • Operational</div>
                      <div className="lp-phone-app-progress">
                        <div className="lp-phone-app-progress-bar">
                          <div className="lp-phone-app-progress-fill" />
                        </div>
                        <div className="lp-phone-app-progress-label">
                          <span>Capacity</span><span>68%</span>
                        </div>
                      </div>
                    </div>
                    <div className="lp-phone-app-section-title">Recent</div>
                    {[
                      ["SLF-2026-0342", "Acknowledged", "ok"],
                      ["SLF-2026-0298", "Pending", "pending"],
                      ["SLF-2026-0251", "Acknowledged", "ok"],
                    ].map(([id, status, type], i) => (
                      <div className="lp-phone-app-row" key={i}>
                        <div>
                          <div className="lp-phone-app-row-id">{id}</div>
                          <div className="lp-phone-app-row-date">{["Mar 15", "Feb 28", "Feb 10"][i]}, 2026</div>
                        </div>
                        <span className={`lp-mock-tag lp-mock-tag-${type}`}>{status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="lp-hero-scroll-indicator animate-fade-up delay-400">
          <span>Scroll to explore</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
        </div>
      </header>

      {/* FEATURES */}
      <section className="lp-section lp-features" id="features">
        <div className="lp-container">
          <div className="lp-section-header animate-on-scroll">
            <span className="lp-section-tag">Why ESWMP</span>
            <h2>Powerful Features for<br /><span className="lp-gradient-text">Waste Management</span></h2>
            <p>Built to digitize and streamline ecological solid waste management processes for government agencies and stakeholders.</p>
          </div>
          <div className="lp-features-grid">
            {[
              { icon: <><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></>, title: "Data Analytics", desc: "Comprehensive dashboards and visual reports for solid waste management data across the region." },
              { icon: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>, title: "Secure Access", desc: "Role-based authentication with encrypted data storage ensuring compliance and data privacy." },
              { icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>, title: "SLF Management", desc: "Manage Sanitary Landfill facilities, generators, and compliance documentation in one place." },
              { icon: <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>, title: "Online Portal", desc: "Cloud-based platform accessible anywhere, enabling real-time data submission and monitoring." },
              { icon: <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>, title: "Compliance Tracking", desc: "Track 10-year SWM plans, funded MRFs, transfer stations, and technical assistance programs." },
              { icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>, title: "Multi-User System", desc: "Separate portals for administrators and SLF generators with tailored workflows and permissions." },
            ].map((f, i) => (
              <div className="lp-feature-card animate-on-scroll" key={i}>
                <div className="lp-feature-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{f.icon}</svg>
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section className="lp-section lp-about" id="about">
        <div className="lp-container">
          <div className="lp-about-grid">
            <div className="lp-about-visual animate-on-scroll">
              <div className="lp-about-map-wrapper">
                {/* Region III Map — generated from faeldon/philippines-json-maps GeoJSON */}
                <svg className="lp-r3-map" viewBox="0 0 400 480" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="r3Fill" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#2944A7" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#39AC60" stopOpacity="0.18" />
                    </linearGradient>
                    <filter id="provGlow">
                      <feGaussianBlur stdDeviation="2" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  {/* Province shapes */}
                  <path className="lp-prov" data-prov="Bataan" d="M128.6 332.8 L125.1 331.1 L121.7 326.9 L117.4 318.6 L115.3 318.3 L109.7 319.3 L107.4 323.5 L98 327.5 L97.8 333.2 L100.8 336.8 L100.6 339.2 L88.9 344.6 L84.9 346.4 L84.6 351.3 L90.9 356.6 L94.2 360.8 L96.2 359.4 L99 361.8 L101.8 360.9 L105.4 366.3 L104 369.1 L105 373.5 L102.8 375.4 L104.8 384.7 L112.9 386.7 L115.8 390.3 L118.9 388.6 L128.6 390.2 L131.8 388.8 L136.5 382.1 L136.4 374.2 L133.4 366.1 L132.9 358.4 L127.5 346.4 L128.9 335.9 L128.6 332.8 Z" />
                  <path className="lp-prov" data-prov="Bulacan" d="M237.8 278.4 L229 277.9 L222.6 275.3 L219.6 268.7 L213.7 267.8 L209.6 268.7 L203.6 268.4 L193.5 271.6 L190.8 274.3 L182.6 275.8 L181.5 284.6 L185.3 287.3 L183.2 294.2 L178.8 294.6 L178.2 296.6 L180.5 299.6 L179.7 303.7 L175.3 305.9 L175.4 309.6 L172.1 310.4 L168.7 313.2 L160.1 317.9 L155.8 316.9 L153.3 319.9 L152.7 325.2 L149.4 331.4 L149.6 333.6 L147.8 340 L156.8 341.7 L159.6 340.9 L164.2 342.3 L166.9 341.5 L172 346 L178.9 349.6 L181.1 348.3 L184.6 351.7 L186.1 351 L182.2 345.3 L189.7 345.2 L191.4 342 L196.3 341.1 L196.9 338.5 L207.9 340 L216.6 332.4 L222.8 333.2 L224.4 331 L229.3 331.6 L240.4 330.8 L241.8 323.3 L241.5 314.6 L242.9 307.5 L238.9 290.2 L238.7 283.4 L237.8 278.4 Z" />
                  <path className="lp-prov" data-prov="Nueva Ecija" d="M233.8 198.4 L233.2 196.5 L220.8 174.2 L219.9 170.4 L220.5 163.3 L219.5 152.7 L217.9 150 L210 146.7 L205.5 146.6 L199.7 143.1 L192.7 143.3 L191.1 144.9 L184.2 143.8 L174.2 145.9 L174.8 149.5 L177.9 156.9 L181.4 167.9 L178.6 175.6 L174.7 178 L174.5 182 L172.1 186.5 L169.7 187.3 L166.8 192.8 L162.6 187.9 L154.1 184.5 L148.3 187.3 L145.8 187.2 L137.4 189.6 L139.3 201.7 L143.5 211.6 L149.2 218 L155.7 217.9 L156.5 221.6 L154.3 223 L152.7 227.7 L156.2 234.3 L155.9 242.1 L158.5 244.3 L158.6 246.8 L155.7 252.1 L155.2 259 L157.7 261 L154.6 267.1 L154.7 270 L159.5 270.8 L162.6 276.3 L169.5 278 L173.5 281.6 L177 280.3 L178.9 276.2 L182.6 275.8 L190.8 274.3 L193.5 271.6 L203.6 268.4 L209.6 268.7 L213.7 267.8 L219.6 268.7 L222.6 275.3 L229 277.9 L237.8 278.4 L240.9 264.4 L243.8 257.2 L241.8 251.9 L244.4 248.4 L247.3 237.2 L233.8 198.4 Z" />
                  <path className="lp-prov" data-prov="Pampanga" d="M154.6 267.1 L149.7 269.1 L145 267 L139.9 269.6 L134.3 268.7 L127.7 270.4 L124 274.4 L120 274.6 L112.2 278.1 L109.1 280.9 L101.8 282.9 L100.1 287.6 L101.4 291.4 L107.4 296.3 L109.6 301 L109.4 308.4 L113.3 312.7 L115.3 318.3 L117.4 318.6 L121.7 326.9 L125.1 331.1 L128.6 332.8 L133.2 332.3 L135.6 333.6 L142.8 340.4 L147.8 340 L149.6 333.6 L149.4 331.4 L152.7 325.2 L153.3 319.9 L155.8 316.9 L160.1 317.9 L168.7 313.2 L172.1 310.4 L175.4 309.6 L175.3 305.9 L179.7 303.7 L180.5 299.6 L178.2 296.6 L178.8 294.6 L183.2 294.2 L185.3 287.3 L181.5 284.6 L182.6 275.8 L178.9 276.2 L177 280.3 L173.5 281.6 L169.5 278 L162.6 276.3 L159.5 270.8 L154.7 270 L154.6 267.1 Z" />
                  <path className="lp-prov" data-prov="Tarlac" d="M137.4 189.6 L135.8 183 L133.8 182.8 L132.4 187.5 L128.2 197 L124.2 198.1 L116.2 203 L110.4 198.5 L105.6 198.2 L101 201.1 L100.4 204.5 L96 209 L93.6 214.2 L87.1 214.9 L85.2 218 L86.9 220.9 L81 224 L76.1 232.7 L73.7 243.9 L72.6 254.9 L89.5 265.3 L97.2 273.1 L101.8 282.9 L109.1 280.9 L112.2 278.1 L120 274.6 L124 274.4 L127.7 270.4 L134.3 268.7 L139.9 269.6 L145 267 L149.7 269.1 L154.6 267.1 L157.7 261 L155.2 259 L155.7 252.1 L158.6 246.8 L158.5 244.3 L155.9 242.1 L156.2 234.3 L152.7 227.7 L154.3 223 L156.5 221.6 L155.7 217.9 L149.2 218 L143.5 211.6 L139.3 201.7 L137.4 189.6 Z" />
                  <path className="lp-prov" data-prov="Zambales" d="M85.2 218 L79.4 208 L74.4 201.1 L71.7 195.9 L69.6 188 L65.1 187.6 L57.6 185.5 L54.1 181.1 L51.7 181.4 L48.7 189 L45 191.1 L34.7 190.8 L34.5 196 L35.8 198.4 L30 201 L33.7 204.6 L39.1 207 L39 211 L36.7 216.9 L35.1 217.7 L37 223 L40.2 226.6 L43.3 234.4 L41.3 237.6 L34.4 238.2 L36.5 243.1 L33 244.9 L34.8 248.4 L39.6 252.1 L44.1 257.6 L43.6 259.8 L51.2 268.9 L50.4 272.7 L53.1 279.7 L57.4 298.1 L56.6 301.9 L58 304.4 L58.1 308.9 L56.9 316 L57.8 318.8 L56.7 322.3 L58.3 326.2 L60.9 328.2 L63.6 334.7 L60.9 337.7 L67.7 339.3 L70.2 342.1 L76.1 342.9 L78.1 336.1 L79.8 334.5 L78.7 325.1 L81.3 324.6 L84.1 328.7 L87.3 329 L87.4 332.4 L89.7 335.7 L86 340.9 L85.8 343.5 L88.9 344.6 L100.6 339.2 L100.8 336.8 L97.8 333.2 L98 327.5 L107.4 323.5 L109.7 319.3 L115.3 318.3 L113.3 312.7 L109.4 308.4 L109.6 301 L107.4 296.3 L101.4 291.4 L100.1 287.6 L101.8 282.9 L97.2 273.1 L89.5 265.3 L72.6 254.9 L73.7 243.9 L76.1 232.7 L81 224 L86.9 220.9 L85.2 218 Z" />
                  <path className="lp-prov" data-prov="Aurora" d="M242.9 307.5 L244.3 305.3 L243.4 301.8 L246.7 293.2 L249.7 291.7 L251.6 280.7 L250.8 277.7 L252.9 275.4 L247.6 265.2 L246.5 260.7 L248.3 254.4 L250.9 251.6 L254.1 253.6 L258.5 247.7 L260.9 247 L263.2 240.4 L262.6 237.4 L263.8 232 L266.6 228.9 L269.2 228.4 L271 224.1 L278.7 214.5 L281.7 212.3 L280.8 205.1 L284.6 205 L284.5 199.1 L279 197.2 L277 198.4 L274.1 196.4 L272.3 190.3 L271.7 183 L272.7 177.8 L276.4 173.4 L279.3 172.4 L283 168 L286.9 166.9 L288.6 162.2 L296.1 157.1 L302 152 L305.1 154 L309.9 150.5 L313.3 150 L316.9 146.3 L323.5 144.4 L327.8 144.9 L332.1 143.4 L334.3 140.4 L339.8 137.1 L342.2 137.9 L346.6 135.5 L346 130.8 L349 125.7 L351.9 125.1 L356.9 126.1 L353.8 132.2 L350.5 133.5 L350.4 138.3 L345.7 144.3 L341.7 146.9 L336 156.7 L341.5 155.7 L346.9 149.7 L347.2 145.4 L352.2 141.5 L357.4 135.2 L366.1 128.8 L366.8 123.9 L362.7 119.3 L364.3 114.9 L369.2 111.6 L369.7 106.1 L365.7 103.2 L365.5 100.5 L370 96.2 L367.7 93.9 L345.3 89.7 L340.4 96 L332.1 105.4 L321.5 119.5 L314.6 127.1 L305.3 135.2 L303 138 L297 142.2 L283.4 153.8 L269 167.3 L261.2 173.1 L260.7 179.3 L246.7 187.2 L238.6 191.1 L233.8 198.4 L247.3 237.2 L244.4 248.4 L241.8 251.9 L243.8 257.2 L240.9 264.4 L237.8 278.4 L238.7 283.4 L238.9 290.2 L242.9 307.5 Z" />
                  {/* Province labels */}
                  <text className="lp-prov-label" x="111.6" y="358">Bataan</text>
                  <text className="lp-prov-label" x="193" y="317">Bulacan</text>
                  <text className="lp-prov-label" x="186" y="221">Nueva Ecija</text>
                  <text className="lp-prov-label" x="146.5" y="301">Pampanga</text>
                  <text className="lp-prov-label" x="124.4" y="236">Tarlac</text>
                  <text className="lp-prov-label" x="68.2" y="275">Zambales</text>
                  <text className="lp-prov-label" x="297.3" y="187">Aurora</text>
                  {/* Capital pin — San Fernando, Pampanga */}
                  <circle className="lp-map-pulse" cx="135" cy="300" r="6" />
                  <circle className="lp-map-pulse lp-pulse-delay" cx="186" cy="221" r="6" />
                  <circle className="lp-capital-pin" cx="135" cy="300" r="4" />
                </svg>

                {/* Floating data cards */}
                <div className="lp-map-stat lp-map-stat-1">
                  <span className="lp-map-stat-num">7</span>
                  <span className="lp-map-stat-lbl">Provinces Covered</span>
                </div>
                <div className="lp-map-stat lp-map-stat-2">
                  <span className="lp-map-stat-num">12</span>
                  <span className="lp-map-stat-lbl">Active Modules</span>
                </div>
                <div className="lp-map-stat lp-map-stat-3">
                  <span className="lp-map-stat-num">100%</span>
                  <span className="lp-map-stat-lbl">Digital Compliance</span>
                </div>
                <div className="lp-map-stat lp-map-stat-4">
                  <span className="lp-map-stat-num">24/7</span>
                  <span className="lp-map-stat-lbl">System Monitoring</span>
                </div>

                {/* Region label */}
                <div className="lp-map-region-label">
                  <span className="lp-map-region-dot"></span>
                  Region III — Central Luzon
                </div>
              </div>
            </div>
            <div className="lp-about-text animate-on-scroll">
              <span className="lp-section-tag">About ESWMP</span>
              <h2>Digitizing Environmental <span className="lp-gradient-text">Governance</span></h2>
              <p>
                The Ecological Solid Waste Management Pipeline (ESWMP) is a digital platform developed for the
                Environmental Management Bureau (EMB) Region III. It serves as a centralized system for managing
                waste-related data, compliance documentation, and environmental reporting.
              </p>
              <ul className="lp-about-list">
                {[
                  "Centralized data management for all waste facilities",
                  "Real-time monitoring and compliance tracking",
                  "Automated notifications and approval workflows",
                  "Exportable reports and data history tracking",
                ].map((item, i) => (
                  <li key={i}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* MODULES */}
      <section className="lp-section lp-modules" id="modules">
        <div className="lp-container">
          <div className="lp-section-header animate-on-scroll">
            <span className="lp-section-tag">System Modules</span>
            <h2>Comprehensive <span className="lp-gradient-text">Data Modules</span></h2>
            <p>A complete suite of modules covering every aspect of solid waste management compliance and monitoring.</p>
          </div>
          <div className="lp-modules-grid">
            {[
              ["🏗️","SLF Facilities"],["🏭","SLF Generators"],["📋","10-Year SWM Plans"],["🏢","Funded MRFs"],
              ["🔄","Transfer Stations"],["🪤","Trash Traps"],["🛠️","Technical Assistance"],["⚙️","SWM Equipment"],
              ["🚯","Open Dumpsites"],["♻️","LGU Diversion"],["📊","Residual Containment"],["📝","Project Scoping"],
            ].map(([icon, label], i) => (
              <div className="lp-module-card animate-on-scroll" key={i}>
                <span className="lp-module-icon">{icon}</span><span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* APP PREVIEW — Dashboard */}
      <section className="lp-section lp-showcase" id="preview">
        <div className="lp-container">
          <div className="lp-showcase-grid">
            <div className="lp-showcase-text animate-on-scroll">
              <span className="lp-section-tag">App Preview</span>
              <h2>Powerful Admin<br /><span className="lp-gradient-text">Dashboard</span></h2>
              <p>Monitor all solid waste management data from a single, intuitive dashboard. Interactive maps, real-time statistics, and compliance tracking at your fingertips.</p>
              <ul className="lp-showcase-highlights">
                {["Interactive GIS maps with province boundaries", "Real-time compliance statistics per LGU", "Tabbed modules for every SWM data category", "Monthly submission trends and analytics"].map((item, i) => (
                  <li key={i}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="lp-showcase-badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Admin Access Only
              </div>
            </div>
            <div className="animate-on-scroll">
              <div className="lp-showcase-frame">
                <div className="lp-browser-bar">
                  <div className="lp-browser-dots"><div className="lp-browser-dot" /><div className="lp-browser-dot" /><div className="lp-browser-dot" /></div>
                  <div className="lp-browser-url">embr3-onlinesystems.cloud/eswm-pipeline/admin</div>
                </div>
                <div className="lp-mock-dashboard">
                  <div className="lp-mock-sidebar">
                    <div className="lp-mock-sidebar-brand">
                      <img src={emblogo} alt="" className="lp-mock-sidebar-logo" />
                      <span className="lp-mock-sidebar-title">EMBR3 ESWMP</span>
                    </div>
                    {["📊 Dashboard", "🪤 Trash Traps", "📋 10-Yr SWM Plan", "🏢 Funded MRFs", "🏗 SLF Facilities", "📝 PDS Scoping", "⚙️ Settings"].map((item, i) => (
                      <div className={`lp-mock-sidebar-item${i === 0 ? " active" : ""}`} key={i}>{item}</div>
                    ))}
                  </div>
                  <div className="lp-mock-content">
                    <div className="lp-mock-stats">
                      {[["Total LGUs", "142"], ["Compliant", "98"], ["Non-Compliant", "44"], ["Diversion %", "67.3%"]].map(([label, val], i) => (
                        <div className="lp-mock-stat-card" key={i}>
                          <div className="lp-mock-stat-label">{label}</div>
                          <div className="lp-mock-stat-value">{val}</div>
                        </div>
                      ))}
                    </div>
                    <div className="lp-mock-charts">
                      <div className="lp-mock-chart-card">
                        <div className="lp-mock-chart-title">Monthly Submissions</div>
                        <div className="lp-mock-bars">
                          {[45, 68, 52, 78, 90, 65, 82, 58, 73, 88, 95, 70].map((h, i) => (
                            <div className="lp-mock-bar" key={i} style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }} />
                          ))}
                        </div>
                      </div>
                      <div className="lp-mock-chart-card">
                        <div className="lp-mock-chart-title">Compliance Status</div>
                        <div className="lp-mock-donut" />
                        <div className="lp-mock-legend">
                          {[["Compliant", "#2944A7"], ["Partial", "#39AC60"], ["Pending", "#4a6ae8"], ["Non-Compliant", "var(--lp-border)"]].map(([l, c], i) => (
                            <div className="lp-mock-legend-item" key={i}>
                              <div className="lp-mock-legend-dot" style={{ background: c }} />
                              <span>{l}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SLF PORTAL HIGHLIGHT */}
      <section className="lp-section lp-showcase lp-showcase-portal">
        <div className="lp-container">
          <div className="lp-showcase-grid" style={{ direction: "rtl" }}>
            <div className="lp-showcase-text animate-on-scroll" style={{ direction: "ltr" }}>
              <span className="lp-section-tag">SLF Portal</span>
              <h2>Streamlined <span className="lp-gradient-text">SLF Data Entry</span></h2>
              <p>Dedicated portal for Sanitary Landfill facility operators to submit disposal data, track submission history, and manage compliance documentation — all in one secure interface.</p>
              <ul className="lp-showcase-highlights">
                {["Assigned SLF facility with capacity monitoring", "Truck-level disposal data entry with waste types", "Submission history with status tracking", "Automatic notifications for acknowledgment & reverts"].map((item, i) => (
                  <li key={i}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button className="lp-btn lp-btn-primary lp-btn-sm" onClick={() => navigate("/slfportal/login")} style={{ marginTop: 14 }}>
                <span>Go to SLF Portal</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
            </div>
            <div className="animate-on-scroll" style={{ direction: "ltr" }}>
              <div className="lp-showcase-frame">
                <div className="lp-browser-bar">
                  <div className="lp-browser-dots"><div className="lp-browser-dot" /><div className="lp-browser-dot" /><div className="lp-browser-dot" /></div>
                  <div className="lp-browser-url">embr3-onlinesystems.cloud/eswm-pipeline/slfportal</div>
                </div>
                <div className="lp-mock-portal">
                  <div className="lp-mock-portal-sidebar">
                    <div className="lp-mock-portal-brand">
                      <img src={emblogo} alt="" className="lp-mock-portal-logo" />
                      <div className="lp-mock-portal-title">SLF Portal<span>EMBR3 ESWMP</span></div>
                    </div>
                    <div className="lp-mock-portal-nav">
                      <div className="lp-mock-portal-nav-item active">📝 Data Entry</div>
                      <div className="lp-mock-portal-nav-item">📜 Submission History</div>
                    </div>
                  </div>
                  <div className="lp-mock-portal-content">
                    <div className="lp-mock-portal-header">
                      <div className="lp-mock-portal-header-title">Data Entry</div>
                      <div className="lp-mock-portal-header-badge">
                        <div className="lp-mock-portal-header-dot" />
                        Online
                      </div>
                    </div>
                    <div className="lp-mock-facility-card">
                      <div className="lp-mock-facility-name">Sample Sanitary Landfill Facility</div>
                      <div className="lp-mock-facility-info">Pampanga • Operational • Last submission: Mar 2026</div>
                      <div className="lp-mock-progress-bar">
                        <div className="lp-mock-progress-fill" style={{ width: "68%" }} />
                      </div>
                      <div className="lp-mock-progress-label">
                        <span>Volume Capacity</span>
                        <span>68%</span>
                      </div>
                    </div>
                    <table className="lp-mock-table">
                      <thead>
                        <tr><th>Submission ID</th><th>Status</th><th>Date</th></tr>
                      </thead>
                      <tbody>
                        <tr><td>SLF-2026-0342</td><td><span className="lp-mock-tag lp-mock-tag-ok">Acknowledged</span></td><td>Mar 15, 2026</td></tr>
                        <tr><td>SLF-2026-0298</td><td><span className="lp-mock-tag lp-mock-tag-pending">Pending</span></td><td>Feb 28, 2026</td></tr>
                        <tr><td>SLF-2026-0251</td><td><span className="lp-mock-tag lp-mock-tag-ok">Acknowledged</span></td><td>Feb 10, 2026</td></tr>
                        <tr><td>SLF-2025-0189</td><td><span className="lp-mock-tag lp-mock-tag-rejected">Rejected</span></td><td>Jan 22, 2026</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-section lp-cta">
        <div className="lp-cta-bg-shapes">
          <div className="lp-blur-orb lp-blur-orb-1" />
          <div className="lp-blur-orb lp-blur-orb-2" />
        </div>
        <div className="lp-container lp-cta-content animate-on-scroll">
          <h2>Ready to Streamline Your<br /><span className="lp-gradient-text">Waste Management Data?</span></h2>
          <p>Join the digital transformation of ecological solid waste management in Region III. Access the platform today.</p>
          <div className="lp-cta-buttons">
            <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => navigate("/slfportal/login")}>
              <span>Access SLF Portal</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <button className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => scrollTo("contact")}>Contact Us</button>
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section className="lp-section lp-contact" id="contact">
        <div className="lp-container">
          <div className="lp-section-header animate-on-scroll">
            <span className="lp-section-tag">Get in Touch</span>
            <h2>Contact <span className="lp-gradient-text">Our Team</span></h2>
            <p>Have questions about ESWMP? Reach out to the Environmental Management Bureau Region III.</p>
          </div>
          <div className="lp-contact-grid">
            <div className="lp-contact-card animate-on-scroll">
              <div className="lp-contact-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </div>
              <h3>Email</h3>
              <a href="mailto:eswmr3@emb.gov.ph">eswmr3@emb.gov.ph</a>
            </div>
            <div className="lp-contact-card animate-on-scroll">
              <div className="lp-contact-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </div>
              <h3>Phone</h3>
              <a href="tel:+630459633623">(045) 963 3623 local 116</a>
            </div>
            <div className="lp-contact-card animate-on-scroll">
              <div className="lp-contact-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </div>
              <h3>Website</h3>
              <a href="https://r3.emb.gov.ph/" target="_blank" rel="noopener noreferrer">r3.emb.gov.ph</a>
            </div>
            <div className="lp-contact-card lp-contact-card-wide animate-on-scroll">
              <div className="lp-contact-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <h3>Office Address</h3>
              <p>Masinop corner Matalino Street, Diosdado Macapagal Government Center,<br />Maimpis, San Fernando City, Pampanga</p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-footer-logos">
              <img src={emblogo} alt="EMBR3 Logo" className="lp-footer-logo" />
              <img src={bplogo} alt="Bagong Pilipinas" className="lp-footer-logo" />
            </div>
            <span className="lp-footer-title">EMBR3 <span className="lp-accent">ESWMP</span></span>
          </div>
          <p className="lp-footer-copy">&copy; 2026 Environmental Management Bureau Region III. All rights reserved.</p>
          <div className="lp-footer-links">
            <a href="#" onClick={(e) => { e.preventDefault(); navigate("/slfportal/login"); }}>SLF Portal</a>
            <a href="#" onClick={(e) => { e.preventDefault(); navigate("/admin"); }}>Admin</a>
            <a href="mailto:eswmr3@emb.gov.ph">Contact</a>
            <a href="https://r3.emb.gov.ph/" target="_blank" rel="noopener noreferrer">EMB R3</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
