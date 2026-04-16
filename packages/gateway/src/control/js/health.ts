/**
 * Control Dashboard JS — health, state, DOM refs, helpers, and data fetching.
 * Composed into a single <script> block by js/index.ts.
 */

export function getControlHealthJS(): string {
	return `var BASE = location.origin;
var headers = { 'Content-Type': 'application/json' };
var token = new URLSearchParams(location.search).get('token') || '';
if (token) headers.Authorization = 'Bearer ' + token;

var state = {
  health: null,
  channels: [],
  config: null,
  models: [],
  capabilities: null,
  tools: [],
  toolSummary: null,
  skills: null,
  playbookRuns: null,
  playbookWorkspaceDir: '',
  schedule: null,
  readiness: null,
  sessions: [],
  selectedSessionId: '',
  selectedSession: null,
  selectedHistory: [],
  selectedTrace: null,
  selectedRunId: '',
  selectedRun: null,
  activeTab: 'sessions',
  lastRefreshAt: 0,
};

/* ── DOM refs ── */
var statusBarEl = document.getElementById('status-bar');
var sidebarContentEl = document.getElementById('sidebar-content');
var sidebarInfoEl = document.getElementById('sidebar-info');
var mainTitleEl = document.getElementById('main-title');
var mainSubtitleEl = document.getElementById('main-subtitle');
var summaryCardsEl = document.getElementById('summary-cards');
var detailAreaEl = document.getElementById('detail-area');
var statusNoticeEl = document.getElementById('status-notice');
var refreshBtnEl = document.getElementById('refresh-btn');

/* ── Helpers ── */
function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function rpc(method, params) {
  return fetch(BASE+'/rpc',{method:'POST',headers:headers,body:JSON.stringify({id:Date.now().toString(),method:method,params:params||{}})})
    .then(function(r){return r.json()}).then(function(r){if(r.error)throw new Error(r.error.message);return r.result});
}
function fmtRel(ts) {
  if (!ts) return 'n/a';
  var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  var m = Math.floor(s/60);
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m/60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h/24) + 'd ago';
}
function fmtTime(ts) {
  if (!ts) return 'n/a';
  return new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function senderLabel(session) {
  return sessionUiSenderLabel(session);
}
function conversationLabel(session) {
  return sessionUiConversationLabel(session);
}
function sessionListLabel(session) {
  return sessionUiPrimaryLabel(session);
}
function sessionChipItems(session, options) {
  var opts = options && typeof options === 'object' ? options : {};
  return sessionUiChipItems(session, {
    includeChannel: opts.includeChannel,
    includeConversation: opts.includeConversation,
    includeSender: opts.includeSender !== false,
    includeReadOnly: opts.includeReadOnly,
    readOnly: opts.includeReadOnly === true,
  });
}
function sessionChipRowHtml(session, options) {
  var items = sessionChipItems(session, options);
  if (!items.length) return '';
  return '<div class="chip-row">' + items.map(function(item) {
    return '<span class="chip '+esc(item.kind)+'">'+esc(item.text)+'</span>';
  }).join('') + '</div>';
}
function fmtBytes(b) {
  var v = Number(b||0);
  if (v <= 0) return '0 B';
  var u = ['B','KB','MB','GB'];
  for (var i = 0; i < u.length; i++) {
    if (v < 1024 || i === u.length-1) return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
    v /= 1024;
  }
  return v + ' B';
}
function fmtUptime(ms) {
  var s = Math.max(0, Math.floor((ms||0)/1000));
  var d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  if (d > 0) return d+'d '+h+'h';
  if (h > 0) return h+'h '+m+'m';
  return m+'m';
}
function tone(v) {
  var t = String(v||'').toLowerCase();
  if (t.includes('run')||t.includes('ok')||t.includes('connect')||t.includes('ready')) return 'ok';
  if (t.includes('error')||t.includes('fail')||t.includes('down')||t.includes('stop')||t.includes('offline')) return 'err';
  return 'warn';
}
function playbookRunStageLabel(run) {
  var stage = run && run.currentStage && typeof run.currentStage === 'object' ? run.currentStage : null;
  if (!stage) return 'No pending stage';
  return [stage.name || stage.id || 'Stage', stage.status || 'pending'].filter(Boolean).join(' · ');
}
function playbookRunChildLabel(run) {
  var child = run && run.childSession && typeof run.childSession === 'object' ? run.childSession : null;
  if (!child) return 'No child session';
  return [child.label || 'child', child.status || 'unknown'].filter(Boolean).join(' · ');
}
function playbookRunStatusTone(run) {
  if (!run) return 'warn';
  return tone(run.status || '');
}
function playbookRunLabel(run) {
  return run && run.playbookName ? run.playbookName : 'Playbook run';
}
function channelCapabilitySummary(caps) {
  if (!caps || typeof caps !== 'object') return 'Capabilities: none';
  var enabled = Object.keys(caps).filter(function(key) { return !!caps[key]; });
  return 'Capabilities: ' + (enabled.length ? enabled.join(', ') : 'none');
}
function channelActionHint(ch) {
  var runtime = ch && ch.runtime && typeof ch.runtime === 'object' ? ch.runtime : {};
  if (runtime.state === 'awaiting_pairing') return 'Next: complete pairing or QR login.';
  if (runtime.state === 'error' && runtime.lastError) return 'Fix: ' + runtime.lastError;
  if (runtime.summary) return runtime.summary;
  return 'Ready for inbound and outbound messaging checks.';
}

/* ── Apply token to webchat link ── */
(function(){
  var href = token ? '/webchat?token='+encodeURIComponent(token) : '/webchat';
  document.getElementById('webchat-link').setAttribute('href', href);
  document.getElementById('main-webchat-link').setAttribute('href', href);
})();

function showNotice(text, kind) {
  if (!statusNoticeEl) return;
  statusNoticeEl.textContent = String(text || '');
  statusNoticeEl.className = 'notice ' + (kind === 'error' ? 'error' : 'info');
}

function clearNotice() {
  if (!statusNoticeEl) return;
  statusNoticeEl.textContent = '';
  statusNoticeEl.className = 'notice hidden';
}

/* ── Data fetching ── */
function pickSkills(src) {
  if (!src || typeof src !== 'object') return null;
  if (src.discovery && src.discovery.skills) return src.discovery.skills;
  if (src.skills && typeof src.skills === 'object' && !Array.isArray(src.skills)) return src.skills;
  return null;
}

async function refreshOverview() {
  var tasks = await Promise.allSettled([
    fetch(BASE+'/health',{headers:headers}).then(function(r){return r.json()}),
    fetch(BASE+'/channels',{headers:headers}).then(function(r){return r.json()}),
    rpc('health'),
    rpc('config.get'),
    rpc('models.list'),
    rpc('capabilities.get'),
    rpc('tools.catalog'),
    rpc('skills.status'),
    rpc('schedule.status'),
    rpc('runtime.readiness'),
    rpc('playbook.run.list', {
      limit: 20,
      workspaceDir: state.playbookWorkspaceDir || undefined,
    }),
  ]);
  var httpH = tasks[0].status === 'fulfilled' ? tasks[0].value : null;
  var chP = tasks[1].status === 'fulfilled' ? tasks[1].value : null;
  var rpcH = tasks[2].status === 'fulfilled' ? tasks[2].value : null;
  state.health = Object.assign({}, httpH || {}, rpcH || {});
  state.channels = chP && Array.isArray(chP.channels) ? chP.channels : (state.health.channelStatuses || []);
  state.config = tasks[3].status === 'fulfilled' ? tasks[3].value : null;
  if (tasks[4].status === 'fulfilled') {
    var mp = tasks[4].value || {};
    state.models = Array.isArray(mp.models) ? mp.models : [];
  }
  state.capabilities = tasks[5].status === 'fulfilled' ? tasks[5].value : null;
  if (tasks[6].status === 'fulfilled') {
    var tp = tasks[6].value || {};
    state.tools = Array.isArray(tp.tools) ? tp.tools : [];
    state.toolSummary = tp.summary || null;
  } else {
    state.tools = [];
  }
  state.skills = pickSkills(state.capabilities);
  if (!state.skills && tasks[7].status === 'fulfilled') state.skills = tasks[7].value || null;
  state.schedule = tasks[8].status === 'fulfilled' ? tasks[8].value : null;
  state.readiness = tasks[9].status === 'fulfilled' ? tasks[9].value : (state.health.readiness || null);
  state.playbookRuns = tasks[10].status === 'fulfilled' ? tasks[10].value : null;
  state.lastRefreshAt = Date.now();
  renderStatusBar();
  renderSummaryCards();
  renderSidebar();
  renderDetailArea();
}

async function refreshSessions() {
  try {
    var result = await rpc('session.list', {});
    state.sessions = Array.isArray(result)
      ? result.slice().sort(function(a,b){return (b.lastActiveAt||0)-(a.lastActiveAt||0)})
      : [];
  } catch(e) {
    state.sessions = [];
  }
  var stillPresent = state.selectedSessionId && state.sessions.some(function(s){return s.id === state.selectedSessionId});
  if (!stillPresent && state.selectedSessionId) deselectSession();
  renderSidebar();
  renderSummaryCards();
}

async function refreshAll() {
  refreshBtnEl.disabled = true;
  try {
    await Promise.all([refreshOverview(), refreshSessions()]);
    if (state.selectedSessionId) await loadSessionDetail(state.selectedSessionId);
    if (state.selectedRunId) await loadPlaybookRunDetail(state.selectedRunId);
  } finally {
    refreshBtnEl.disabled = false;
  }
}`;
}
