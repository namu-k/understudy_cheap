export const sessionJS = `async function refreshSessions() {
	if (!clientId) return;
	try {
		const params = showAllSessions
			? { includePersisted: true }
			: { channelId: LIVE_CHANNEL, senderId: clientId, includePersisted: true };
		const result = await rpc("session.list", params);
		sessionsCache = Array.isArray(result)
			? result.sort(function(a, b) { return (b.lastActiveAt || 0) - (a.lastActiveAt || 0); })
			: [];
	} catch(e) {
		sessionsCache = [];
	}
	refreshSessionScopeButton();
	renderSessionList();
}

async function toggleSessionScope() {
	showAllSessions = !showAllSessions;
	persistSessionScope();
	refreshSessionScopeButton();
	await refreshSessions();
	if (activeSessionId) {
		if (findSessionSummary(activeSessionId)) {
			await selectSession(activeSessionId);
		} else {
			await enterLiveMode();
			addMsg("system", "The previously selected session is outside the current scope.");
		}
		return;
	}
	syncComposer();
}

function renderSessionList() {
	const q = (sessionFilter.value || "").trim().toLowerCase();
	let items = sessionsCache;
	if (q) {
		items = items.filter(function(s) {
			return sessionSearchText(s).includes(q);
		});
	}
	if (!items.length) {
		sessionList.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-secondary)">' +
			(sessionsCache.length ? "No matching sessions" : "No sessions yet") + '</div>';
		return;
	}
	sessionList.innerHTML = items.map(function(s) {
		const active = s.id === activeSessionId ? " active" : "";
		const title = sessionTitle(s) || s.id;
		const writable = isSessionWritable(s);
		const badgeRow = renderSessionBadgeRow(s, {
			forceChannel: showAllSessions || !writable,
			includeSender: showAllSessions || !writable,
			includeReadOnly: !writable,
		});
		const metaBits = [];
		if (sessionDisplayName(s)) metaBits.push(s.id);
		if (s.model) metaBits.push(s.model);
		metaBits.push((s.messageCount || 0) + " msgs");
		metaBits.push(fmtRelative(s.lastActiveAt));
		return '<div class="session-item' + active + '" data-sid="' + esc(s.id) + '">' +
			'<span class="session-name">' + esc(title) + '</span>' +
			badgeRow +
			'<span class="session-meta">' + esc(metaBits.join(" • ")) + '</span>' +
			(writable
				? '<span class="session-actions">' +
					'<button class="session-del" data-del-sid="' + esc(s.id) + '" type="button" title="Delete session">Delete</button>' +
				'</span>'
				: '') +
			'</div>';
	}).join("");
}

/* ── Session actions ── */
async function enterLiveMode() {
	sessionViewRequestVersion += 1;
	activeSessionId = "";
	liveRunStatusText = "";
	setChatHeader("Overview Chat", "Send a fresh message or pick a gateway session on the left");
	clearChat();
	renderSessionList();
	syncComposer();
}

async function selectSession(sid) {
	const requestVersion = ++sessionViewRequestVersion;
	activeSessionId = sid;
	liveRunStatusText = "";
	const summary = findSessionSummary(sid);
	const title = sessionTitle(summary || sid);
	setChatHeader(
		"Session " + title,
		sessionSubtitle(summary, sid),
		summary,
	);
	clearChat();
	renderSessionList();
	syncComposer();
	try {
		const [historyResult, traceResult] = await Promise.all([
			rpc("session.history", { sessionId: sid, limit: 100 }),
			rpc("session.trace", { sessionId: sid, limit: 8 }),
		]);
		if (requestVersion !== sessionViewRequestVersion || activeSessionId !== sid) {
			return;
		}
		const msgs = Array.isArray(historyResult?.messages) ? historyResult.messages : [];
		const timeline = Array.isArray(historyResult?.timeline) ? historyResult.timeline : [];
		const runs = Array.isArray(traceResult?.runs) ? traceResult.runs : [];
		const activeRun =
			traceResult?.activeRun &&
			typeof traceResult.activeRun === "object" &&
			String(traceResult.activeRun.status || "").toLowerCase() === "in_flight"
				? traceResult.activeRun
				: null;
		if (timeline.length > 0) {
			renderHistoryTimeline(timeline, sid);
		} else if (activeRun) {
			if (runs.length > 0) {
				renderStoredRun(runs[0], sid);
			}
		} else if (runs.length > 0) {
			renderStoredRun(runs[0], sid);
		}
		if (activeRun) {
			renderActiveRunSnapshot(activeRun, sid);
		}
		if (!msgs.length && !timeline.length) {
			if (!runs.length && !activeRun) {
				addMsg("system", "This session has no messages yet.");
			}
			return;
		}
		if (!timeline.length) {
			msgs.forEach(function(m) {
				addMsg(m.role === "user" ? "user" : "assistant", m.text || "", m.timestamp, m);
			});
		}
	} catch(e) {
		if (requestVersion !== sessionViewRequestVersion || activeSessionId !== sid) {
			return;
		}
		addMsg("error", "Failed to load history: " + (e.message || e));
	}
}

async function deleteSession(sid) {
	const summary = findSessionSummary(sid);
	if (summary && !isSessionWritable(summary)) {
		addMsg("error", "This session is read-only in WebChat and cannot be deleted here.");
		return;
	}
	try {
		const result = await rpc("session.delete", { sessionId: sid });
		if (result?.deleted !== true) {
			addMsg("error", "Session " + sid + " could not be deleted.");
			return;
		}
		addMsg("system", "Session " + sid + " deleted.");
		if (activeSessionId === sid) {
			await enterLiveMode();
		}
		await refreshSessions();
	} catch(e) {
		addMsg("error", "Delete failed: " + (e.message || e));
	}
}

async function createNewSession() {
	if (!clientId) { addMsg("error", "Client not ready"); return; }
	try {
		const created = await rpc("session.create", {
			channelId: LIVE_CHANNEL,
			senderId: clientId,
			forceNew: true,
			executionScopeKey: "webchat:" + clientId + ":" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
		});
		if (created?.id) {
			await refreshSessions();
			await selectSession(created.id);
		}
	} catch(e) {
		addMsg("error", "Failed to create session: " + (e.message || e));
	}
}

async function reloadWebChatData() {
	await Promise.all([refreshHealth(), loadDiscovery(), refreshSessions()]);
	discoverSlashCommands();
	if (activeSessionId) {
		await selectSession(activeSessionId);
	} else {
		syncComposer();
	}
}

async function exportActiveSession() {
	if (!activeSessionId) {
		throw new Error("No session selected.");
	}
	const sessionId = activeSessionId;
	const results = await Promise.all([
		rpc("session.get", { sessionId: sessionId }),
		rpc("session.history", { sessionId: sessionId, limit: 200 }),
		rpc("session.trace", { sessionId: sessionId, limit: 8 }),
	]);
	const session = results[0] || { id: sessionId };
	const historyResult = results[1] || {};
	const traceResult = results[2] || {};
	const messages = Array.isArray(historyResult.messages) ? historyResult.messages : [];
	const runs = Array.isArray(traceResult.runs) ? traceResult.runs : [];
	const lines = [
		"# " + (sessionTitle(session) || sessionId),
		"",
		"Session ID: " + sessionId,
		"Exported: " + fmtDateTime(Date.now()),
		"Messages: " + messages.length,
		"",
	];
	if (runs.length > 0) {
		const steps = summarizeStoredToolTrace(runs[0].toolTrace);
		lines.push("Latest recorded run: " + buildStoredRunSummary(runs[0], steps));
		if (steps.length > 0) {
			lines.push("");
			lines.push("Tool steps:");
			steps.forEach(function(step, index) {
				lines.push(String(index + 1) + ". " + (step.summary || step.toolName || "Tool") + " [" + toolStateLabel(step.status) + "]");
			});
		}
		lines.push("");
	}
	messages.forEach(function(message, index) {
		lines.push((message.role === "user" ? "User" : "Assistant") + " " + String(index + 1));
		lines.push(String(message.text || ""));
		lines.push("");
	});
	const filename = sanitizeFilename(sessionTitle(session) || sessionId) + ".md";
	downloadTextFile(filename, lines.join("\\n"));
	return filename;
}`;
