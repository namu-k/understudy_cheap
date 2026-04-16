/**
 * Control Dashboard JS — rendering, event listeners, and initialization.
 * Composed into a single <script> block by js/index.ts.
 */

export function getControlChartsJS(): string {
	return `/* ── Tab switching ── */
document.querySelector('.sidebar-nav').addEventListener('click', function(e) {
  var tab = e.target.getAttribute('data-tab');
  if (!tab) return;
  state.activeTab = tab;
  document.querySelectorAll('.nav-tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === tab);
  });
  renderSidebar();
});

/* ── Render: Status bar ── */
function renderStatusBar() {
  if (!state.health) {
    statusBarEl.innerHTML = '<span class="dot warn"></span><span>Connecting...</span>';
    return;
  }
  var s = state.health.status || 'unknown';
  var t = tone(s);
  var uptime = state.health.uptime ? fmtUptime(state.health.uptime) : '';
  statusBarEl.innerHTML = '<span class="dot '+t+'"></span><span>'+esc(s)+
    (uptime ? ' &middot; '+esc(uptime) : '')+
    (state.lastRefreshAt ? ' &middot; '+esc(fmtRel(state.lastRefreshAt)) : '')+
    '</span>';
}

/* ── Render: Summary cards ── */
function renderSummaryCards() {
  var defaultModel = state.config
    ? [state.config.defaultProvider, state.config.defaultModel].filter(Boolean).join('/')
    : 'unset';
  var toolCount = Array.isArray(state.tools) ? state.tools.length : 0;
  var skillsLoaded = state.skills && typeof state.skills.loaded === 'number' ? state.skills.loaded : 0;
  var skillsAvailable = state.skills && typeof state.skills.available === 'number' ? state.skills.available : 0;
  var authMode = state.health && state.health.auth ? state.health.auth.mode || 'none' : 'none';
  var heap = state.health && state.health.memory ? fmtBytes(state.health.memory.heapUsed) : '--';
  var heapTotal = state.health && state.health.memory ? fmtBytes(state.health.memory.heapTotal) : '';
  var sessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
  var channelCount = Array.isArray(state.channels) ? state.channels.length : 0;
  var playbookRunCount = state.playbookRuns && Array.isArray(state.playbookRuns.runs) ? state.playbookRuns.runs.length : 0;
  var methodCount = 0;
  if (state.capabilities) {
    var inv = state.capabilities.inventory;
    if (inv && Array.isArray(inv.methods)) methodCount = inv.methods.length;
  }

  var cards = [
    { label: 'Sessions', value: String(sessionCount), note: sessionCount > 0 ? 'Latest: '+fmtRel((state.sessions[0]||{}).lastActiveAt) : 'No sessions' },
    { label: 'Model', value: defaultModel || 'unset', note: (Array.isArray(state.models) ? state.models.length : 0)+' models available' },
    { label: 'Tools', value: String(toolCount), note: skillsLoaded+'/'+skillsAvailable+' skills &middot; '+methodCount+' RPC methods' },
    { label: 'Channels', value: String(channelCount), note: 'Auth: '+authMode },
    { label: 'Runs', value: String(playbookRunCount), note: playbookRunCount > 0 ? 'Tracked playbook runs' : 'No playbook runs' },
    { label: 'Memory', value: heap, note: heapTotal ? 'of '+heapTotal : '' },
    { label: 'Scheduling', value: state.schedule ? (state.schedule.enabled || state.schedule.running ? 'Active' : 'Off') : '--', note: state.schedule && state.schedule.runCount != null ? state.schedule.runCount+' runs' : 'Schedule jobs' },
  ];
  summaryCardsEl.innerHTML = cards.map(function(c) {
    return '<div class="stat-card"><div class="stat-label">'+esc(c.label)+'</div><div class="stat-value">'+esc(c.value)+'</div><div class="stat-note">'+c.note+'</div></div>';
  }).join('');
}

/* ── Render: Sidebar content ── */
function renderSidebar() {
  if (state.activeTab === 'sessions') {
    renderSessionList();
  } else if (state.activeTab === 'runs') {
    renderPlaybookRunList();
  } else {
    renderChannelList();
  }
  renderSidebarInfo();
}

function renderSessionList() {
  var items = Array.isArray(state.sessions) ? state.sessions : [];
  if (!items.length) {
    sidebarContentEl.innerHTML = '<div class="empty">No sessions</div>';
    return;
  }
  sidebarContentEl.innerHTML = '<div class="section-label">Recent Sessions</div>' +
    items.map(function(s) {
      var active = s.id === state.selectedSessionId ? ' active' : '';
      var label = sessionListLabel(s);
      var model = s.model || 'default';
      var msgs = s.messageCount || 0;
      var chips = sessionChipRowHtml(s);
      return '<button class="sidebar-item'+active+'" data-sid="'+esc(s.id)+'" type="button">'+
        '<div class="item-name">'+esc(label)+'</div>'+
        chips +
        '<div class="item-meta">'+esc([String(label) !== String(s.id || '') ? s.id : null, model, msgs+' msgs', fmtRel(s.lastActiveAt)].filter(Boolean).join(' · '))+'</div>'+
        '<div class="item-actions">'+
          '<span class="item-del" data-del-sid="'+esc(s.id)+'" title="Delete session">Delete</span>'+
        '</div>'+
      '</button>';
    }).join('');
}

function renderChannelList() {
  var items = Array.isArray(state.channels) ? state.channels : [];
  if (!items.length) {
    sidebarContentEl.innerHTML = '<div class="empty">No channels</div>';
    return;
  }
  sidebarContentEl.innerHTML = '<div class="section-label">Channels</div>' +
    items.map(function(ch) {
      var rt = ch.runtime || {};
      var rtState = rt.state || 'unknown';
      var t = tone(rtState);
      return '<div class="sidebar-item" style="cursor:default">'+
        '<div class="item-name"><span class="dot '+t+'" style="display:inline-block;margin-right:6px"></span>'+esc(ch.name || ch.id || 'channel')+'</div>'+
        '<div class="item-meta mono">'+esc(ch.id || '')+'</div>'+
        '<div class="item-meta">'+esc(rtState)+'</div>'+
        '<div class="item-meta">'+esc(channelCapabilitySummary(ch.capabilities))+'</div>'+
        '<div class="item-meta">'+esc(channelActionHint(ch))+'</div>'+
      '</div>';
    }).join('');
}

function renderPlaybookRunList() {
  var payload = state.playbookRuns || {};
  var items = Array.isArray(payload.runs) ? payload.runs : [];
  if (!items.length) {
    sidebarContentEl.innerHTML = '<div class="section-label">Playbook Runs</div><div class="empty">No playbook runs yet</div>';
    return;
  }
  sidebarContentEl.innerHTML = '<div class="section-label">Playbook Runs</div>' +
    items.map(function(run) {
      var active = run.id === state.selectedRunId ? ' active' : '';
      var toneClass = playbookRunStatusTone(run);
      var badges = [];
      if (run.approval && run.approval.state) badges.push('approval '+run.approval.state);
      if (run.childSession && run.childSession.status) badges.push(run.childSession.status);
      return '<button class="sidebar-item'+active+'" data-rid="'+esc(run.id)+'" type="button">'+
        '<div class="item-name"><span class="dot '+toneClass+'" style="display:inline-block;margin-right:6px"></span>'+esc(playbookRunLabel(run))+'</div>'+
        '<div class="item-meta">'+esc([run.id, fmtRel(run.updatedAt)].filter(Boolean).join(' · '))+'</div>'+
        '<div class="item-meta">'+esc(playbookRunStageLabel(run))+'</div>'+
        '<div class="item-meta">'+esc(playbookRunChildLabel(run))+'</div>'+
        (badges.length ? '<div class="chip-row">' + badges.map(function(label) { return '<span class="chip">'+esc(label)+'</span>'; }).join('') + '</div>' : '')+
      '</button>';
    }).join('');
}

function renderSidebarInfo() {
  var parts = [];
  var namespaces = [];
  if (state.capabilities && state.capabilities.inventory && Array.isArray(state.capabilities.inventory.namespaces)) {
    namespaces = state.capabilities.inventory.namespaces;
  }
  namespaces.slice(0, 6).forEach(function(ns) {
    var label = ns.id || ns.name || 'core';
    var count = ns.count || ns.methodCount || (Array.isArray(ns.methods) ? ns.methods.length : 0);
    parts.push('<span class="chip">'+esc(label)+' '+count+'</span>');
  });
  if (state.skills && Array.isArray(state.skills.skills)) {
    state.skills.skills.slice(0, 3).forEach(function(name) {
      parts.push('<span class="chip">'+esc(name)+'</span>');
    });
  }
  sidebarInfoEl.innerHTML = parts.join('') || '<span class="chip">No discovery data</span>';
}

/* ── Render: Detail area (main) ── */
function renderDetailArea() {
  if (state.activeTab === 'runs') {
    if (!state.selectedRunId || !state.selectedRun) {
      renderPlaybookRunOverviewDetail();
      return;
    }
    renderPlaybookRunDetail();
    return;
  }
  if (!state.selectedSessionId || !state.selectedSession) {
    renderOverviewDetail();
    return;
  }
  renderSessionDetail();
}

function renderPlaybookRunOverviewDetail() {
  var payload = state.playbookRuns || {};
  var runs = Array.isArray(payload.runs) ? payload.runs : [];
  mainTitleEl.textContent = 'Playbook Runs';
  mainSubtitleEl.textContent = payload.workspaceDir || 'Waiting for playbook run data';
  var rows = [
    ['Workspace', payload.workspaceDir || 'n/a'],
    ['Runs', String(runs.length)],
    ['Latest update', runs.length ? fmtRel((runs[0] || {}).updatedAt) : 'n/a'],
  ];
  var html = panelHtml('Run Actions', null,
    '<div class="detail-actions">'+
      '<button type="button" class="action-btn" data-run-action="start-run">Start Run</button>'+
      '<button type="button" class="action-btn" data-run-action="refresh-runs">Refresh Runs</button>'+
    '</div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">These actions use the generic playbook.run RPC entrypoints directly from the dashboard.</div>'
  );
  html += panelHtml('Run Overview', '<span class="panel-badge">Playbooks</span>', rows.map(function(r) {
    return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
  }).join(''));
  html += panelHtml('Recent Runs', runs.length ? runs.length+' tracked' : null, runs.length
    ? runs.map(function(run) {
      return '<div class="detail-row"><span class="detail-label">'+esc(playbookRunLabel(run))+'</span><span class="detail-value">'+esc([run.id, run.status, playbookRunStageLabel(run)].join(' · '))+'</span></div>';
    }).join('')
    : '<div class="empty">No playbook runs yet</div>');
  detailAreaEl.innerHTML = html;
}

function renderOverviewDetail() {
  mainTitleEl.textContent = 'Overview';
  mainSubtitleEl.textContent = state.lastRefreshAt ? 'Last refreshed '+fmtRel(state.lastRefreshAt) : '';
  var html = '';

  /* Config panel */
  if (state.config) {
    var cfg = state.config;
    var rows = [
      ['Default model', [cfg.defaultProvider, cfg.defaultModel].filter(Boolean).join('/') || 'unset'],
      ['Thinking', cfg.defaultThinkingLevel || 'default'],
      ['Profile', cfg.agent && cfg.agent.runtimeProfile ? cfg.agent.runtimeProfile : 'assistant'],
      ['Workspace', (cfg.agent && cfg.agent.cwd) || 'current'],
    ];
    html += panelHtml('Configuration', null, rows.map(function(r) {
      return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
    }).join(''));
  }

  /* Readiness panel */
  if (state.readiness && Array.isArray(state.readiness.checks) && state.readiness.checks.length) {
    html += panelHtml('Runtime Readiness', null, state.readiness.checks.map(function(c) {
      var t = tone(c.status);
      return '<div class="readiness-row">'+
        '<span class="dot '+t+'"></span>'+
        '<span class="readiness-label">'+esc(c.label || c.id || 'check')+'</span>'+
        '<span class="readiness-detail">'+esc(c.detail || '')+'</span>'+
        '<span class="readiness-badge">'+esc(c.summary || c.status || 'unknown')+'</span>'+
      '</div>';
    }).join(''));
  }

  if (Array.isArray(state.channels) && state.channels.length) {
    html += panelHtml('Channel Operations', state.channels.length + ' configured', state.channels.map(function(ch) {
      return '<div class="detail-row" style="display:block">'+
        '<div class="detail-label" style="margin-bottom:4px">'+esc(ch.name || ch.id || 'channel')+' <span class="mono">'+esc(ch.id || '')+'</span></div>'+
        '<div class="detail-value">'+esc(channelCapabilitySummary(ch.capabilities))+'</div>'+
        '<div class="detail-value" style="font-size:12px;color:var(--text-secondary)">'+esc(channelActionHint(ch))+'</div>'+
      '</div>';
    }).join(''));
  }

  /* Teach info */
  html += panelHtml('Teach by Demonstration', null,
    '<div style="padding:4px 0;font-size:13px;color:var(--text-secondary)">Use <span class="mono">/teach start</span> to record a demo, then <span class="mono">/teach stop</span> to open a task-shaping dialogue. Use <span class="mono">/teach confirm</span> when the task card is ready. Add <span class="mono">--validate</span> or run <span class="mono">/teach validate &lt;draftId&gt;</span> whenever you want replay validation; publishing does not require it.</div>'
  );

  detailAreaEl.innerHTML = html;
}

function renderPlaybookRunDetail() {
  var payload = state.selectedRun || {};
  var run = payload.run || null;
  var summary = payload.summary || run || {};
  if (!run) {
    renderPlaybookRunOverviewDetail();
    return;
  }
  mainTitleEl.textContent = playbookRunLabel(summary);
  mainSubtitleEl.textContent = [summary.id || run.id, summary.status || run.status, summary.playbookName || run.playbookName].filter(Boolean).join(' · ');

  var routeRows = [
    ['Run', run.id || 'unknown'],
    ['Playbook', run.playbookName || 'unknown'],
    ['Status', run.status || 'unknown'],
    ['Current stage', playbookRunStageLabel(summary)],
    ['Child session', playbookRunChildLabel(summary)],
    ['Approval', run.approval && run.approval.state ? run.approval.state : 'n/a'],
    ['Artifacts root', run.artifacts && run.artifacts.rootDir ? run.artifacts.rootDir : 'n/a'],
    ['Updated', fmtTime(run.updatedAt)],
  ];
  var badge = '<a class="panel-badge" href="'+esc(playbookRunViewHref(run.id, payload.workspaceDir || ''))+'" target="_blank" rel="noreferrer">JSON</a>';
  var html = panelHtml('Run Actions', null,
    '<div class="detail-actions">'+
      '<button type="button" class="action-btn" data-run-action="resume-run">Resume State</button>'+
      '<button type="button" class="action-btn" data-run-action="next-stage">Run Next Stage</button>'+
      '<button type="button" class="action-btn" data-run-action="refresh-runs">Refresh Runs</button>'+
    '</div>'
  );
  html += panelHtml('Run Status', badge, routeRows.map(function(r) {
    return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
  }).join(''));

  var stages = Array.isArray(run.stages) ? run.stages : [];
  html += panelHtml('Stage Progress', stages.length ? stages.length+' stages' : null, stages.length
    ? stages.map(function(stage) {
      return '<div class="detail-row"><span class="detail-label">'+esc(stage.name || stage.id || 'stage')+'</span><span class="detail-value">'+esc([stage.kind || 'stage', stage.status || 'pending'].join(' · '))+'</span></div>';
    }).join('')
    : '<div class="empty">No stage data</div>');

  var workerBudget = run.budgets && run.budgets.worker ? run.budgets.worker : null;
  html += panelHtml('Worker Budget', workerBudget ? 'Worker budget' : null, workerBudget
    ? [
      ['Minutes', workerBudget.maxMinutes != null ? String(workerBudget.maxMinutes) : 'n/a'],
      ['Actions', workerBudget.maxActions != null ? String(workerBudget.maxActions) : 'n/a'],
      ['Screenshots', workerBudget.maxScreenshots != null ? String(workerBudget.maxScreens) : 'n/a'],
    ].map(function(r) {
      return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
    }).join('')
    : '<div class="empty">No worker budget recorded</div>');

  var children = Array.isArray(run.childSessions) ? run.childSessions : [];
  html += panelHtml('Child Sessions', children.length ? children.length+' sessions' : null, children.length
    ? children.map(function(child) {
      return '<div class="detail-row"><span class="detail-label">'+esc(child.label || child.sessionId || 'child')+'</span><span class="detail-value">'+esc([child.sessionId || '', child.status || '', fmtTime(child.updatedAt)].filter(Boolean).join(' · '))+'</span></div>';
    }).join('')
    : '<div class="empty">No child sessions recorded</div>');

  detailAreaEl.innerHTML = html;
}

function renderSessionDetail() {
  var s = state.selectedSession;
  mainTitleEl.textContent = sessionListLabel(s) || 'Session';
  mainSubtitleEl.innerHTML = sessionChipRowHtml(s) || esc(s.id || '');

  var html = '';

  /* Route details */
  var rows = [
    ['Session', s.id || 'unknown'],
    ['Model', s.model || 'unset'],
    ['Profile', s.runtimeProfile || 'assistant'],
    ['Channel', s.channelId || 'local'],
    ['Conversation', conversationLabel(s) || '—'],
    ['Sender', senderLabel(s) || 'gateway'],
    ['Workspace', s.workspaceDir || 'default'],
    ['Created', fmtTime(s.createdAt)],
    ['Last active', fmtTime(s.lastActiveAt)],
    ['Messages', String(s.messageCount || 0)],
  ];
  var badge = '<a class="panel-badge" href="'+esc(sessionViewHref(s.id))+'" target="_blank" rel="noreferrer">JSON</a>';
  html += panelHtml('Route', badge, rows.map(function(r) {
    return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
  }).join(''));

  var teach = s && s.teachClarification && typeof s.teachClarification === 'object' ? s.teachClarification : null;
  if (teach) {
    var teachRows = [
      ['Draft', teach.draftId || 'unknown'],
      ['Status', teach.status || 'clarifying'],
      ['Updated', teach.updatedAt ? fmtTime(teach.updatedAt) : 'n/a'],
    ];
    if (teach.summary) teachRows.push(['Summary', teach.summary]);
    if (teach.nextQuestion) teachRows.push(['Next question', teach.nextQuestion]);
    html += panelHtml('Teach Status', '<span class="panel-badge">Live</span>', teachRows.map(function(r) {
      return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
    }).join('') + '<div class="detail-row"><span class="detail-label">Next</span><span class="detail-value">' + esc(
      teach.status === 'ready'
        ? 'Run /teach confirm, then /teach publish ' + (teach.draftId || '<draftId>') + ' [skill-name]. Optional: /teach confirm --validate or /teach validate ' + (teach.draftId || '<draftId>')
        : 'Reply in plain language to continue clarification.'
    ) + '</span></div>');
  }

  /* History */
  var history = Array.isArray(state.selectedHistory) ? state.selectedHistory : [];
  if (history.length) {
    html += panelHtml('Recent History', history.length+' messages', history.map(function(e) {
      return '<div class="history-item">'+
        '<div class="history-role"><span>'+esc(e.role || 'message')+'</span><span>'+esc(fmtTime(e.timestamp))+'</span></div>'+
        '<div class="history-body">'+esc(e.text || '')+'</div>'+
      '</div>';
    }).join(''));
  } else {
    html += panelHtml('Recent History', null, '<div class="empty">No stored history</div>');
  }

  /* Trace */
  var tracePayload = state.selectedTrace || {};
  var traceRuns = Array.isArray(tracePayload.runs) ? tracePayload.runs : [];
  var traceEvents = Array.isArray(tracePayload.events) ? tracePayload.events : [];
  if (traceRuns.length) {
    html += panelHtml('Execution Trace', traceRuns.length+' runs', traceRuns.map(function(run) {
      var meta = [
        run.durationMs != null ? run.durationMs+'ms' : '',
        run.recordedAt ? fmtTime(run.recordedAt) : '',
      ].filter(Boolean).join(' &middot; ');
      var body = [
        run.userPromptPreview ? 'Prompt: '+run.userPromptPreview : '',
        run.responsePreview ? 'Reply: '+run.responsePreview : '',
      ].filter(Boolean).join('\\n');
      var toolTrace = Array.isArray(run.toolTrace) ? run.toolTrace : [];
      var subItems = toolTrace.map(function(ev) {
        var evMeta = [ev.route || 'system', ev.type || 'event'].filter(Boolean).join(' &middot; ');
        return '<div class="trace-subitem"><div class="trace-subtitle">'+esc(ev.name || ev.type || 'step')+'</div><div class="trace-meta">'+esc(evMeta)+'</div></div>';
      }).join('');
      return '<div class="trace-item">'+
        '<div class="trace-head"><div><div class="trace-title">Run '+esc(run.runId || '?')+'</div><div class="trace-meta">'+meta+'</div></div></div>'+
        (body ? '<div class="trace-body">'+esc(body)+'</div>' : '')+
        subItems+
      '</div>';
    }).join(''));
  } else if (traceEvents.length) {
    html += panelHtml('Execution Trace', traceEvents.length+' events', traceEvents.map(function(ev) {
      var meta = [
        ev.route || 'system',
        ev.durationMs != null ? ev.durationMs+'ms' : '',
        ev.timestamp ? fmtTime(ev.timestamp) : '',
      ].filter(Boolean).join(' &middot; ');
      var preview = (ev.result && ev.result.textPreview) || ev.error || '';
      return '<div class="trace-item">'+
        '<div class="trace-head"><div><div class="trace-title">'+esc(ev.toolName || 'tool')+'</div><div class="trace-meta">'+meta+'</div></div></div>'+
        (preview ? '<div class="trace-body">'+esc(preview)+'</div>' : '')+
      '</div>';
    }).join(''));
  } else {
    html += panelHtml('Execution Trace', null, '<div class="empty">No trace data</div>');
  }

  detailAreaEl.innerHTML = html;
}

function panelHtml(title, badge, body) {
  return '<div class="detail-panel">'+
    '<div class="detail-panel-header"><h3>'+esc(title)+'</h3>'+(badge ? '<span class="panel-badge">'+badge+'</span>' : '')+'</div>'+
    '<div class="detail-panel-body">'+body+'</div>'+
  '</div>';
}

/* ── Event listeners ── */
refreshBtnEl.addEventListener('click', function(){ void refreshAll(); });

sidebarContentEl.addEventListener('click', function(e) {
  var target = e.target;
  /* Delete button */
  var delBtn = target instanceof Element ? target.closest('[data-del-sid]') : null;
  if (delBtn) {
    e.stopPropagation();
    var sid = delBtn.getAttribute('data-del-sid') || '';
    if (sid && confirm('Delete session '+sid+'?')) void deleteSession(sid);
    return;
  }
  /* Session select */
  var item = target instanceof Element ? target.closest('[data-sid]') : null;
  if (item) {
    var sessionId = item.getAttribute('data-sid') || '';
    if (sessionId === state.selectedSessionId) {
      deselectSession();
    } else if (sessionId) {
      void loadSessionDetail(sessionId);
    }
    return;
  }
  var runItem = target instanceof Element ? target.closest('[data-rid]') : null;
  if (!runItem) return;
  var runId = runItem.getAttribute('data-rid') || '';
  if (runId === state.selectedRunId) {
    deselectPlaybookRun();
  } else if (runId) {
    void loadPlaybookRunDetail(runId);
  }
});

detailAreaEl.addEventListener('click', function(e) {
  var target = e.target instanceof Element ? e.target.closest('[data-run-action]') : null;
  if (!target) return;
  var action = target.getAttribute('data-run-action') || '';
  if (action === 'start-run') {
    void startPlaybookRunFromUi();
    return;
  }
  if (action === 'resume-run') {
    void resumePlaybookRunFromUi();
    return;
  }
  if (action === 'next-stage') {
    void advancePlaybookRunFromUi();
    return;
  }
  if (action === 'refresh-runs') {
    void refreshAll();
    return;
  }
});

/* ── Init ── */
void refreshAll();
setInterval(function() {
  void refreshOverview().catch(function(){});
  void refreshSessions().catch(function(){});
  if (state.selectedSessionId) void loadSessionDetail(state.selectedSessionId).catch(function(){});
}, 15000);`;
}
