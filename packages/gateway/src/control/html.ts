export interface ControlRenderOptions {
	name: string;
	brandIconDataUrl: string;
	avatarUrl: string;
}

export function renderControlHTML(
	css: string,
	js: string,
	options: ControlRenderOptions,
): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.name} Dashboard</title>
<link rel="icon" href="${options.brandIconDataUrl}">
<style>
${css}
</style>
</head>
<body>
<div class="app">
<!-- ── Sidebar ── -->
<aside class="sidebar">
  <div class="sidebar-header">
    <div class="logo"><img src="${options.avatarUrl}" alt="${options.name}"></div>
    <div>
      <div class="title">${options.name}</div>
      <div class="subtitle">Dashboard</div>
    </div>
  </div>
  <div class="sidebar-actions">
    <a id="webchat-link" href="/webchat" class="primary">WebChat</a>
    <button id="refresh-btn" type="button">Refresh</button>
  </div>
  <div id="status-bar" class="status-bar">
    <span class="dot warn"></span>
    <span>Connecting...</span>
  </div>
  <div class="sidebar-nav">
    <button class="nav-tab active" data-tab="sessions" type="button">Sessions</button>
    <button class="nav-tab" data-tab="runs" type="button">Runs</button>
    <button class="nav-tab" data-tab="channels" type="button">Channels</button>
  </div>
  <div class="sidebar-section" id="sidebar-content">
    <div class="empty">Loading...</div>
  </div>
  <div class="sidebar-info" id="sidebar-info">
    <span class="chip">Loading...</span>
  </div>
</aside>

<!-- ── Main ── -->
<div class="main">
  <div class="main-header">
    <div class="main-header-left">
      <h2 id="main-title">Overview</h2>
      <span class="header-meta" id="main-subtitle"></span>
    </div>
    <div class="main-header-actions">
      <a id="main-webchat-link" href="/webchat">Open WebChat</a>
      <a href="/health" target="_blank" rel="noreferrer">Health JSON</a>
      <a href="/channels" target="_blank" rel="noreferrer">Channels JSON</a>
    </div>
  </div>
  <div class="main-body" id="main-body">
    <div id="status-notice" class="notice hidden"></div>
    <!-- Overview cards -->
    <div class="card-grid" id="summary-cards"></div>

    <!-- Detail panels rendered dynamically -->
    <div id="detail-area"></div>
  </div>
</div>
</div>

<script>
${js}
</script>
</body>
</html>`;
}
