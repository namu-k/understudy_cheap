export function renderWebChatHTML(css: string, js: string, brandIconDataUrl: string): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Understudy WebChat</title>
	<link rel="icon" href="${brandIconDataUrl}">
	<style>${css}
	</style>
</head>
<body>
<div class="app">
	<aside class="sidebar" id="sidebar">
		<div class="sidebar-header">
			<div class="logo"><img src="${brandIconDataUrl}" alt="Understudy"></div>
			<div>
				<div class="title">Understudy</div>
				<div class="subtitle">WebChat</div>
			</div>
		</div>
		<div class="sidebar-actions">
			<button class="primary" id="new-session-btn" type="button">+ New Chat</button>
			<button id="overview-btn" type="button">Overview</button>
		</div>
		<div class="status-bar" id="status-bar">
			<span class="status-dot warn" id="status-dot"></span>
			<span id="status-text">Connecting...</span>
			<button id="status-model" type="button" title="Click to change model" style="margin-left:auto;background:none;border:none;cursor:pointer;font:inherit;color:var(--text-secondary)">Model: --</button>
		</div>
		<div class="session-section">
			<div class="session-section-header">
				<span>Sessions</span>
				<div style="display:flex;align-items:center;gap:8px">
					<button id="session-scope-btn" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-secondary)">Mine</button>
					<button id="refresh-sessions-btn" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-secondary)">Refresh</button>
				</div>
			</div>
			<input class="session-filter" id="session-filter" type="search" placeholder="Search sessions...">
			<div class="session-list" id="session-list"></div>
		</div>
		<div class="sidebar-info" id="sidebar-info">
			<span class="info-chip" id="chip-conn">WS: --</span>
			<span class="info-chip" id="chip-auth">Auth: --</span>
			<span class="info-chip" id="chip-tools">Tools: --</span>
			<span class="info-chip" id="chip-channels">Channels: --</span>
		</div>
	</aside>

	<main class="chat" id="chat-main">
		<div class="chat-header">
			<div class="chat-header-left">
				<button class="mobile-menu-btn" id="mobile-menu-btn" style="background:none;border:none;font-size:20px;cursor:pointer" type="button">&#9776;</button>
				<div>
					<h2 id="chat-title">Overview Chat</h2>
					<div class="header-meta" id="chat-meta">Send a message to start a new gateway session or pick an existing session</div>
				</div>
			</div>
			<div class="chat-header-actions">
				<a id="dashboard-link" href="/ui">Open Dashboard</a>
				<button id="clear-btn" type="button">Clear</button>
			</div>
		</div>

		<div id="messages" class="messages">
			<div class="welcome" id="welcome-view">
				<div class="welcome-icon"><img src="${brandIconDataUrl}" alt="Understudy"></div>
				<h3>Understudy WebChat</h3>
				<p>Send a message to start a conversation. Type <strong>/</strong> for available commands. Pick a gateway session on the left or click the model badge above to switch models.</p>
			</div>
		</div>
		<div class="composer">
			<div class="media-strip" id="media-strip"></div>
			<div class="composer-input-wrap" id="composer-wrap">
				<div class="slash-menu" id="slash-menu"></div>
				<textarea id="msg-input" rows="1" placeholder="Message Understudy... (/ for commands)"></textarea>
				<input id="media-file-input" class="hidden-input" type="file" multiple>
				<div class="composer-btn-group">
					<button class="composer-btn" id="attach-btn" type="button" title="Attach file">+</button>
					<button class="composer-btn send-btn" id="send-btn" type="button" title="Send" disabled>&#10148;</button>
				</div>
			</div>
			<div class="composer-hint" id="composer-hint">Enter to send, Shift+Enter for new line, / for commands, click Model to switch</div>
		</div>
	</main>
</div>

<!-- Model picker modal -->
<div class="modal-overlay" id="model-modal">
	<div class="modal">
		<div class="modal-header">
			<h3>Change Model</h3>
			<button class="modal-close" id="model-modal-close" type="button">&times;</button>
		</div>
		<div class="modal-body">
			<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">
				Select a model or type provider/model-id.
			</p>
			<select id="model-select"><option value="">Loading...</option></select>
		</div>
		<div class="modal-footer">
			<button id="model-cancel-btn" type="button">Cancel</button>
			<button class="primary" id="model-apply-btn" type="button">Apply</button>
		</div>
	</div>
</div>

<script>
${js}
</script>
</body>
</html>`;
}
