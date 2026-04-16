export const webChatCSS = `
		:root {
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
			--user-bubble: #0084ff;
			--assistant-bubble: #f0f0f0;
			--system-bg: #fff3cd;
			--error-bg: #fee;
			--error-text: #c0392b;
			--radius: 18px;
			--radius-sm: 12px;
			--shadow-sm: 0 1px 2px rgba(0,0,0,0.1);
			--shadow-md: 0 4px 12px rgba(0,0,0,0.08);
			--shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
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

		/* ── Layout ── */
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
			overflow: hidden;
			flex-shrink: 0;
		}
		.sidebar-header .logo img {
			width: 100%; height: 100%; object-fit: cover;
		}
		.sidebar-header .title {
			font-size: 16px; font-weight: 600;
		}
		.sidebar-header .subtitle {
			font-size: 11px; color: var(--text-secondary);
		}
		.sidebar-actions {
			padding: 12px 16px;
			display: flex; gap: 8px;
		}
		.sidebar-actions button {
			flex: 1;
			padding: 8px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			background: var(--panel);
			color: var(--text);
			font-size: 13px;
			cursor: pointer;
			transition: background var(--transition);
		}
		.sidebar-actions button:hover { background: var(--panel-hover); }
		.sidebar-actions button.primary {
			background: var(--accent);
			color: #fff;
			border-color: transparent;
		}
		.sidebar-actions button.primary:hover { background: var(--accent-hover); }

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
		.status-dot {
			width: 8px; height: 8px;
			border-radius: 50%;
			flex-shrink: 0;
		}
		.status-dot.ok { background: #31a24c; }
		.status-dot.warn { background: #f0932b; }
		.status-dot.err { background: #e74c3c; }

		/* Session list */
		.session-section {
			flex: 1;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}
		.session-section-header {
			padding: 12px 16px 8px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-secondary);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			display: flex; align-items: center; justify-content: space-between;
		}
		.session-filter {
			margin: 0 16px 8px;
			padding: 8px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			font-size: 13px;
			outline: none;
			background: var(--panel-hover);
			width: calc(100% - 32px);
		}
		.session-filter:focus {
			border-color: var(--accent);
			box-shadow: 0 0 0 3px rgba(0,132,255,0.1);
		}
		.session-list {
			flex: 1;
			overflow-y: auto;
			padding: 0 8px 8px;
		}
		.session-item {
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
		.session-item:hover { background: var(--panel-hover); }
		.session-item.active { background: var(--accent-soft); }
		.session-item .session-name {
			font-size: 13px; font-weight: 500;
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.session-item .session-meta {
			font-size: 11px; color: var(--text-secondary);
			line-height: 1.4;
		}
		.session-item .session-chip-row {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-top: 2px;
		}
		.session-chip {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 3px 8px;
			border-radius: 999px;
			border: 1px solid var(--line);
			background: var(--panel);
			font-size: 10px;
			font-weight: 500;
			color: var(--text-secondary);
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.session-chip.channel {
			background: #e7f3ff;
			color: #0f5dbd;
			border-color: rgba(0, 132, 255, 0.16);
		}
		.session-chip.conversation {
			background: #edf7ed;
			color: #22663b;
			border-color: rgba(34, 102, 59, 0.14);
		}
		.session-chip.sender {
			background: #fff4e5;
			color: #8a4b08;
			border-color: rgba(138, 75, 8, 0.12);
		}
		.session-chip.state {
			background: #fff1f0;
			color: #b42318;
			border-color: rgba(180, 35, 24, 0.14);
		}
		.session-chip.teach {
			background: #f4f0ff;
			color: #5b33b6;
			border-color: rgba(91, 51, 182, 0.16);
		}
		.session-item .session-actions {
			display: flex; gap: 4px; margin-top: 2px;
		}
		.session-item .session-del {
			background: none; border: none; cursor: pointer;
			font-size: 11px; color: var(--text-secondary);
			padding: 2px 6px; border-radius: 4px;
		}
		.session-item .session-del:hover {
			background: var(--error-bg); color: var(--error-text);
		}

		/* Sidebar info (collapsed) */
		.sidebar-info {
			padding: 12px 16px;
			border-top: 1px solid var(--line);
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}
		.info-chip {
			display: inline-flex; align-items: center; gap: 4px;
			padding: 4px 8px;
			border-radius: 999px;
			background: var(--panel-hover);
			font-size: 11px;
			color: var(--text-secondary);
		}

		/* ── Chat area ── */
		.chat {
			display: flex;
			flex-direction: column;
			overflow: hidden;
			background: var(--bg);
		}

		/* Chat header */
		.chat-header {
			padding: 12px 20px;
			background: var(--panel);
			border-bottom: 1px solid var(--line);
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}
		.chat-header-left {
			display: flex;
			align-items: center;
			gap: 12px;
			min-width: 0;
		}
		.chat-header h2 {
			font-size: 16px; font-weight: 600;
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.chat-header .header-meta {
			font-size: 12px;
			color: var(--text-secondary);
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
		}
		.chat-header .header-note {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.chat-header-actions {
			display: flex; gap: 8px; flex-shrink: 0;
		}
		.chat-header-actions button, .chat-header-actions a {
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
		.chat-header-actions button:hover, .chat-header-actions a:hover {
			background: var(--panel-hover);
		}

		/* Messages */
		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
		.msg {
			max-width: 70%;
			padding: 10px 14px;
			border-radius: var(--radius);
			line-height: 1.45;
			word-break: break-word;
			font-size: 14px;
			position: relative;
		}
		.msg.user {
			align-self: flex-end;
			background: var(--user-bubble);
			color: #fff;
			border-bottom-right-radius: 4px;
		}
		.msg.user a { color: #fff; }
		.msg.assistant {
			align-self: flex-start;
			background: var(--assistant-bubble);
			color: var(--text);
			border-bottom-left-radius: 4px;
		}
		.msg.system {
			align-self: center;
			background: var(--system-bg);
			color: #856404;
			font-size: 13px;
			max-width: 80%;
			border-radius: var(--radius-sm);
		}
		.msg.error {
			align-self: center;
			background: var(--error-bg);
			color: var(--error-text);
			font-size: 13px;
			max-width: 80%;
			border-radius: var(--radius-sm);
		}
		.msg-time {
			font-size: 10px;
			opacity: 0.6;
			margin-top: 4px;
		}
		.msg.user .msg-time { text-align: right; }
		.msg-body p { margin: 0 0 8px; }
		.msg-body p:last-child { margin-bottom: 0; }
		.msg-body:empty { display: none; }
		.msg-body pre {
			margin: 8px 0;
			padding: 10px 12px;
			border-radius: var(--radius-sm);
			background: #1e1e1e;
			color: #d4d4d4;
			overflow-x: auto;
			font-family: "SF Mono", "Fira Code", "Consolas", monospace;
			font-size: 12px;
			line-height: 1.5;
		}
		.msg-body code {
			font-family: "SF Mono", "Fira Code", "Consolas", monospace;
			font-size: 0.9em;
		}
		.msg-body ul, .msg-body ol {
			margin: 4px 0; padding-left: 20px;
		}
		.msg-media {
			display: flex;
			flex-direction: column;
			gap: 8px;
			margin-top: 8px;
		}
		.msg-media:empty {
			display: none;
		}
		.msg-images {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.msg-images:empty {
			display: none;
		}
		.msg-images img {
			display: block;
			max-width: min(280px, 100%);
			max-height: 240px;
			border-radius: 14px;
			border: 1px solid rgba(0, 0, 0, 0.1);
			background: rgba(255, 255, 255, 0.92);
			object-fit: contain;
			box-shadow: var(--shadow-sm);
		}
		.msg.user .msg-images img {
			border-color: rgba(255, 255, 255, 0.22);
		}
		.msg-attachments {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}
		.msg-attachments:empty {
			display: none;
		}
		.msg-attachment {
			display: inline-flex;
			align-items: center;
			max-width: 100%;
			padding: 5px 10px;
			border-radius: 999px;
			font-size: 11px;
			line-height: 1.3;
			background: rgba(0, 0, 0, 0.06);
			color: inherit;
		}
		.msg.user .msg-attachment {
			background: rgba(255, 255, 255, 0.18);
		}
		.run-card {
			align-self: flex-start;
			width: min(760px, 88%);
			padding: 14px 16px;
			border-radius: 22px;
			background:
				linear-gradient(135deg, rgba(13, 58, 112, 0.08), rgba(30, 144, 255, 0.04)),
				var(--panel);
			border: 1px solid rgba(0, 132, 255, 0.14);
			box-shadow: var(--shadow-md);
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.run-card.archived {
			background:
				linear-gradient(135deg, rgba(0, 0, 0, 0.03), rgba(0, 0, 0, 0.015)),
				var(--panel);
			border-color: rgba(0, 0, 0, 0.08);
			box-shadow: var(--shadow-sm);
		}
		.run-card-head {
			display: flex;
			align-items: center;
			gap: 10px;
			flex-wrap: wrap;
		}
		.run-badge {
			display: inline-flex;
			align-items: center;
			padding: 4px 10px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.04em;
			text-transform: uppercase;
			background: rgba(0, 132, 255, 0.12);
			color: #0d5aa7;
		}
		.run-badge.done {
			background: rgba(49, 162, 76, 0.12);
			color: #24723a;
		}
		.run-badge.error {
			background: rgba(231, 76, 60, 0.12);
			color: #c0392b;
		}
		.run-title {
			font-size: 13px;
			font-weight: 600;
			color: var(--text);
		}
		.run-meta {
			font-size: 11px;
			color: var(--text-secondary);
			margin-left: auto;
		}
		.run-summary {
			font-size: 14px;
			line-height: 1.5;
			color: var(--text);
		}
		.run-thinking {
			border: 1px solid var(--line);
			border-radius: 14px;
			background: rgba(255, 255, 255, 0.6);
			padding: 10px 12px;
		}
		.run-thinking[hidden] {
			display: none;
		}
		.run-thinking summary {
			cursor: pointer;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-secondary);
			list-style: none;
		}
		.run-thinking summary::-webkit-details-marker {
			display: none;
		}
		.run-thinking-body {
			margin-top: 8px;
			font-size: 13px;
			line-height: 1.5;
			color: var(--text-secondary);
			white-space: pre-wrap;
		}
		.run-tools {
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		.run-tool {
			border: 1px solid var(--line);
			border-radius: 14px;
			padding: 10px 12px;
			background: rgba(255, 255, 255, 0.78);
		}
		.run-tool.running {
			border-color: rgba(0, 132, 255, 0.18);
			background: rgba(231, 243, 255, 0.58);
		}
		.run-tool.error {
			border-color: rgba(231, 76, 60, 0.2);
			background: rgba(254, 238, 238, 0.9);
		}
		.run-tool-head {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}
		.run-tool-route, .run-tool-state {
			display: inline-flex;
			align-items: center;
			padding: 2px 8px;
			border-radius: 999px;
			font-size: 10px;
			font-weight: 700;
			letter-spacing: 0.05em;
			text-transform: uppercase;
		}
		.run-tool-route {
			background: rgba(0, 0, 0, 0.06);
			color: var(--text-secondary);
		}
		.run-tool-state {
			background: rgba(0, 132, 255, 0.12);
			color: #0d5aa7;
		}
		.run-tool-state.done {
			background: rgba(49, 162, 76, 0.12);
			color: #24723a;
		}
		.run-tool-state.error {
			background: rgba(231, 76, 60, 0.12);
			color: #c0392b;
		}
		.run-tool-label {
			font-size: 13px;
			font-weight: 600;
			color: var(--text);
		}
		.run-tool-detail {
			margin-top: 6px;
			font-size: 12px;
			line-height: 1.45;
			color: var(--text-secondary);
			white-space: pre-wrap;
		}
		.run-tool-detail:empty {
			display: none;
		}
		.run-tool-media {
			margin-top: 8px;
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.run-tool-media:empty {
			display: none;
		}
		.run-tool-media img {
			display: block;
			max-width: min(320px, 100%);
			max-height: 220px;
			border-radius: 12px;
			border: 1px solid rgba(0, 0, 0, 0.08);
			box-shadow: var(--shadow-sm);
			background: rgba(255, 255, 255, 0.95);
			object-fit: contain;
		}

		/* Welcome state */
		.welcome {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 16px;
			padding: 40px;
			text-align: center;
		}
		.welcome-icon {
			width: 64px; height: 64px;
			border-radius: 16px;
			overflow: hidden;
		}
		.welcome-icon img {
			width: 100%; height: 100%; object-fit: cover;
		}
		.welcome h3 { font-size: 20px; font-weight: 600; }
		.welcome p { font-size: 14px; color: var(--text-secondary); max-width: 400px; line-height: 1.5; }

		/* ── Composer ── */
		.composer {
			padding: 12px 20px 16px;
			background: var(--panel);
			border-top: 1px solid var(--line);
		}

		/* Slash command autocomplete */
		.slash-menu {
			display: none;
			position: absolute;
			bottom: 100%;
			left: 0; right: 0;
			background: var(--panel);
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			box-shadow: var(--shadow-lg);
			max-height: 240px;
			overflow-y: auto;
			margin-bottom: 4px;
			z-index: 10;
		}
		.slash-menu.visible { display: block; }
		.slash-item {
			padding: 8px 14px;
			cursor: pointer;
			display: flex;
			flex-direction: column;
			gap: 1px;
			transition: background var(--transition);
		}
		.slash-item:hover, .slash-item.active {
			background: var(--accent-soft);
		}
		.slash-item .slash-cmd {
			font-size: 13px; font-weight: 500;
			font-family: "SF Mono", "Fira Code", monospace;
		}
		.slash-item .slash-desc {
			font-size: 11px; color: var(--text-secondary);
		}

		/* Media */
		.media-strip {
			display: flex; flex-wrap: wrap; gap: 6px;
			margin-bottom: 8px;
		}
		.media-strip:empty { display: none; }
		.media-tag {
			display: inline-flex; align-items: center; gap: 4px;
			padding: 4px 10px;
			border-radius: 999px;
			background: var(--panel-hover);
			border: 1px solid var(--line);
			font-size: 11px;
		}
		.media-tag button {
			background: none; border: none; cursor: pointer;
			color: var(--text-secondary); font-size: 14px; padding: 0 2px;
			line-height: 1;
		}
		.media-tag button:hover { color: var(--error-text); }

		/* Input row */
		.composer-input-wrap {
			position: relative;
			display: flex;
			align-items: flex-end;
			gap: 8px;
			background: var(--panel-hover);
			border: 1px solid var(--line);
			border-radius: var(--radius);
			padding: 4px 4px 4px 14px;
			transition: border-color var(--transition), box-shadow var(--transition);
		}
		.composer-input-wrap:focus-within {
			border-color: var(--accent);
			box-shadow: 0 0 0 3px rgba(0,132,255,0.1);
		}
		.composer-input-wrap textarea {
			flex: 1;
			border: none;
			background: transparent;
			resize: none;
			font: inherit;
			font-size: 14px;
			line-height: 1.4;
			padding: 8px 0;
			min-height: 24px;
			max-height: 160px;
			outline: none;
			color: var(--text);
		}
		.composer-input-wrap textarea::placeholder {
			color: var(--text-secondary);
		}
		.composer-btn-group {
			display: flex;
			gap: 2px;
			align-items: center;
			padding-bottom: 4px;
		}
		.composer-btn {
			width: 34px; height: 34px;
			border: none; border-radius: 50%;
			cursor: pointer;
			display: flex; align-items: center; justify-content: center;
			transition: background var(--transition);
			background: transparent;
			color: var(--text-secondary);
			font-size: 18px;
		}
		.composer-btn:hover { background: rgba(0,0,0,0.05); }
		.composer-btn.send-btn {
			background: var(--accent);
			color: #fff;
		}
		.composer-btn.send-btn:hover { background: var(--accent-hover); }
		.composer-btn.send-btn:disabled {
			background: #ccc;
			cursor: default;
		}

		.composer-hint {
			font-size: 11px;
			color: var(--text-secondary);
			margin-top: 6px;
			text-align: center;
		}
		.hidden-input {
			position: absolute; opacity: 0; pointer-events: none;
			width: 1px; height: 1px;
		}

		/* Model selector modal */
		.modal-overlay {
			display: none;
			position: fixed; inset: 0;
			background: rgba(0,0,0,0.4);
			z-index: 100;
			align-items: center; justify-content: center;
		}
		.modal-overlay.visible { display: flex; }
		.modal {
			background: var(--panel);
			border-radius: var(--radius);
			box-shadow: var(--shadow-lg);
			width: 400px;
			max-width: 90vw;
			max-height: 80vh;
			overflow: auto;
		}
		.modal-header {
			padding: 16px 20px;
			border-bottom: 1px solid var(--line);
			display: flex; align-items: center; justify-content: space-between;
		}
		.modal-header h3 { font-size: 16px; font-weight: 600; }
		.modal-close {
			background: none; border: none;
			font-size: 20px; cursor: pointer;
			color: var(--text-secondary); padding: 4px;
		}
		.modal-body { padding: 16px 20px; }
		.modal-body select {
			width: 100%;
			padding: 10px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			font-size: 14px;
			background: var(--panel);
			margin-bottom: 12px;
		}
		.modal-footer {
			padding: 12px 20px;
			border-top: 1px solid var(--line);
			display: flex; justify-content: flex-end; gap: 8px;
		}
		.modal-footer button {
			padding: 8px 16px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			font-size: 13px;
			cursor: pointer;
			background: var(--panel);
			transition: background var(--transition);
		}
		.modal-footer button:hover { background: var(--panel-hover); }
		.modal-footer button.primary {
			background: var(--accent); color: #fff; border-color: transparent;
		}
		.modal-footer button.primary:hover { background: var(--accent-hover); }

		/* ── Responsive ── */
		@media (max-width: 768px) {
			.app { grid-template-columns: 1fr; }
			.sidebar { display: none; }
			.sidebar.mobile-open {
				display: flex;
				position: fixed; inset: 0;
				z-index: 50;
				width: 100%;
			}
			.mobile-menu-btn { display: flex !important; }
			.msg { max-width: 85%; }
		}
		.mobile-menu-btn { display: none; }`;
