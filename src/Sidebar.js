import React, { useState } from 'react';

function Sidebar({ tabs, activeTab, onTabChange, roleLabel, fullName, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleTabClick = (id) => {
    onTabChange(id);
    setMobileOpen(false);
  };

  return (
    <div className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top">
        <img src="/favicon.png" alt="Sunnybell Height Concept Ltd" className="sidebar-logo" />
        <div className="ruler-tick" />

        <button
          className="sidebar-toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      <nav className={`sidebar-nav ${mobileOpen ? 'sidebar-nav-open' : ''}`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={activeTab === t.id ? 'sidebar-link active' : 'sidebar-link'}
            onClick={() => handleTabClick(t.id)}
          >
            <span>{t.label}</span>
            {t.badge > 0 && <span className="sidebar-badge">{t.badge}</span>}
          </button>
        ))}

        <div className="sidebar-bottom">
          <div className="ruler-tick" />
          <div className="sidebar-user">
            <span className="sidebar-role">{roleLabel}</span>
            <span className="sidebar-name">{fullName}</span>
          </div>
          <button className="sidebar-logout" onClick={onLogout}>Log Out</button>
        </div>
      </nav>
    </div>
  );
}

export default Sidebar;
