const DEFAULT_SUPABASE_URL = 'https://vmwwvwtsznxwoswzdzui.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_hfVfEOEyUxTAl9TCGQLQdA_2qpquHGk';
const EDGE_FUNCTION_NAME = 'quest-export-validate';
const AUTH_EXP_SKEW_MS = 30 * 1000;
const EDGE_401_HINT = '401 from Edge Function. If "Verify JWT" is enabled with a publishable key (sb_publishable_), disable Verify JWT for this function and validate Authorization token inside function code.';

const TAB_FILE_NAMES = {
  runtime: 'quest_runtime_export.json',
  dataAsset: 'quest_dataasset_export.json',
  unity: 'quest_unity_export.json',
  debug: 'quest_debug_pack.json'
};

const state = {
  sourceLabel: 'none',
  sourceTimestamp: 0,
  sourcePayload: null,
  sourceLookup: { nodeNameById: {}, socketNameById: {} },
  projectMeta: null,
  issues: [],
  diagnostics: [],
  summary: { critical: 0, warning: 0, runtime: 0, unreachable: 0 },
  exports: { runtime: '', dataAsset: '', unity: '', debug: '' },
  hasValidationResult: false,
  activeTab: 'diagnostics',
  selectedIssueIndex: -1,
  options: { pretty: true, includeDocs: false, includeSourceInDebug: true }
};

let requestReplyTimer = null;
let authReplyTimer = null;
let pendingAuthResolve = null;
let pendingAuthReject = null;
let validateSequence = 0;
const authContextCache = {
  isAuth: false,
  accessToken: '',
  supabaseUrl: DEFAULT_SUPABASE_URL,
  supabaseAnonKey: DEFAULT_SUPABASE_ANON_KEY,
  expiresAt: 0
};

const els = {
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  sourceMeta: document.getElementById('sourceMeta'),
  countCritical: document.getElementById('countCritical'),
  countWarning: document.getElementById('countWarning'),
  countRuntime: document.getElementById('countRuntime'),
  countUnreachable: document.getElementById('countUnreachable'),
  issueCount: document.getElementById('issueCount'),
  issueList: document.getElementById('issueList'),
  diagGrid: document.getElementById('diagGrid'),
  runtimeOutput: document.getElementById('runtimeOutput'),
  dataAssetOutput: document.getElementById('dataAssetOutput'),
  unityOutput: document.getElementById('unityOutput'),
  debugOutput: document.getElementById('debugOutput'),
  pasteInput: document.getElementById('pasteInput'),
  fileInput: document.getElementById('fileInput'),
  optPretty: document.getElementById('optPretty'),
  optIncludeDocs: document.getElementById('optIncludeDocs'),
  optIncludeSource: document.getElementById('optIncludeSource')
};

function setStatus(text, tone) {
  els.statusText.textContent = text;
  els.status.classList.remove('ok', 'warn', 'critical');
  if (tone) els.status.classList.add(tone);
}

function cloneJson(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
}

function escapeRegExp(v) {
  return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNodeDisplayName(node, fallbackId) {
  if (!node || typeof node !== 'object') return fallbackId || 'node';
  const d = node && typeof node.data === 'object' ? node.data : {};
  const title = typeof d.title === 'string' ? d.title.trim() : '';
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  const type = typeof node.type === 'string' ? node.type.trim() : '';
  if (title) return title;
  if (name) return name;
  if (type) return type;
  return fallbackId || 'node';
}

function buildSourceLookup(payload) {
  const lookup = { nodeNameById: {}, socketNameById: {} };
  const nodes = payload && Array.isArray(payload.nodes) ? payload.nodes : [];

  nodes.forEach((node) => {
    if (!node || typeof node !== 'object') return;
    const nodeId = typeof node.id === 'string' ? node.id : '';
    if (!nodeId) return;
    const nodeName = getNodeDisplayName(node, nodeId);
    lookup.nodeNameById[nodeId] = nodeName;

    if (node.type !== 'switcher') return;
    const d = node && typeof node.data === 'object' ? node.data : {};
    const cases = Array.isArray(d.cases) ? d.cases : [];
    cases.forEach((caseItem, index) => {
      if (!caseItem || typeof caseItem !== 'object') return;
      const socketId = typeof caseItem.socketId === 'string' ? caseItem.socketId : '';
      if (!socketId) return;
      const caseVal = caseItem.value == null ? '' : String(caseItem.value).trim();
      const caseLabel = caseVal ? ('Case "' + caseVal + '"') : ('Case #' + (index + 1));
      lookup.socketNameById[socketId] = nodeName + ' -> ' + caseLabel;
    });
  });

  return lookup;
}

function getReadableNodeRef(issue) {
  const nodeId = issue && typeof issue.nodeId === 'string' ? issue.nodeId : '';
  const nodeTitle = issue && typeof issue.nodeTitle === 'string' ? issue.nodeTitle.trim() : '';
  if (!nodeId && !nodeTitle) return '';
  if (nodeTitle && nodeId) return nodeTitle + ' (' + nodeId + ')';
  if (nodeTitle) return nodeTitle;
  const display = state.sourceLookup && state.sourceLookup.nodeNameById
    ? state.sourceLookup.nodeNameById[nodeId]
    : '';
  if (!display || display === nodeId) return nodeId;
  return display + ' (' + nodeId + ')';
}

function replaceTokenWithLabel(message, token, label) {
  const rawToken = typeof token === 'string' ? token.trim() : '';
  const rawLabel = typeof label === 'string' ? label.trim() : '';
  if (!rawToken || !rawLabel) return message;
  const re = new RegExp('\\b' + escapeRegExp(rawToken) + '\\b', 'g');
  return String(message).replace(re, rawLabel + ' (' + rawToken + ')');
}

function humanizeIssueMessage(issue) {
  const rawMessage = issue && (issue.message || issue.text) ? (issue.message || issue.text) : 'Issue';
  let message = String(rawMessage);
  const nodeId = issue && typeof issue.nodeId === 'string' ? issue.nodeId : '';
  const nodeTitle = issue && typeof issue.nodeTitle === 'string' ? issue.nodeTitle.trim() : '';
  const socketId = issue && typeof issue.socketId === 'string' ? issue.socketId : '';
  const socketLabel = issue && typeof issue.socketLabel === 'string' ? issue.socketLabel.trim() : '';

  if (socketId && socketLabel) {
    message = replaceTokenWithLabel(message, socketId, socketLabel);
  }
  if (nodeId && nodeTitle) {
    message = replaceTokenWithLabel(message, nodeId, nodeTitle);
  }

  const socketNameById = state.sourceLookup && state.sourceLookup.socketNameById
    ? state.sourceLookup.socketNameById
    : {};
  const nodeNameById = state.sourceLookup && state.sourceLookup.nodeNameById
    ? state.sourceLookup.nodeNameById
    : {};

  Object.keys(socketNameById).sort((a, b) => b.length - a.length).forEach((socketId) => {
    const pretty = socketNameById[socketId];
    if (!pretty) return;
    const re = new RegExp('\\b' + escapeRegExp(socketId) + '\\b', 'g');
    message = message.replace(re, pretty + ' (' + socketId + ')');
  });

  Object.keys(nodeNameById).sort((a, b) => b.length - a.length).forEach((nodeId) => {
    const pretty = nodeNameById[nodeId];
    if (!pretty || pretty === nodeId) return;
    const re = new RegExp('\\b' + escapeRegExp(nodeId) + '\\b', 'g');
    message = message.replace(re, pretty + ' (' + nodeId + ')');
  });

  return message;
}

function getProjectMeta(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return {
    title: String(p.title || '').trim(),
    nodes: Array.isArray(p.nodes) ? p.nodes.length : 0,
    connections: Array.isArray(p.connections) ? p.connections.length : 0
  };
}

function clearPendingAuth() {
  if (authReplyTimer) {
    clearTimeout(authReplyTimer);
    authReplyTimer = null;
  }
  pendingAuthResolve = null;
  pendingAuthReject = null;
}

function parseJwtExpMs(token) {
  if (!token || typeof token !== 'string') return 0;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const payload = JSON.parse(atob(b64));
    const exp = Number(payload && payload.exp ? payload.exp : 0);
    return exp > 0 ? exp * 1000 : 0;
  } catch (err) {
    return 0;
  }
}

function normalizeAuthContext(data) {
  const isAuth = Boolean(data && data.isAuth);
  const accessToken = data && typeof data.accessToken === 'string' ? data.accessToken : '';
  const supabaseUrl = data && typeof data.supabaseUrl === 'string' && data.supabaseUrl ? data.supabaseUrl : DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = data && typeof data.supabaseAnonKey === 'string' && data.supabaseAnonKey ? data.supabaseAnonKey : DEFAULT_SUPABASE_ANON_KEY;
  return {
    isAuth,
    accessToken,
    supabaseUrl,
    supabaseAnonKey,
    expiresAt: parseJwtExpMs(accessToken)
  };
}

function canUseCachedAuthContext() {
  if (!authContextCache.isAuth || !authContextCache.accessToken) return false;
  const now = Date.now();
  return authContextCache.expiresAt > now + AUTH_EXP_SKEW_MS;
}

function requestAuthContext() {
  if (!window.parent || window.parent === window) {
    return Promise.reject(new Error('Standalone mode: no parent architect for auth bridge.'));
  }

  if (pendingAuthReject) {
    pendingAuthReject(new Error('Auth request was replaced by a newer request.'));
    clearPendingAuth();
  }

  return new Promise((resolve, reject) => {
    pendingAuthResolve = resolve;
    pendingAuthReject = reject;

    authReplyTimer = setTimeout(() => {
      clearPendingAuth();
      reject(new Error('No auth response from architect. Reopen tool from authenticated session.'));
    }, 1800);

    try {
      window.parent.postMessage({ type: 'qa_exporter_auth_request' }, '*');
    } catch (err) {
      clearPendingAuth();
      reject(new Error('Failed to request auth context from architect.'));
    }
  });
}

async function getAuthContext(forceRefresh = false) {
  if (!forceRefresh && canUseCachedAuthContext()) {
    return { ...authContextCache };
  }

  const raw = await requestAuthContext();
  const normalized = normalizeAuthContext(raw);

  authContextCache.isAuth = normalized.isAuth;
  authContextCache.accessToken = normalized.accessToken;
  authContextCache.supabaseUrl = normalized.supabaseUrl;
  authContextCache.supabaseAnonKey = normalized.supabaseAnonKey;
  authContextCache.expiresAt = normalized.expiresAt;

  return normalized;
}

async function callEdgeValidation(payload, forceRefreshAuth = false) {
  const auth = await getAuthContext(forceRefreshAuth);
  const isAuth = Boolean(auth && auth.isAuth);
  const accessToken = auth && typeof auth.accessToken === 'string' ? auth.accessToken : '';
  const supabaseUrl = auth && typeof auth.supabaseUrl === 'string' && auth.supabaseUrl ? auth.supabaseUrl : DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = auth && typeof auth.supabaseAnonKey === 'string' && auth.supabaseAnonKey ? auth.supabaseAnonKey : DEFAULT_SUPABASE_ANON_KEY;

  if (!isAuth || !accessToken) {
    throw new Error('Authentication required: sign in to use server validation/export.');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/${EDGE_FUNCTION_NAME}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey
    },
    body: JSON.stringify({
      payload,
      options: {
        pretty: Boolean(state.options.pretty),
        includeDocs: Boolean(state.options.includeDocs),
        includeSourceInDebug: Boolean(state.options.includeSourceInDebug)
      }
    })
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  if (res.status === 401 && !forceRefreshAuth) {
    return callEdgeValidation(payload, true);
  }

  if (!res.ok) {
    if (res.status === 401) {
      const errText = data && data.error ? String(data.error) : '';
      throw new Error(errText ? `${EDGE_401_HINT} Server: ${errText}` : EDGE_401_HINT);
    }
    const msg = data && data.error ? String(data.error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (!data || data.ok !== true) {
    throw new Error(data && data.error ? String(data.error) : 'Invalid server response');
  }

  return data;
}

function applyServerResult(data) {
  state.summary = data && typeof data.summary === 'object'
    ? {
        critical: Number(data.summary.critical) || 0,
        warning: Number(data.summary.warning) || 0,
        runtime: Number(data.summary.runtime) || 0,
        unreachable: Number(data.summary.unreachable) || 0
      }
    : { critical: 0, warning: 0, runtime: 0, unreachable: 0 };

  state.issues = Array.isArray(data && data.issues) ? data.issues : [];
  state.diagnostics = Array.isArray(data && data.diagnostics) ? data.diagnostics : [];

  const ex = data && typeof data.exports === 'object' ? data.exports : {};
  state.exports = {
    runtime: typeof ex.runtime === 'string' ? ex.runtime : '',
    dataAsset: typeof ex.dataAsset === 'string' ? ex.dataAsset : '',
    unity: typeof ex.unity === 'string' ? ex.unity : '',
    debug: typeof ex.debug === 'string' ? ex.debug : ''
  };

  state.selectedIssueIndex = -1;
  state.hasValidationResult = true;
}

function resetValidationState() {
  state.issues = [];
  state.diagnostics = [];
  state.summary = { critical: 0, warning: 0, runtime: 0, unreachable: 0 };
  state.exports = { runtime: '', dataAsset: '', unity: '', debug: '' };
  state.selectedIssueIndex = -1;
  state.hasValidationResult = false;
}

async function validateOnServer() {
  if (!state.sourcePayload) {
    setStatus('No payload loaded yet.', 'warn');
    return;
  }

  const seq = ++validateSequence;
  setStatus('Validating on server...');

  try {
    const data = await callEdgeValidation(state.sourcePayload);
    if (seq !== validateSequence) return;

    applyServerResult(data);
    renderAll();

    if (state.summary.critical > 0) {
      setStatus('Validation failed: critical issues', 'critical');
    } else if (state.summary.warning > 0) {
      setStatus('Validation has warnings', 'warn');
    } else {
      setStatus('Validation passed', 'ok');
    }
  } catch (err) {
    if (seq !== validateSequence) return;
    const message = err && err.message ? err.message : 'Server validation failed';
    setStatus(message, 'critical');
  }
}

function renderSummary() {
  els.countCritical.textContent = String(state.summary.critical);
  els.countWarning.textContent = String(state.summary.warning);
  els.countRuntime.textContent = String(state.summary.runtime);
  els.countUnreachable.textContent = String(state.summary.unreachable);
  els.issueCount.textContent = String(state.issues.length);
}

function renderSource() {
  if (!state.projectMeta) {
    els.sourceMeta.textContent = 'No payload loaded yet.';
    return;
  }
  const title = state.projectMeta.title ? ('"' + state.projectMeta.title + '"') : '(untitled)';
  const updated = state.sourceTimestamp ? new Date(state.sourceTimestamp).toLocaleString() : 'n/a';
  els.sourceMeta.innerHTML = '<div><strong>Source:</strong> ' + state.sourceLabel + '</div><div><strong>Project:</strong> ' + title + '</div><div><strong>Nodes:</strong> ' + state.projectMeta.nodes + ' | <strong>Connections:</strong> ' + state.projectMeta.connections + '</div><div><strong>Updated:</strong> ' + updated + '</div>';
}

function renderIssues() {
  els.issueList.innerHTML = '';

  if (!state.issues.length) {
    const empty = document.createElement('div');
    empty.className = 'placeholder';
    empty.textContent = state.hasValidationResult
      ? 'No validation issues. Graph passed all implemented checks.'
      : 'Validation has not run yet. Click "Rebuild Exports".';
    els.issueList.appendChild(empty);
    return;
  }

  state.issues.forEach((it, i) => {
    const level = String(it && it.level ? it.level : 'info');
    const code = String(it && it.code ? it.code : 'unknown_code');
    const message = humanizeIssueMessage(it);
    const nodeId = it && it.nodeId ? String(it.nodeId) : '';
    const nodeRef = getReadableNodeRef(it);

    const row = document.createElement('div');
    row.className = 'issue ' + level + (i === state.selectedIssueIndex ? ' active' : '');
    row.dataset.issueIndex = String(i);

    const left = document.createElement('div');
    left.className = 'issueText';

    const t = document.createElement('div');
    t.className = 'issueTitle';
    t.textContent = message;

    const m = document.createElement('div');
    m.className = 'issueMeta';
    m.textContent = '[ ' + level.toUpperCase() + ' ] ' + code + (nodeRef ? ' | node: ' + nodeRef : '');

    left.appendChild(t);
    left.appendChild(m);
    row.appendChild(left);

    if (nodeId) {
      const b = document.createElement('button');
      b.className = 'miniBtn';
      b.type = 'button';
      b.textContent = 'Jump';
      b.dataset.jumpNodeId = nodeId;
      row.appendChild(b);
    }

    els.issueList.appendChild(row);
  });
}

function renderDiagnostics() {
  els.diagGrid.innerHTML = '';

  if (!state.diagnostics.length) {
    const p = document.createElement('div');
    p.className = 'placeholder';
    p.textContent = 'Diagnostics will appear after payload validation.';
    els.diagGrid.appendChild(p);
    return;
  }

  for (const d of state.diagnostics) {
    const card = document.createElement('div');
    card.className = 'diagCard';
    const name = d && d.name ? String(d.name) : 'Metric';
    const value = d && d.value != null ? String(d.value) : '-';
    const note = d && d.note ? String(d.note) : '';
    card.innerHTML = '<div class="diagName">' + name + '</div><div class="diagValue">' + value + '</div><div class="diagNote">' + note + '</div>';
    els.diagGrid.appendChild(card);
  }
}

function renderOutputs() {
  els.runtimeOutput.value = state.exports.runtime || '';
  els.dataAssetOutput.value = state.exports.dataAsset || '';
  els.unityOutput.value = state.exports.unity || '';
  els.debugOutput.value = state.exports.debug || '';
}

function renderAll() {
  renderSource();
  renderSummary();
  renderIssues();
  renderDiagnostics();
  renderOutputs();
}

function updateProject(payload, sourceLabel) {
  state.sourcePayload = cloneJson(payload);
  state.sourceLookup = buildSourceLookup(state.sourcePayload);
  state.sourceLabel = sourceLabel || 'unknown';
  state.sourceTimestamp = Date.now();
  state.projectMeta = getProjectMeta(payload);
  resetValidationState();
  renderAll();
  setStatus('Payload loaded. Click "Rebuild Exports" to run server validation.');
}

function requestFromParent() {
  if (!window.parent || window.parent === window) {
    setStatus('Standalone mode: no parent architect detected', 'warn');
    return;
  }

  setStatus('Requesting payload from architect...');
  window.parent.postMessage({ type: 'qa_exporter_request' }, '*');

  if (requestReplyTimer) clearTimeout(requestReplyTimer);
  requestReplyTimer = setTimeout(() => {
    if (state.sourcePayload) return;
    setStatus('No response from architect. Click Request again or hard-reload architect.', 'warn');
  }, 1800);
}

function sendJump(nodeId) {
  if (!nodeId || !window.parent || window.parent === window) return;
  window.parent.postMessage({ type: 'qa_exporter_jump', nodeId }, '*');
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tabBtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tabPanel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
}

function rebuild() {
  if (!state.sourcePayload) {
    setStatus('No payload to rebuild', 'warn');
    return;
  }
  validateOnServer();
}

function loadSample() {
  const sample = {
    version: 1,
    title: 'Sample Quest',
    nodes: [
      { id: 'start', type: 'start', x: 120, y: 120, data: {} },
      { id: 'd1', type: 'dialog', x: 360, y: 100, data: { title: 'Greeting', text: 'Hello traveler', choices: [{ text: 'Accept' }, { text: 'Refuse' }] } },
      { id: 'a1', type: 'action', x: 620, y: 70, data: { title: 'Reward', ops: [{ id: 'op_1', varId: 'v_gold', op: 'add', val: 10 }] } },
      { id: 'ls1', type: 'link_state', x: 620, y: 220, data: { title: 'JumpToEnd', entryId: 'le1', entryName: 'EndPath' } },
      { id: 'le1', type: 'link_entry', x: 900, y: 210, data: { name: 'EndPath', title: 'EndPath' } },
      { id: 'd2', type: 'dialog', x: 1130, y: 210, data: { title: 'Ending', text: 'Quest complete', choices: [{ text: 'Finish' }] } }
    ],
    connections: [
      { id: 'c1', from: 'start', fromSocket: 'default', to: 'd1', toSocket: 'in' },
      { id: 'c2', from: 'd1', fromSocket: 'choice-0', to: 'a1', toSocket: 'in' },
      { id: 'c3', from: 'd1', fromSocket: 'choice-1', to: 'ls1', toSocket: 'in' },
      { id: 'c4', from: 'a1', fromSocket: 'default', to: 'le1', toSocket: 'in' },
      { id: 'c5', from: 'le1', fromSocket: 'default', to: 'd2', toSocket: 'in' }
    ],
    variables: [{ id: 'v_gold', name: 'Gold', type: 'num', init: 0 }],
    characters: [{ id: 'npc_1', name: 'Quest Giver' }]
  };
  updateProject(sample, 'sample');
}

function copyCurrent() {
  const content = state.activeTab === 'diagnostics'
    ? JSON.stringify({ summary: state.summary, issues: state.issues }, null, state.options.pretty ? 2 : 0)
    : (state.exports[state.activeTab] || '');

  if (!content) {
    setStatus('Nothing to copy', 'warn');
    return;
  }

  navigator.clipboard.writeText(content)
    .then(() => setStatus('Copied to clipboard', 'ok'))
    .catch(() => setStatus('Copy failed', 'warn'));
}

function downloadCurrent() {
  const content = state.activeTab === 'diagnostics'
    ? JSON.stringify({ summary: state.summary, issues: state.issues }, null, state.options.pretty ? 2 : 0)
    : (state.exports[state.activeTab] || '');

  if (!content) {
    setStatus('Nothing to download', 'warn');
    return;
  }

  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.activeTab === 'diagnostics' ? 'quest_diagnostics.json' : (TAB_FILE_NAMES[state.activeTab] || 'quest_export.json');
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('btnRequest').addEventListener('click', requestFromParent);
document.getElementById('btnFile').addEventListener('click', () => els.fileInput.click());
document.getElementById('btnParse').addEventListener('click', () => {
  const raw = els.pasteInput.value.trim();
  if (!raw) {
    setStatus('Paste JSON first', 'warn');
    return;
  }

  try {
    updateProject(JSON.parse(raw), 'pasted');
  } catch (err) {
    setStatus('Invalid pasted JSON', 'critical');
    alert('Invalid JSON: ' + err.message);
  }
});

document.getElementById('btnSample').addEventListener('click', loadSample);
document.getElementById('btnRefresh').addEventListener('click', rebuild);
document.getElementById('btnCopy').addEventListener('click', copyCurrent);
document.getElementById('btnDownload').addEventListener('click', downloadCurrent);
document.getElementById('btnJumpStart').addEventListener('click', () => {
  if (!state.sourcePayload) {
    setStatus('No payload loaded yet', 'warn');
    return;
  }

  const nodes = Array.isArray(state.sourcePayload.nodes) ? state.sourcePayload.nodes : [];
  const start = nodes.find((n) => n && n.type === 'start');
  if (!start || !start.id) {
    setStatus('Start node not found', 'warn');
    return;
  }

  sendJump(String(start.id));
});

els.fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      updateProject(JSON.parse(String(r.result || '{}')), 'file:' + f.name);
    } catch (err) {
      setStatus('Invalid JSON file', 'critical');
      alert('Invalid JSON file: ' + err.message);
    }
  };
  r.readAsText(f);
  e.target.value = '';
});

els.optPretty.addEventListener('change', () => {
  state.options.pretty = Boolean(els.optPretty.checked);
  setStatus('Export option changed. Click "Rebuild Exports" to apply.');
});
els.optIncludeDocs.addEventListener('change', () => {
  state.options.includeDocs = Boolean(els.optIncludeDocs.checked);
  setStatus('Export option changed. Click "Rebuild Exports" to apply.');
});
els.optIncludeSource.addEventListener('change', () => {
  state.options.includeSourceInDebug = Boolean(els.optIncludeSource.checked);
  setStatus('Export option changed. Click "Rebuild Exports" to apply.');
});

document.querySelectorAll('.tabBtn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

els.issueList.addEventListener('click', (e) => {
  const jumpBtn = e.target.closest('[data-jump-node-id]');
  if (jumpBtn) {
    sendJump(jumpBtn.dataset.jumpNodeId);
    return;
  }

  const issueEl = e.target.closest('.issue');
  if (!issueEl) return;
  const index = Number(issueEl.dataset.issueIndex);
  if (!Number.isInteger(index)) return;
  state.selectedIssueIndex = index;
  renderIssues();
});

window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'qa_exporter_payload') {
    if (requestReplyTimer) {
      clearTimeout(requestReplyTimer);
      requestReplyTimer = null;
    }
    updateProject(data.payload, 'architect');
    return;
  }

  if (data.type === 'qa_exporter_auth') {
    const normalized = normalizeAuthContext(data);
    authContextCache.isAuth = normalized.isAuth;
    authContextCache.accessToken = normalized.accessToken;
    authContextCache.supabaseUrl = normalized.supabaseUrl;
    authContextCache.supabaseAnonKey = normalized.supabaseAnonKey;
    authContextCache.expiresAt = normalized.expiresAt;

    if (pendingAuthResolve) {
      const resolve = pendingAuthResolve;
      clearPendingAuth();
      resolve(normalized);
    }
    return;
  }
});

setTab('diagnostics');
requestFromParent();
