/**
 * Control Dashboard CSS — extracted from control-ui.ts.
 * Pure static stylesheet, no dynamic interpolations.
 */

export function getControlCSS(): string {
	return `:root {
  color-scheme: light;
  --bg: #f0f2f5;
  --panel: #ffffff;
  --panel-hover: #f8f9fa;
  --line: rgba(0,0,0,0.08);
  --text: #1a1a1a;
  --text-secondary: #65676b;
  --accent: #0084ff;
  --accent-hover: #0073e6;
  --accent-soft: #e7f3ff;
  --ok: #31a24c;
  --warn: #f0932b;
  --err: #e74c3c;
  --radius: 18px;
  --radius-sm: 12px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.1);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --transition: 0.15s ease;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  overflow: hidden;
}

/* ── Layout: sidebar + main like webchat ── */
.app {
  height: 100vh;
  display: grid;
  grid-template-columns: 320px 1fr;
}

/* ── Sidebar ── */
.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 12px;
}
.sidebar-header .logo {
  width: 36px; height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0f2742, #1f6feb);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.sidebar-header .logo img {
  width: 100%; height: 100%; object-fit: cover;
}
.sidebar-header .title { font-size: 16px; font-weight: 600; }
.sidebar-header .subtitle { font-size: 11px; color: var(--text-secondary); }
.sidebar-actions {
  padding: 12px 16px;
  display: flex; gap: 8px;
}
.sidebar-actions button, .sidebar-actions a {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  text-align: center;
  transition: background var(--transition);
}
.sidebar-actions button:hover, .sidebar-actions a:hover { background: var(--panel-hover); }
.sidebar-actions .primary {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}
.sidebar-actions .primary:hover { background: var(--accent-hover); }

/* Status bar */
.status-bar {
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--line);
}
.dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.ok { background: var(--ok); }
.dot.warn { background: var(--warn); }
.dot.err { background: var(--err); }

/* Nav tabs in sidebar */
.sidebar-nav {
  padding: 8px 16px;
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--line);
}
.nav-tab {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.nav-tab:hover { background: var(--panel-hover); }
.nav-tab.active { background: var(--accent-soft); color: var(--accent); }

/* Sidebar section */
.sidebar-section {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.section-label {
  padding: 12px 8px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.sidebar-item {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background var(--transition);
  font: inherit;
}
.sidebar-item:hover { background: var(--panel-hover); }
.sidebar-item.active { background: var(--accent-soft); }
.sidebar-item .item-name {
  font-size: 13px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sidebar-item .item-meta {
  font-size: 11px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sidebar-item .item-actions { display: flex; gap: 4px; margin-top: 2px; }
.item-del {
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: var(--text-secondary);
  padding: 2px 6px; border-radius: 4px;
}
.item-del:hover { background: #fee; color: var(--err); }

/* Sidebar info chips */
.sidebar-info {
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--panel-hover);
  font-size: 11px;
  color: var(--text-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip.channel {
  background: #e7f3ff;
  color: #0f5dbd;
  border: 1px solid rgba(0,132,255,0.16);
}
.chip.conversation {
  background: #edf7ed;
  color: #22663b;
  border: 1px solid rgba(34,102,59,0.14);
}
.chip.sender {
  background: #fff4e5;
  color: #8a4b08;
  border: 1px solid rgba(138,75,8,0.12);
}
.chip.state {
  background: #fff1f0;
  color: #b42318;
  border: 1px solid rgba(180,35,24,0.14);
}
.chip.teach {
  background: #f4f0ff;
  color: #5b33b6;
  border: 1px solid rgba(91,51,182,0.16);
}

/* ── Main area ── */
.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

/* Main header */
.main-header {
  padding: 12px 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.main-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.main-header h2 {
  font-size: 16px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.main-header .header-meta {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.main-header-actions {
  display: flex; gap: 8px; flex-shrink: 0;
}
.main-header-actions button, .main-header-actions a {
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex; align-items: center; gap: 4px;
  transition: background var(--transition);
}
.main-header-actions button:hover, .main-header-actions a:hover {
  background: var(--panel-hover);
}

/* Main content scrollable area */
.main-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* Card grid */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  background: var(--panel);
  border-radius: var(--radius-sm);
  padding: 16px;
  box-shadow: var(--shadow-sm);
}
.stat-card .stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}
.stat-card .stat-value {
  font-size: 22px;
  font-weight: 700;
  margin-top: 6px;
  line-height: 1.2;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.stat-card .stat-note {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* Detail panel (right side content) */
.detail-panel {
  background: var(--panel);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  margin-bottom: 16px;
  overflow: hidden;
}
.detail-panel-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.detail-panel-header h3 {
  font-size: 14px;
  font-weight: 600;
}
.detail-panel-header .panel-badge {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 3px 8px;
  background: var(--panel-hover);
  border-radius: 999px;
}
.detail-panel-body {
  padding: 12px 16px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.action-btn {
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-hover);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}
.action-btn:hover {
  background: var(--accent-soft);
  border-color: rgba(0,132,255,0.18);
}
.detail-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.detail-row:last-child { border-bottom: none; }
.detail-label {
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
.detail-value {
  text-align: right;
  min-width: 0;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.empty {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

/* History list */
.history-item {
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.history-item:last-child { border-bottom: none; }
.history-role {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.history-body {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Trace items */
.trace-item {
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.trace-item:last-child { border-bottom: none; }
.trace-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.trace-title {
  font-size: 13px; font-weight: 600;
}
.trace-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.trace-body {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}
.trace-subitem {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--panel-hover);
  border-radius: 8px;
}
.trace-subtitle {
  font-size: 12px;
  font-weight: 600;
}

/* Channel items */
.channel-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.channel-item:last-child { border-bottom: none; }
.channel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.channel-title { font-size: 13px; font-weight: 600; }
.channel-meta { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

/* Status notice */
.notice {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--panel);
  font-size: 13px;
  line-height: 1.5;
}
.notice.info {
  border-color: rgba(0,132,255,0.16);
  background: var(--accent-soft);
}
.notice.error {
  border-color: rgba(231,76,60,0.18);
  background: #fff1f0;
  color: var(--err);
}

/* Readiness checks */
.readiness-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.readiness-row:last-child { border-bottom: none; }
.readiness-label { flex: 1; }
.readiness-detail { font-size: 11px; color: var(--text-secondary); }
.readiness-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--panel-hover);
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.hidden { display: none !important; }

@media (max-width: 900px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .card-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .card-grid { grid-template-columns: 1fr; }
}`;
}
