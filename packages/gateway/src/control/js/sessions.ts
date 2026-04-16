/**
 * Control Dashboard JS — session and playbook action handlers.
 * Composed into a single <script> block by js/index.ts.
 */

export function getControlSessionsJS(): string {
	return `function sessionViewHref(sid) {
  var q = 'method=session.get&sessionId='+encodeURIComponent(sid);
  return '/rpc-view?'+q+(token ? '&token='+encodeURIComponent(token) : '');
}

function playbookRunViewHref(runId, workspaceDir) {
  var q = 'method=playbook.run.get&runId='+encodeURIComponent(runId || '');
  if (workspaceDir) q += '&workspaceDir='+encodeURIComponent(workspaceDir);
  return '/rpc-view?'+q+(token ? '&token='+encodeURIComponent(token) : '');
}

/* ── Session selection ── */
async function loadSessionDetail(sid) {
  state.selectedSessionId = sid;
  state.selectedSession = null;
  state.selectedHistory = [];
  state.selectedTrace = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
  try {
    var results = await Promise.all([
      rpc('session.get', { sessionId: sid }),
      rpc('session.history', { sessionId: sid, limit: 8 }),
      rpc('session.trace', { sessionId: sid, limit: 12 }),
    ]);
    state.selectedSession = results[0] || null;
    var hp = results[1] || {};
    state.selectedHistory = Array.isArray(hp.messages) ? hp.messages : [];
    state.selectedTrace = results[2] || null;
  } catch (err) {
    state.selectedSession = null;
    showNotice('Session inspect failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
  renderSidebar();
  renderDetailArea();
}

async function loadPlaybookRunDetail(runId) {
  state.selectedRunId = runId;
  state.selectedRun = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
  try {
    state.selectedRun = await rpc('playbook.run.get', {
      runId: runId,
      workspaceDir: state.playbookRuns && state.playbookRuns.workspaceDir ? state.playbookRuns.workspaceDir : undefined,
    });
  } catch (err) {
    state.selectedRun = null;
    showNotice('Run inspect failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
  renderSidebar();
  renderDetailArea();
}

async function deleteSession(sid) {
  if (!sid) return;
  try {
    await rpc('session.delete', { sessionId: sid });
    showNotice('Session '+sid+' deleted.', 'info');
    if (state.selectedSessionId === sid) {
      state.selectedSessionId = '';
      state.selectedSession = null;
      state.selectedHistory = [];
      state.selectedTrace = null;
    }
    await refreshSessions();
    renderDetailArea();
  } catch (err) {
    showNotice('Delete failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}

function deselectSession() {
  state.selectedSessionId = '';
  state.selectedSession = null;
  state.selectedHistory = [];
  state.selectedTrace = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
}

function deselectPlaybookRun() {
  state.selectedRunId = '';
  state.selectedRun = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
}

async function startPlaybookRunFromUi() {
  var playbookName = prompt('Playbook name?', '');
  if (!playbookName) return;
  var rawInputs = prompt('Inputs JSON? (optional)', '{}');
  if (rawInputs === null) return;
  var parsedInputs = {};
  try {
    parsedInputs = rawInputs ? JSON.parse(rawInputs) : {};
  } catch (err) {
    showNotice('Inputs must be valid JSON.', 'error');
    return;
  }
  try {
    var started = await rpc('playbook.run.start', {
      workspaceDir: state.playbookWorkspaceDir || undefined,
      playbookName: playbookName,
      inputs: parsedInputs,
    });
    state.activeTab = 'runs';
    document.querySelectorAll('.nav-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === 'runs');
    });
    showNotice('Started run '+(started && started.run && started.run.id ? started.run.id : 'new run')+'.', 'info');
    await refreshOverview();
    if (started && started.run && started.run.id) {
      await loadPlaybookRunDetail(started.run.id);
    } else {
      renderSidebar();
      renderDetailArea();
    }
  } catch (err) {
    showNotice('Start run failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}

async function resumePlaybookRunFromUi() {
  if (!state.selectedRunId) {
    showNotice('Select a run first.', 'error');
    return;
  }
  try {
    var resumed = await rpc('playbook.run.resume', {
      workspaceDir: state.playbookRuns && state.playbookRuns.workspaceDir ? state.playbookRuns.workspaceDir : undefined,
      runId: state.selectedRunId,
    });
    showNotice('Resumed '+state.selectedRunId+' at '+(resumed && resumed.nextStage ? resumed.nextStage.name : 'the current stage')+'.', 'info');
    await refreshOverview();
    await loadPlaybookRunDetail(state.selectedRunId);
  } catch (err) {
    showNotice('Resume failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}

async function advancePlaybookRunFromUi() {
  if (!state.selectedRunId) {
    showNotice('Select a run first.', 'error');
    return;
  }
  var parentSessionId = prompt('Parent session id?', state.selectedSessionId || '');
  if (!parentSessionId) {
    showNotice('A parent session id is required to run the next stage.', 'error');
    return;
  }
  try {
    var result = await rpc('playbook.run.next', {
      workspaceDir: state.playbookRuns && state.playbookRuns.workspaceDir ? state.playbookRuns.workspaceDir : undefined,
      runId: state.selectedRunId,
      parentSessionId: parentSessionId,
    });
    showNotice('Advanced '+state.selectedRunId+' with '+(result && result.mode ? result.mode : 'the next stage')+'.', 'info');
    await refreshOverview();
    await loadPlaybookRunDetail(state.selectedRunId);
  } catch (err) {
    showNotice('Next stage failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}`;
}
