import React from 'react';

function Sidebar({ tabs, activeTab, onTabChange, roleLabel, fullName, onLogout }) {
  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <img src="/favicon.png" alt="Sunnybell Height Concept Ltd" className="sidebar-logo" />
        <div className="ruler-tick" />
      </div>

      <nav className="sidebar-nav">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={activeTab === t.id ? 'sidebar-link active' : 'sidebar-link'}
            onClick={() => onTabChange(t.id)}
          >
            <span>{t.label}</span>
            {t.badge > 0 && <span className="sidebar-badge">{t.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="ruler-tick" />
        <div className="sidebar-user">
          <span className="sidebar-role">{roleLabel}</span>
          <span className="sidebar-name">{fullName}</span>
        </div>
        <button className="sidebar-logout" onClick={onLogout}>Log Out</button>
      </div>
    </div>
  );
}

export default Sidebar;
