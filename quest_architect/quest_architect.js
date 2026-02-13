const SUPABASE_URL = 'https://vmwwvwtsznxwoswzdzui.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hfVfEOEyUxTAl9TCGQLQdA_2qpquHGk';

const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;

createApp({
    setup() {
        // --- STATE ---
        const nodes = ref([]);
        const connections = ref([]); // { id, from, fromSocket, to, toSocket }
        const variables = ref([]);
        const characters = ref([]);
        const nodeClipboard = ref(null);
        const currentProjectTitle = ref('');

        const isAuth = ref(false);
        const supabase = ref(null);
        const cloud = reactive({
            show: false,
            mode: 'load',
            list: [],
            loading: false,
            saveTitle: 'New Project',
            currentId: null
        });
        const exporterAuthCache = reactive({
            accessToken: null,
            expiresAt: 0
        });

        const clearExporterAuthCache = () => {
            exporterAuthCache.accessToken = null;
            exporterAuthCache.expiresAt = 0;
        };

        const parseJwtExpMs = (token) => {
            if (!token || typeof token !== 'string') return 0;
            try {
                const parts = token.split('.');
                if (parts.length < 2) return 0;
                let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                while (b64.length % 4 !== 0) b64 += '=';
                const payload = JSON.parse(atob(b64));
                const exp = Number(payload?.exp) || 0;
                return exp > 0 ? exp * 1000 : 0;
            } catch (err) {
                return 0;
            }
        };

        const getExporterAccessToken = async () => {
            const now = Date.now();
            const marginMs = 30 * 1000;
            if (exporterAuthCache.accessToken && exporterAuthCache.expiresAt > now + marginMs) {
                return exporterAuthCache.accessToken;
            }

            if (!isAuth.value) return null;
            if (!supabase.value) initSupabaseAuto();
            if (!supabase.value) return null;

            const { data: authData } = await supabase.value.auth.getSession();
            const token = authData?.session?.access_token || null;
            const expMs = parseJwtExpMs(token);

            exporterAuthCache.accessToken = token;
            exporterAuthCache.expiresAt = expMs;
            return token;
        };

        const syncAuthFromSession = () => {
            const sessionAuth = sessionStorage.getItem('ct_supabase_auth') === 'true';
            if (isAuth.value !== sessionAuth) {
                isAuth.value = sessionAuth;
                if (isAuth.value && !supabase.value) initSupabaseAuto();
                if (!isAuth.value) {
                    cloud.show = false;
                    clearExporterAuthCache();
                }
            }
        };

        const onAuthMessage = (e) => {
            if (!e?.data || e.data.type !== 'ct_auth') return;
            isAuth.value = !!e.data.isAuth;
            if (isAuth.value && !supabase.value) initSupabaseAuto();
            if (!isAuth.value) {
                cloud.show = false;
                clearExporterAuthCache();
            }
        };

        const notifyAuthRequired = (key = 'auth') => {
            authHintKey.value = key;
            if (authHintTimer) clearTimeout(authHintTimer);
            authHintTimer = setTimeout(() => {
                authHintKey.value = null;
                authHintTimer = null;
            }, 1800);
        };

        const onExporterMessage = (e) => {
            const data = e?.data;
            if (!data || typeof data !== 'object') return;

            if (data.type === 'qa_exporter_auth_request') {
                const replyAuth = async () => {
                    let accessToken = null;
                    if (isAuth.value) {
                        try {
                            accessToken = await getExporterAccessToken();
                        } catch (err) {
                            console.error('Exporter auth reply failed', err);
                        }
                    }
                    try {
                        e.source?.postMessage(
                            {
                                type: 'qa_exporter_auth',
                                isAuth: Boolean(isAuth.value),
                                accessToken,
                                supabaseUrl: SUPABASE_URL,
                                supabaseAnonKey: SUPABASE_KEY
                            },
                            '*'
                        );
                    } catch (err) {
                        console.error('Exporter auth post failed', err);
                    }
                };
                replyAuth();
                return;
            }

            if (data.type === 'qa_exporter_request') {
                try {
                    const payload = buildSerializableProjectPayload();
                    e.source?.postMessage(
                        {
                            type: 'qa_exporter_payload',
                            payload
                        },
                        '*'
                    );
                } catch (err) {
                    console.error('Exporter payload post failed', err);
                }
                return;
            }

            if (data.type === 'qa_exporter_jump') {
                const nodeId = typeof data.nodeId === 'string' ? data.nodeId.trim() : '';
                if (!nodeId) return;
                jumpToNode(nodeId, true);
                exportPanelOpen.value = false;
                exportValidatorDocsOpen.value = false;
            }
        };

        // Viewport
        const pan = reactive({ x: 0, y: 0 });
        const scale = ref(1);
        
        // Interaction State
        const draggingNode = ref(null); // { node, startX, startY }
        const resizingGroup = ref(null); // { nodeId, edge, startMouseX, startMouseY, startX, startY, startWidth, startHeight }
        const dragLine = ref(null); // { fromNode, fromSocket, path }
        const isPanning = ref(false);
        const lastMouse = reactive({ x: 0, y: 0 });
        const lastWorldMouse = reactive({ x: 0, y: 0, valid: false });
        
        // Selection
        const selectedNodeId = ref(null);
        const selectedNodeIds = ref([]);
        const selectedConnId = ref(null);
        
        // UI & Logic
        const tab = ref('props');
        const isPlayMode = ref(false);
        // Runtime
        const gameLog = ref([]);
        const activeNode = ref(null);
        const gameFinished = ref(false);
        const runtimeVars = ref({});
        const gameLogRef = ref(null);

        const AUTOSAVE_STORAGE_KEY = 'quest_architect_autosave_v1';

        const selectionBox = reactive({
            active: false,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            startX: 0,
            startY: 0,
            startWorldX: 0,
            startWorldY: 0,
            shift: false,
            baseIds: []
        });
        const createKey = ref(null);
        const editingNodeNameId = ref(null);
        const nodeNameDraft = ref('');
        const helpPanelOpen = ref(false);
        const hotkeysPanelOpen = ref(false);
        const exportPanelOpen = ref(false);
        const exportValidatorDocsOpen = ref(false);
        const authHintKey = ref(null);
        let authHintTimer = null;
        const hierarchySearch = reactive({
            query: '',
            warningsOnly: false,
            include: {
                start: true,
                dialog: true,
                action: true,
                condition: true,
                switcher: true,
                link_state: true,
                link_entry: true,
                quest_end: true,
                comment: true,
                group: true
            }
        });
        const autosave = reactive({
            lastSavedAt: 0,
            lastRestoredAt: 0,
            status: 'idle'
        });
        let autosaveTimer = null;
        let pathUpdateRaf = null;
        let mouseMoveRaf = null;
        const pendingPathNodeIds = new Set();
        let pendingPathFullUpdate = false;
        const pendingMouseMove = { has: false, clientX: 0, clientY: 0 };
        const nodeElementCache = new Map();
        const socketElementCache = new Map();
        const nodeHitSizeCache = new Map();
        const autosaveLocked = ref(false);

        const GROUP_DEFAULT_COLOR = '#94a3b8';
        const groupColorPalette = Object.freeze([
            '#94a3b8',
            '#7dd3fc',
            '#38bdf8',
            '#60a5fa',
            '#34d399',
            '#f59e0b',
            '#f97316',
            '#f43f5e',
            '#a78bfa',
            '#94a3b8'
        ]);

        const helpSections = Object.freeze([
            {
                id: 'editing',
                title: 'Editing Basics',
                lines: [
                    'Drag nodes by header. `Shift+Click` toggles selection. `Shift+Drag` creates box selection.',
                    '`Alt+Drag` duplicates selected node/group. `Del/Backspace` removes selected nodes.',
                    'Drag from output sockets to create links. `Alt+Click` on a line removes that connection.',
                    'Press `G` with selected nodes to wrap them into one **Group** by bounds.',
                    'Hold `G` and click empty canvas to spawn a new **Group** at cursor.'
                ]
            },
            {
                id: 'linking',
                title: 'Link State / Link Entry',
                lines: [
                    '**Link State** has input only and jumps to selected **Link Entry**.',
                    'Use dropdown, eyedropper, or direct node click while picker is active to select target.',
                    'Use `Jump` button to focus selected **Link Entry** on canvas.',
                    '**Link Entry** name is editable in header and used by **Link State** selectors.'
                ]
            },
            {
                id: 'docs',
                title: 'Documentation Nodes',
                lines: [
                    '**Comment** nodes store plain notes and are excluded from runtime flow.',
                    '**Group** nodes create tinted glass regions with editable title on top edge.',
                    '`Group resize` supports edges and corners. **Group** has no runtime behavior.',
                    'Use **Group** title as section comment for intent, ownership, TODOs, and design decisions.'
                ]
            },
            {
                id: 'hierarchy',
                title: 'Hierarchy Search & Filters',
                lines: [
                    'Search matches node names and internal content: dialog text, choices, action values, notes.',
                    'Search uses `token contains` matching (substrings), not strict exact phrase.',
                    '`Type chips` hide/show categories. `Warnings filter` focuses nodes with validation issues.',
                    'Click hierarchy rows or warning items to jump camera to related node.'
                ]
            },
            {
                id: 'safety',
                title: 'Safety & Persistence',
                lines: [
                    'Session `Autosave` stores data to local browser storage after graph changes.',
                    'After crash/reload the latest autosave is restored automatically.',
                    '`Warnings panel` highlights duplicate names, broken links, missing branches, unreachable flow.',
                    '**Link Entry** referenced by **Link State** chain is treated as reachable in warnings analysis.'
                ]
            },
            {
                id: 'workflow',
                title: 'Recommended Workflow',
                lines: [
                    '1) Start from **Start** node and rough branches with **Dialog/Condition/Switch**.',
                    '2) Add **Action** nodes for variable updates and check values in **Condition**.',
                    '3) Use **Wait Event/Wait Condition** for long-running quest checkpoints.',
                    '4) Track progress with **Objective Set/Complete/Fail** nodes.',
                    '5) Use **Link Entry** as reusable destination and **Link State** as jump.',
                    '6) Add **Group/Comment** for documentation, then validate warnings and run scenario.'
                ]
            }
        ]);

        const nodeDocs = Object.freeze([
            {
                type: 'start',
                label: 'Start',
                io: '`In: none` | `Out: default`',
                role: 'Entry point of runtime traversal. Exactly one flow should begin here.',
                usage: 'Connect **Start** -> first **Dialog/Action/Condition** node.'
            },
            {
                type: 'dialog',
                label: 'Dialog',
                io: '`In: one` | `Out: choice-1..N`',
                role: 'Represents NPC line and player choices.',
                usage: 'Set speaker, text, add replies; each reply creates a separate output branch.'
            },
            {
                type: 'action',
                label: 'Action',
                io: '`In: one` | `Out: default`',
                role: 'Mutates quest variables.',
                usage: 'Add operations (`set/add/sub/mul/div`). For `bool/string/enum` use assignment.'
            },
            {
                type: 'condition',
                label: 'Condition',
                io: '`In: one` | `Out: true / false`',
                role: 'Branches flow based on variable comparison.',
                usage: 'Pick variable, operator, value; connect both `true` and `false` outputs.'
            },
            {
                type: 'switcher',
                label: 'Switch',
                io: '`In: one` | `Out: case-1..N + default`',
                role: 'Routes by many discrete values.',
                usage: 'Add cases for expected values; use `default` for fallback branch.'
            },
            {
                type: 'wait_event',
                label: 'Wait Event',
                io: '`In: one` | `Out: default`',
                role: 'Pauses runtime until an external event key is triggered.',
                usage: 'Set event key (`quest.bandits_cleared`) and continue from default output.'
            },
            {
                type: 'wait_condition',
                label: 'Wait Condition',
                io: '`In: one` | `Out: default`',
                role: 'Pauses runtime until variable check becomes true.',
                usage: 'Pick variable/operator/value. Runtime resumes when condition is satisfied.'
            },
            {
                type: 'objective_set',
                label: 'Objective Set',
                io: '`In: one` | `Out: default`',
                role: 'Creates or updates objective text in journal/UI.',
                usage: 'Set objective id and objective text.'
            },
            {
                type: 'objective_complete',
                label: 'Objective Complete',
                io: '`In: one` | `Out: default`',
                role: 'Marks objective as completed.',
                usage: 'Use same objective id previously created by Objective Set.'
            },
            {
                type: 'objective_fail',
                label: 'Objective Fail',
                io: '`In: one` | `Out: default`',
                role: 'Marks objective as failed.',
                usage: 'Use objective id and optional reason text.'
            },
            {
                type: 'quest_end',
                label: 'Quest End',
                io: '`In: one` | `Out: none`',
                role: 'Explicitly finalizes quest flow with result state.',
                usage: 'Use as terminal node with result `complete/fail/abort` to avoid ambiguous dead-ends.'
            },
            {
                type: 'link_entry',
                label: 'Link Entry',
                io: '`In: none` | `Out: default`',
                role: 'Named reusable entry destination in graph.',
                usage: 'Rename header to meaningful anchor name; connect output to continuation path.'
            },
            {
                type: 'link_state',
                label: 'Link State',
                io: '`In: one` | `Out: none`',
                role: 'Jump node that transfers runtime to selected Link Entry.',
                usage: 'Choose **Link Entry** via dropdown or eyedropper; use `Jump` to verify target.'
            },
            {
                type: 'comment',
                label: 'Comment',
                io: '`In: none` | `Out: none`',
                role: 'Pure documentation note node.',
                usage: 'Store design notes, TODOs, explanations; ignored by runtime.'
            },
            {
                type: 'group',
                label: 'Group',
                io: '`In: none` | `Out: none`',
                role: 'Visual container for structuring and documenting graph regions.',
                usage: 'Create from selection by `G` or spawn with `G+Click`. Resize by edges/corners, tint in properties.'
            }
        ]);

        const editableNodeTypes = new Set([
            'dialog',
            'action',
            'condition',
            'switcher',
            'wait_event',
            'wait_condition',
            'objective_set',
            'objective_complete',
            'objective_fail',
            'quest_end',
            'link_entry',
            'comment',
            'group'
        ]);
        const docNodeTypes = new Set(['comment', 'group']);
        const nonConnectableTargetTypes = new Set(['start', 'link_entry', 'comment', 'group']);

        const nodeTypeLabels = Object.freeze({
            start: 'Start',
            dialog: 'Dialog',
            action: 'Action',
            condition: 'Condition',
            switcher: 'Switch',
            wait_event: 'Wait Event',
            wait_condition: 'Wait Condition',
            objective_set: 'Objective Set',
            objective_complete: 'Objective Complete',
            objective_fail: 'Objective Fail',
            quest_end: 'Quest End',
            link_state: 'Link State',
            link_entry: 'Link Entry',
            comment: 'Comment',
            group: 'Group'
        });
        const connectableNodeOptions = Object.freeze([
            { type: 'dialog', label: 'Dialog', desc: 'Line and choices for the player', icon: 'fa-solid fa-comment-dots', tone: 'dialog' },
            { type: 'action', label: 'Action', desc: 'Mutate quest variables', icon: 'fa-solid fa-bolt', tone: 'action' },
            { type: 'condition', label: 'Condition', desc: 'Branch by variable check', icon: 'fa-solid fa-code-branch', tone: 'condition' },
            { type: 'switcher', label: 'Switcher', desc: 'Route by cases and default', icon: 'fa-solid fa-shuffle', tone: 'switcher' },
            { type: 'wait_event', label: 'Wait Event', desc: 'Pause until runtime event key', icon: 'fa-solid fa-hourglass-half', tone: 'wait' },
            { type: 'wait_condition', label: 'Wait Condition', desc: 'Pause until condition is true', icon: 'fa-solid fa-stopwatch', tone: 'wait' },
            { type: 'objective_set', label: 'Objective Set', desc: 'Create/update quest objective', icon: 'fa-solid fa-list-check', tone: 'objective' },
            { type: 'objective_complete', label: 'Objective Complete', desc: 'Mark objective complete', icon: 'fa-solid fa-circle-check', tone: 'objective' },
            { type: 'objective_fail', label: 'Objective Fail', desc: 'Mark objective failed', icon: 'fa-solid fa-circle-xmark', tone: 'objective' },
            { type: 'quest_end', label: 'Quest End', desc: 'Finalize quest with explicit result', icon: 'fa-solid fa-flag-checkered', tone: 'ending' },
            { type: 'link_state', label: 'Link State', desc: 'Jump to selected Link Entry', icon: 'fa-solid fa-link', tone: 'link' }
        ]);
        const nodeConnectMenu = reactive({
            visible: false,
            x: 0,
            y: 0,
            worldX: 0,
            worldY: 0,
            fromNodeId: null,
            fromSocketId: null
        });
        const nodeConnectMenuEl = ref(null);
        const nodeConnectMenuTitle = computed(() =>
            (nodeConnectMenu.fromNodeId && nodeConnectMenu.fromSocketId)
                ? 'Create and connect'
                : 'Create node'
        );

        const canvasContainer = ref(null);
        const loadInput = ref(null);

        // --- HELPERS: Coordinates ---
        // Convert screen coordinates to world coordinates
        const toWorld = (sx, sy) => {
            if (!canvasContainer.value) return { x: 0, y: 0 };
            const rect = canvasContainer.value.getBoundingClientRect();
            return {
                x: (sx - rect.left - pan.x) / scale.value,
                y: (sy - rect.top - pan.y) / scale.value
            };
        };

        const toLocal = (sx, sy) => {
            if (!canvasContainer.value) return { x: 0, y: 0 };
            const rect = canvasContainer.value.getBoundingClientRect();
            return { x: sx - rect.left, y: sy - rect.top };
        };

        const escapeHtml = (value) => String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const formatDocText = (value) => {
            const safe = escapeHtml(value);
            return safe
                .replace(/\*\*([^*]+)\*\*/g, '<span class="doc-key">$1</span>')
                .replace(/`([^`]+)`/g, '<span class="doc-kbd">$1</span>');
        };

        const queueFrame = (fn) => window.requestAnimationFrame(fn);
        const cancelFrame = (handle) => window.cancelAnimationFrame(handle);

        const clearDomCaches = () => {
            nodeElementCache.clear();
            socketElementCache.clear();
            nodeHitSizeCache.clear();
        };

        const getNodeElement = (nodeId) => {
            if (!canvasContainer.value) return null;
            const cached = nodeElementCache.get(nodeId);
            if (cached && cached.isConnected) return cached;
            const el = canvasContainer.value.querySelector(`.node-wrapper[data-node-id="${nodeId}"]`);
            if (el) nodeElementCache.set(nodeId, el);
            else nodeElementCache.delete(nodeId);
            return el;
        };

        const getSocketElement = (nodeId, socketType) => {
            if (!canvasContainer.value) return null;
            const key = `${nodeId}:${socketType}`;
            const cached = socketElementCache.get(key);
            if (cached && cached.isConnected) return cached;
            const el = canvasContainer.value.querySelector(`[data-node-id="${nodeId}"][data-socket-id="${socketType}"]`);
            if (el) socketElementCache.set(key, el);
            else socketElementCache.delete(key);
            return el;
        };

        const getNodeTypeLabel = (type) => nodeTypeLabels[type] || String(type || 'Node');
        const isDocNodeType = (type) => docNodeTypes.has(type);
        const canConnectToNode = (node) => !!node && !nonConnectableTargetTypes.has(node.type);
        const canHaveInputSocket = (node) => canConnectToNode(node);
        const clampGroupWidth = (v) => Math.max(220, Math.min(2200, Number(v) || 360));
        const clampGroupHeight = (v) => Math.max(120, Math.min(1800, Number(v) || 190));
        const normalizeGroupColor = (value) => {
            const clean = String(value == null ? '' : value).trim();
            return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean.toLowerCase() : GROUP_DEFAULT_COLOR;
        };
        const hexToRgb = (hex) => {
            const clean = normalizeGroupColor(hex);
            return {
                r: parseInt(clean.slice(1, 3), 16),
                g: parseInt(clean.slice(3, 5), 16),
                b: parseInt(clean.slice(5, 7), 16)
            };
        };
        const rgbaFromHex = (hex, alpha) => {
            const rgb = hexToRgb(hex);
            const a = Math.max(0, Math.min(1, Number(alpha) || 0));
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
        };
        const setGroupColor = (node, color) => {
            if (!node || node.type !== 'group' || !node.data) return;
            node.data.color = normalizeGroupColor(color);
        };
        const getNodeHeaderStyle = (node) => {
            if (!node || node.type !== 'group') return null;
            const currentScale = Math.max(0.2, Math.min(3, Number(scale.value) || 1));
            if (currentScale >= 0.9) return null;
            const lift = Math.min(72, Math.max(0, (1 / currentScale - 1) * 32));
            return {
                transform: `translateY(-${lift}px)`,
                position: 'relative',
                zIndex: 11
            };
        };
        const getNodeHeaderContentStyle = (node) => {
            if (!node || node.type !== 'group' || !node.data?.zoomTitleLock) return null;
            const currentScale = Math.max(0.2, Math.min(3, Number(scale.value) || 1));
            const factor = Math.max(1, Math.min(5, 1 / currentScale));
            return {
                transformOrigin: 'left center',
                transform: `scale(${factor})`
            };
        };

        const getNodeStyle = (node) => {
            const style = {
                transform: `translate(${node.x}px, ${node.y}px)`
            };
            const normalizedType = node?.type === 'frame' ? 'group' : node?.type;
            if (node && normalizedType === 'group') {
                const width = clampGroupWidth(node.data?.width);
                const height = clampGroupHeight(node.data?.height);
                const color = normalizeGroupColor(node.data?.color);
                style.width = `${width}px`;
                style.minHeight = `${height}px`;
                style['--group-highlight-tint'] = rgbaFromHex(color, 0.045);
                style['--group-border'] = rgbaFromHex(color, 0.4);
                style['--group-border-strong'] = rgbaFromHex(color, 0.66);
            }
            return style;
        };

        const getNodeIcon = (type) => {
            const map = {
                start: 'fa-play',
                dialog: 'fa-comment',
                action: 'fa-bolt',
                condition: 'fa-code-branch',
                switcher: 'fa-shuffle',
                wait_event: 'fa-hourglass-half',
                wait_condition: 'fa-stopwatch',
                objective_set: 'fa-list-check',
                objective_complete: 'fa-circle-check',
                objective_fail: 'fa-circle-xmark',
                quest_end: 'fa-flag-checkered',
                link_state: 'fa-link',
                link_entry: 'fa-right-to-bracket',
                comment: 'fa-note-sticky',
                group: 'fa-vector-square'
            };
            return 'fa-solid ' + (map[type] || 'fa-circle');
        };

        const isNodeNameEditable = (type) => editableNodeTypes.has(type);

        const getNodeDisplayName = (node) => {
            if (!node) return 'Node';
            const fallback = getNodeTypeLabel(node.type);
            if (!node.data || typeof node.data !== 'object') return fallback;
            if (node.type === 'link_entry') {
                const value = (node.data.title != null ? node.data.title : node.data.name);
                const clean = value == null ? '' : String(value).trim();
                return clean || fallback;
            }
            const clean = node.data.title == null ? '' : String(node.data.title).trim();
            return clean || fallback;
        };

        const getHierarchyNodeName = (node) => {
            if (!node) return 'Missing node';
            if (node.type === 'start') return 'Start';
            if (isNodeNameEditable(node.type) || node.type === 'link_state') return getNodeDisplayName(node);
            return getNodeTypeLabel(node.type);
        };

        const getHierarchyNodeMeta = (node, kind = 'node') => {
            if (!node) return kind === 'node' ? '' : kind;
            let meta = '';
            if (node.type === 'link_state') {
                const target = getLinkEntryForState(node);
                meta = target ? `-> ${getNodeDisplayName(target)}` : 'target missing';
            }
            if (kind === 'cycle') {
                meta = meta ? `${meta} | cycle` : 'cycle';
            }
            if (kind === 'ref') {
                meta = meta ? `${meta} | ref` : 'ref';
            }
            return meta;
        };

        const getHierarchyTone = (type) => {
            if (nodeTypeLabels[type]) return type;
            return 'unknown';
        };

        const getNodeWorldBounds = (node) => {
            if (!node) return null;
            if (canvasContainer.value) {
                const el = getNodeElement(node.id);
                if (el) {
                    const r = el.getBoundingClientRect();
                    const p1 = toWorld(r.left, r.top);
                    const p2 = toWorld(r.right, r.bottom);
                    return {
                        x: p1.x,
                        y: p1.y,
                        width: Math.max(10, p2.x - p1.x),
                        height: Math.max(10, p2.y - p1.y)
                    };
                }
            }

            if (node.type === 'group' || node.type === 'frame') {
                return {
                    x: node.x,
                    y: node.y,
                    width: clampGroupWidth(node.data?.width),
                    height: clampGroupHeight(node.data?.height)
                };
            }
            return { x: node.x, y: node.y, width: 300, height: 170 };
        };

        const getNodeHitSizeFallback = (node) => {
            if (!node) return { width: 300, height: 170 };
            if (node.type === 'group' || node.type === 'frame') {
                return {
                    width: clampGroupWidth(node.data?.width),
                    height: clampGroupHeight(node.data?.height)
                };
            }

            let height = 170;
            if (node.type === 'dialog') {
                const choiceCount = Array.isArray(node.data?.choices) ? node.data.choices.length : 0;
                height = Math.min(520, 165 + choiceCount * 36);
            } else if (node.type === 'action') {
                const opCount = Array.isArray(node.data?.ops) ? node.data.ops.length : 0;
                height = Math.min(560, 150 + Math.max(1, opCount) * 66);
            } else if (node.type === 'switcher') {
                const caseCount = Array.isArray(node.data?.cases) ? node.data.cases.length : 0;
                height = Math.min(540, 156 + Math.max(1, caseCount) * 44);
            } else if (node.type === 'condition' || node.type === 'wait_condition') {
                height = 180;
            } else if (node.type === 'comment') {
                const textLen = String(node.data?.text || '').length;
                height = Math.min(560, Math.max(160, 150 + Math.floor(textLen / 72) * 18));
            } else if (node.type === 'start') {
                height = 106;
            }
            return { width: 300, height };
        };

        const getNodeHitSize = (node) => {
            if (!node) return { width: 300, height: 170 };
            if (node.type === 'group' || node.type === 'frame') {
                return {
                    width: clampGroupWidth(node.data?.width),
                    height: clampGroupHeight(node.data?.height)
                };
            }

            const cached = nodeHitSizeCache.get(node.id);
            if (cached) return cached;

            const el = getNodeElement(node.id);
            if (el && el.isConnected) {
                const measured = {
                    width: Math.max(160, Math.ceil(el.offsetWidth || 300)),
                    height: Math.max(70, Math.ceil(el.offsetHeight || 170))
                };
                nodeHitSizeCache.set(node.id, measured);
                return measured;
            }

            const fallback = getNodeHitSizeFallback(node);
            nodeHitSizeCache.set(node.id, fallback);
            return fallback;
        };

        const refreshNodeHitSizeCache = () => {
            const alive = new Set(nodes.value.map((n) => n.id));
            Array.from(nodeHitSizeCache.keys()).forEach((id) => {
                if (!alive.has(id)) nodeHitSizeCache.delete(id);
            });

            nodes.value.forEach((node) => {
                if (!node || node.type === 'group' || node.type === 'frame') return;
                const el = getNodeElement(node.id);
                if (el && el.isConnected) {
                    nodeHitSizeCache.set(node.id, {
                        width: Math.max(160, Math.ceil(el.offsetWidth || 300)),
                        height: Math.max(70, Math.ceil(el.offsetHeight || 170))
                    });
                    return;
                }
                if (!nodeHitSizeCache.has(node.id)) {
                    nodeHitSizeCache.set(node.id, getNodeHitSizeFallback(node));
                }
            });
        };

        const getNodeHitBounds = (node) => {
            if (!node) return null;
            const size = getNodeHitSize(node);
            return {
                x: node.x,
                y: node.y,
                width: size.width,
                height: size.height
            };
        };

        const getGroupMemberNodes = (groupNode) => {
            if (!groupNode || groupNode.type !== 'group') return [];
            const g = getNodeWorldBounds(groupNode);
            if (!g) return [];
            const gx2 = g.x + g.width;
            const gy2 = g.y + g.height;
            return nodes.value.filter(n => {
                if (!n || n.id === groupNode.id || n.type === 'group') return false;
                const b = getNodeWorldBounds(n);
                if (!b) return false;
                const cx = b.x + b.width / 2;
                const cy = b.y + b.height / 2;
                return cx >= g.x && cx <= gx2 && cy >= g.y && cy <= gy2;
            });
        };

        const getGroupMemberCount = (groupNode) => getGroupMemberNodes(groupNode).length;

        const getNextGroupTitle = () => {
            const used = new Set(
                nodes.value
                    .filter(n => n.type === 'group')
                    .map(n => String(n.data?.title == null ? '' : n.data.title).trim().toLowerCase())
                    .filter(Boolean)
            );
            let i = 1;
            while (used.has(`group ${i}`)) i += 1;
            return `Group ${i}`;
        };

        const normalizeSearch = (value) => String(value == null ? '' : value)
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

        const tokenizeSearch = (value) => normalizeSearch(value)
            .split(' ')
            .map(s => s.trim())
            .filter(Boolean);

        const getNodeSearchText = (node) => {
            if (!node) return '';
            const parts = [
                node.id,
                node.type,
                getNodeDisplayName(node),
                node.data?.title,
                node.data?.name,
                node.data?.text,
                node.data?.note,
                node.data?.entryName
            ];

            if (node.type === 'dialog') {
                if (Array.isArray(node.data?.choices)) {
                    node.data.choices.forEach(c => parts.push(c?.text));
                }
                parts.push(getCharacterName(node.data?.speakerId));
            }
            if (node.type === 'action' && Array.isArray(node.data?.ops)) {
                node.data.ops.forEach(op => {
                    parts.push(getVarName(op?.varId));
                    parts.push(op?.op);
                    parts.push(op?.val);
                });
            }
            if (node.type === 'condition') {
                parts.push(getVarName(node.data?.varId));
                parts.push(node.data?.op);
                parts.push(node.data?.val);
            }
            if (node.type === 'switcher') {
                parts.push(getVarName(node.data?.varId));
                if (Array.isArray(node.data?.cases)) {
                    node.data.cases.forEach(c => parts.push(c?.value));
                }
            }
            if (node.type === 'wait_event') {
                parts.push(node.data?.eventKey);
                parts.push(node.data?.note);
            }
            if (node.type === 'wait_condition') {
                parts.push(getVarName(node.data?.varId));
                parts.push(node.data?.op);
                parts.push(node.data?.val);
            }
            if (node.type === 'objective_set') {
                parts.push(node.data?.objectiveId);
                parts.push(node.data?.objectiveText);
            }
            if (node.type === 'objective_complete' || node.type === 'objective_fail') {
                parts.push(node.data?.objectiveId);
                parts.push(node.data?.reason);
            }
            if (node.type === 'quest_end') {
                parts.push(node.data?.result);
                parts.push(node.data?.endingNote);
            }
            if (node.type === 'link_state') {
                const target = getLinkEntryForState(node);
                if (target) parts.push(getNodeDisplayName(target));
            }

            return normalizeSearch(parts.filter(Boolean).join(' '));
        };

        const hotkeyHints = computed(() => {
            const base = [
                { keys: 'C + Click', label: 'Create Condition node' },
                { keys: 'S + Click', label: 'Create Switcher node' },
                { keys: 'A + Click', label: 'Create Action node' },
                { keys: 'D + Click', label: 'Create Dialog node' },
                { keys: 'E + Click', label: 'Create Wait Event node' },
                { keys: 'W + Click', label: 'Create Wait Condition node' },
                { keys: 'O + Click', label: 'Create Objective Set node' },
                { keys: 'K + Click', label: 'Create Objective Complete node' },
                { keys: 'F + Click', label: 'Create Objective Fail node' },
                { keys: 'Q + Click', label: 'Create Quest End node' },
                { keys: 'G + Click', label: 'Create Group node' },
                { keys: 'Alt + Click line', label: 'Delete connection' },
                { keys: 'G', label: 'Group selected nodes' }
            ];
            const selection = selectedNodeIds.value.length;
            if (selection === 1) {
                return base.concat([
                    { keys: 'Alt + Drag', label: 'Duplicate node' },
                    { keys: 'Del/Backspace', label: 'Delete node' },
                    { keys: 'Ctrl/Cmd+C', label: 'Copy' },
                    { keys: 'Ctrl/Cmd+V', label: 'Paste' }
                ]);
            }
            if (selection > 1) {
                return base.concat([
                    { keys: 'Alt + Drag', label: 'Duplicate group' },
                    { keys: 'Del/Backspace', label: 'Delete group' },
                    { keys: 'Shift + Click', label: 'Toggle selection' }
                ]);
            }
            return base.concat([
                { keys: 'Shift + Drag', label: 'Box select (toggle)' },
                { keys: 'Shift + Click', label: 'Toggle selection' }
            ]);
        });

        const linkEntryOptions = computed(() => {
            return nodes.value
                .filter(n => n.type === 'link_entry')
                .map(n => {
                    const clean = normalizeEntryName(n.data?.name || n.data?.title);
                    return {
                        id: n.id,
                        name: clean || `Entry ${n.id.slice(-4)}`
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name));
        });

        const linkPicker = reactive({ active: false, sourceStateId: null });
        const hierarchyPanelOpen = ref(false);

        const getLinkEntryForState = (stateNode) => {
            if (!stateNode || stateNode.type !== 'link_state') return null;
            const byId = stateNode.data?.entryId
                ? nodes.value.find(n => n.id === stateNode.data.entryId && n.type === 'link_entry')
                : null;
            if (byId) return byId;

            // Backward compatibility: old projects referenced Link Entry by name.
            const oldName = normalizeEntryName(stateNode.data?.entryName);
            if (!oldName) return null;
            const byName = nodes.value.find(n => n.type === 'link_entry' && normalizeEntryName(n.data?.name || n.data?.title) === oldName);
            if (byName) {
                stateNode.data.entryId = byName.id;
                return byName;
            }
            return null;
        };

        const assignLinkEntryToState = (stateNode, entryNode) => {
            if (!stateNode || stateNode.type !== 'link_state') return;
            if (!entryNode || entryNode.type !== 'link_entry') {
                stateNode.data.entryId = null;
                stateNode.data.entryName = '';
                return;
            }
            stateNode.data.entryId = entryNode.id;
            stateNode.data.entryName = normalizeEntryName(entryNode.data?.name || entryNode.data?.title);
        };

        const onLinkStateTargetChange = (stateNode) => {
            const entry = stateNode && stateNode.type === 'link_state'
                ? nodes.value.find(n => n.id === stateNode.data?.entryId && n.type === 'link_entry')
                : null;
            if (!stateNode || stateNode.type !== 'link_state') return;
            if (!entry) {
                stateNode.data.entryId = null;
                stateNode.data.entryName = '';
                return;
            }
            stateNode.data.entryName = normalizeEntryName(entry.data?.name || entry.data?.title);
        };

        const onLinkEntryNameInput = (entryNode) => {
            if (!entryNode || entryNode.type !== 'link_entry') return;
            const rawName = normalizeEntryName(entryNode.data?.name);
            entryNode.data.name = rawName;
            entryNode.data.title = rawName;
            nodes.value.forEach(n => {
                if (n.type !== 'link_state') return;
                if (n.data?.entryId === entryNode.id) {
                    n.data.entryName = rawName;
                }
            });
            if (editingNodeNameId.value === entryNode.id) {
                nodeNameDraft.value = rawName;
            }
        };

        const onLinkEntryTitleInput = (entryNode) => {
            if (!entryNode || entryNode.type !== 'link_entry') return;
            const clean = normalizeEntryName(entryNode.data?.title);
            entryNode.data.title = clean;
            entryNode.data.name = clean;
            onLinkEntryNameInput(entryNode);
        };

        const startNodeNameEdit = (node) => {
            if (!node || !isNodeNameEditable(node.type)) return;
            nodeNameDraft.value = getNodeDisplayName(node);
            editingNodeNameId.value = node.id;
            nextTick(() => {
                const input = canvasContainer.value?.querySelector(`input[data-node-name-input="${node.id}"]`);
                if (!input) return;
                input.focus();
                input.select();
            });
        };

        const commitNodeNameEdit = (node) => {
            if (!node || editingNodeNameId.value !== node.id) return;
            const clean = String(nodeNameDraft.value == null ? '' : nodeNameDraft.value).trim();
            if (node.type === 'link_entry') {
                const nextName = clean || getNextLinkEntryName();
                node.data.name = nextName;
                onLinkEntryNameInput(node);
            } else {
                node.data.title = clean || getNodeTypeLabel(node.type);
            }
            editingNodeNameId.value = null;
            nodeNameDraft.value = '';
        };

        const cancelNodeNameEdit = () => {
            editingNodeNameId.value = null;
            nodeNameDraft.value = '';
        };

        const cancelLinkPicker = () => {
            linkPicker.active = false;
            linkPicker.sourceStateId = null;
        };

        const startLinkPicker = (stateNodeId) => {
            closeNodeConnectMenu();
            if (!stateNodeId) return;
            linkPicker.active = true;
            linkPicker.sourceStateId = stateNodeId;
        };

        const jumpToNode = (nodeId, shouldSelect = true) => {
            const node = nodes.value.find(n => n.id === nodeId);
            if (!node || !canvasContainer.value) return;

            const rect = canvasContainer.value.getBoundingClientRect();
            const jumpFocusScale = 0.96;
            const nextScale = Math.min(3, Math.max(0.2, jumpFocusScale));
            scale.value = nextScale;
            const targetX = node.x + 150;
            const targetY = node.y + 70;
            pan.x = rect.width / 2 - targetX * nextScale;
            pan.y = rect.height / 2 - targetY * nextScale;

            if (shouldSelect) {
                selectedNodeId.value = node.id;
                selectedNodeIds.value = [node.id];
                selectedConnId.value = null;
                tab.value = 'props';
            }

            triggerNodeJumpPulse(node.id);
        };

        const triggerNodeJumpPulse = (nodeId) => {
            if (!nodeId) return;
            queueFrame(() => {
                const nodeEl = getNodeElement(nodeId);
                if (!nodeEl) return;

                const existing = nodeEl.querySelector('.node-jump-pulse-overlay');
                if (existing) existing.remove();

                const overlay = document.createElement('span');
                overlay.className = 'node-jump-pulse-overlay';
                overlay.setAttribute('aria-hidden', 'true');
                nodeEl.appendChild(overlay);

                const cleanup = () => {
                    if (overlay.parentNode) overlay.remove();
                };
                overlay.addEventListener('animationend', cleanup, { once: true });
                setTimeout(cleanup, 2300);
            });
        };

        const jumpToLinkEntry = (stateNode) => {
            const entry = getLinkEntryForState(stateNode);
            if (!entry) return;
            jumpToNode(entry.id);
        };

        const getHierarchySocketText = (fromNode, socket, outIndex) => {
            if (!fromNode) return null;
            const raw = String(socket || 'default');

            if (fromNode.type === 'condition') {
                if (raw === 'true') return 'out_T';
                if (raw === 'false') return 'out_F';
                return `out_${outIndex + 1}`;
            }

            if (raw === 'default') return 'out';

            if (fromNode.type === 'dialog' && raw.startsWith('choice-')) {
                const idx = Number(raw.slice(7));
                return Number.isFinite(idx) ? `out_${idx + 1}` : `out_${outIndex + 1}`;
            }

            if (fromNode.type === 'switcher') return `out_${outIndex + 1}`;

            return `out_${outIndex + 1}`;
        };

        const hierarchyRows = computed(() => {
            const rows = [];
            const nodeMap = new Map(nodes.value.map(n => [n.id, n]));
            const outgoing = new Map();
            const incoming = new Map();

            connections.value.forEach(c => {
                if (!outgoing.has(c.from)) outgoing.set(c.from, []);
                outgoing.get(c.from).push(c);
                incoming.set(c.to, (incoming.get(c.to) || 0) + 1);
            });

            const visited = new Set();
            const rootIds = [];
            nodes.value.filter(n => n.type === 'start').forEach(n => rootIds.push(n.id));
            nodes.value.forEach(n => {
                if (n.type === 'start') return;
                if (!incoming.get(n.id)) rootIds.push(n.id);
            });

            const pushRow = (kind, node, depth, socket, key, guides) => {
                rows.push({
                    key,
                    nodeId: node ? node.id : null,
                    nodeType: node ? node.type : null,
                    depth,
                    guides: guides.slice(),
                    socket,
                    tone: node ? getHierarchyTone(node.type) : 'unknown',
                    name: getHierarchyNodeName(node),
                    meta: getHierarchyNodeMeta(node, kind),
                    searchText: node ? getNodeSearchText(node) : '',
                    kind
                });
            };

            const walk = (nodeId, depth, socket, stack, guides) => {
                const node = nodeMap.get(nodeId);
                if (!node) return;

                if (stack.has(nodeId)) {
                    pushRow('cycle', node, depth, socket, `cycle_${nodeId}_${depth}_${socket || ''}`, guides);
                    return;
                }

                if (visited.has(nodeId)) {
                    pushRow('ref', node, depth, socket, `ref_${nodeId}_${depth}_${socket || ''}`, guides);
                    return;
                }

                visited.add(nodeId);
                pushRow('node', node, depth, socket, `node_${nodeId}`, guides);

                const nextStack = new Set(stack);
                nextStack.add(nodeId);
                const next = (outgoing.get(nodeId) || []).slice().sort((a, b) => String(a.fromSocket || '').localeCompare(String(b.fromSocket || '')));
                next.forEach((conn, idx) => {
                    const childGuides = guides.slice();
                    childGuides.push(idx < next.length - 1);
                    const socketLabel = getHierarchySocketText(node, conn.fromSocket || 'default', idx);
                    walk(conn.to, depth + 1, socketLabel, nextStack, childGuides);
                });
            };

            rootIds.forEach(rootId => walk(rootId, 0, null, new Set(), []));
            nodes.value.forEach(n => {
                if (!visited.has(n.id)) walk(n.id, 0, null, new Set(), []);
            });

            return rows;
        });

        const graphWarnings = computed(() => {
            const warnings = [];
            const pushWarn = (level, text, nodeId = null, code = null) => {
                warnings.push({
                    id: code || `${level}_${warnings.length}_${nodeId || 'global'}`,
                    level,
                    text,
                    nodeId
                });
            };

            const outgoing = new Map();
            const incoming = new Map();
            connections.value.forEach(c => {
                if (!outgoing.has(c.from)) outgoing.set(c.from, []);
                outgoing.get(c.from).push(c);
                incoming.set(c.to, (incoming.get(c.to) || 0) + 1);
            });
            const nodeByIdMap = new Map(nodes.value.map(n => [n.id, n]));

            const getTraversalTargets = (nodeId) => {
                const targets = new Set();
                (outgoing.get(nodeId) || []).forEach(conn => {
                    if (conn?.to) targets.add(conn.to);
                });
                const node = nodeByIdMap.get(nodeId);
                if (node && node.type === 'link_state') {
                    const targetEntry = getLinkEntryForState(node);
                    if (targetEntry?.id) targets.add(targetEntry.id);
                }
                return Array.from(targets);
            };

            const questEndIds = new Set(
                nodes.value
                    .filter(n => n.type === 'quest_end')
                    .map(n => n.id)
            );

            const canReachQuestEndMemo = new Map();
            const canReachQuestEnd = (nodeId, stack = new Set()) => {
                if (questEndIds.has(nodeId)) return true;
                if (canReachQuestEndMemo.has(nodeId)) return canReachQuestEndMemo.get(nodeId);
                if (stack.has(nodeId)) return false;
                stack.add(nodeId);
                const next = getTraversalTargets(nodeId);
                for (const targetId of next) {
                    if (canReachQuestEnd(targetId, stack)) {
                        stack.delete(nodeId);
                        canReachQuestEndMemo.set(nodeId, true);
                        return true;
                    }
                }
                stack.delete(nodeId);
                canReachQuestEndMemo.set(nodeId, false);
                return false;
            };

            const startNodes = nodes.value.filter(n => n.type === 'start');
            if (!startNodes.length) {
                pushWarn('critical', 'Missing Start node. Scenario will not launch.', null, 'start_missing');
            }
            if (startNodes.length > 1) {
                pushWarn('critical', `Multiple Start nodes (${startNodes.length}). Keep only one entry point.`, startNodes[0].id, 'start_multiple');
            }
            startNodes.forEach(n => {
                const hasOut = (outgoing.get(n.id) || []).some(c => (c.fromSocket || 'default') === 'default');
                if (!hasOut) {
                    pushWarn('critical', 'Start node has no outgoing link.', n.id, `start_out_${n.id}`);
                }
            });

            const entryGroups = new Map();
            nodes.value.filter(n => n.type === 'link_entry').forEach(n => {
                const name = normalizeEntryName(n.data?.name || n.data?.title);
                if (!name) {
                    pushWarn('critical', 'Link Entry has empty name. Link State targeting becomes ambiguous.', n.id, `entry_empty_${n.id}`);
                    return;
                }
                const key = name.toLowerCase();
                if (!entryGroups.has(key)) entryGroups.set(key, { label: name, nodes: [] });
                entryGroups.get(key).nodes.push(n);
            });
            entryGroups.forEach((entry, key) => {
                if (entry.nodes.length > 1) {
                    pushWarn('critical', `Duplicate Link Entry name "${entry.label}" (${entry.nodes.length}x).`, entry.nodes[0].id, `entry_dup_${key}`);
                }
            });

            nodes.value.filter(n => n.type === 'link_state').forEach(n => {
                const target = getLinkEntryForState(n);
                if (!target) {
                    pushWarn('critical', `Link State "${getNodeDisplayName(n)}" has no valid Link Entry target.`, n.id, `state_target_${n.id}`);
                }
            });

            nodes.value.filter(n => n.type === 'condition').forEach(n => {
                const outs = outgoing.get(n.id) || [];
                const hasTrue = outs.some(c => c.fromSocket === 'true');
                const hasFalse = outs.some(c => c.fromSocket === 'false');
                if (!n.data?.varId) {
                    pushWarn('warning', `Condition "${getNodeDisplayName(n)}" has no variable selected.`, n.id, `cond_var_${n.id}`);
                }
                if (!hasTrue || !hasFalse) {
                    pushWarn('warning', `Condition "${getNodeDisplayName(n)}" should have both True and False outputs connected.`, n.id, `cond_out_${n.id}`);
                }
            });

            nodes.value.filter(n => n.type === 'switcher').forEach(n => {
                const outs = outgoing.get(n.id) || [];
                const hasDefault = outs.some(c => (c.fromSocket || 'default') === 'default');
                if (!n.data?.varId) {
                    pushWarn('warning', `Switch "${getNodeDisplayName(n)}" has no variable selected.`, n.id, `switch_var_${n.id}`);
                }
                if (!hasDefault) {
                    pushWarn('warning', `Switch "${getNodeDisplayName(n)}" has no default output.`, n.id, `switch_default_${n.id}`);
                }
            });

            nodes.value.filter(n => n.type === 'wait_event').forEach(n => {
                const key = String(n.data?.eventKey || '').trim();
                if (!key) {
                    pushWarn('warning', `Wait Event "${getNodeDisplayName(n)}" has no event key.`, n.id, `wait_event_key_${n.id}`);
                }
            });

            nodes.value.filter(n => n.type === 'wait_condition').forEach(n => {
                if (!n.data?.varId) {
                    pushWarn('warning', `Wait Condition "${getNodeDisplayName(n)}" has no variable selected.`, n.id, `wait_cond_var_${n.id}`);
                }
            });

            nodes.value
                .filter(n => ['objective_set', 'objective_complete', 'objective_fail'].includes(n.type))
                .forEach(n => {
                    const id = String(n.data?.objectiveId || '').trim();
                    if (!id) {
                        pushWarn('warning', `${getNodeTypeLabel(n.type)} "${getNodeDisplayName(n)}" has empty objective id.`, n.id, `objective_id_${n.id}`);
                    }
                });

            const questEndNodes = nodes.value.filter(n => n.type === 'quest_end');
            if (!questEndNodes.length) {
                pushWarn('warning', 'No Quest End node found. Final state is inferred from dead-end, which is ambiguous.', null, 'quest_end_missing');
            } else {
                questEndNodes.forEach(n => {
                    const hasOut = getTraversalTargets(n.id).length > 0;
                    if (hasOut) {
                        pushWarn('warning', `Quest End "${getNodeDisplayName(n)}" should not have outgoing links.`, n.id, `quest_end_out_${n.id}`);
                    }
                    if (!incoming.get(n.id)) {
                        pushWarn('warning', `Quest End "${getNodeDisplayName(n)}" is not reachable from any incoming link.`, n.id, `quest_end_in_${n.id}`);
                    }
                });

                const objectiveTerminalNodes = nodes.value.filter(n => n.type === 'objective_complete' || n.type === 'objective_fail');
                const objectiveWithoutEnd = objectiveTerminalNodes.filter(n => !canReachQuestEnd(n.id));
                if (objectiveWithoutEnd.length) {
                    pushWarn('warning', `Objective Complete/Fail nodes without path to Quest End: ${objectiveWithoutEnd.length}.`, objectiveWithoutEnd[0].id, 'objective_path_to_end');
                }
            }

            nodes.value.filter(n => n.type === 'dialog').forEach(n => {
                const outs = outgoing.get(n.id) || [];
                const choices = Array.isArray(n.data?.choices) ? n.data.choices : [];
                if (!choices.length) return;
                const missing = choices.filter((_, idx) => !outs.some(c => c.fromSocket === `choice-${idx}`)).length;
                if (missing > 0) {
                    pushWarn('warning', `Dialog "${getNodeDisplayName(n)}" has ${missing} reply outputs without links.`, n.id, `dialog_out_${n.id}`);
                }
            });

            nodes.value.filter(n => n.type === 'link_entry').forEach(n => {
                const hasOut = (outgoing.get(n.id) || []).some(c => (c.fromSocket || 'default') === 'default');
                if (!hasOut) {
                    pushWarn('warning', `Link Entry "${getNodeDisplayName(n)}" has no outgoing link.`, n.id, `entry_out_${n.id}`);
                }
            });

            nodes.value
                .filter(n => ['action', 'wait_event', 'wait_condition', 'objective_set', 'objective_complete', 'objective_fail'].includes(n.type))
                .forEach(n => {
                    const hasOut = (outgoing.get(n.id) || []).some(c => (c.fromSocket || 'default') === 'default');
                    if (!hasOut) {
                        pushWarn('warning', `${getNodeTypeLabel(n.type)} "${getNodeDisplayName(n)}" has no default outgoing link.`, n.id, `default_out_${n.id}`);
                    }
                });

            const varNameGroups = new Map();
            variables.value.forEach(v => {
                const clean = String(v?.name == null ? '' : v.name).trim().toLowerCase();
                if (!clean) return;
                if (!varNameGroups.has(clean)) varNameGroups.set(clean, 0);
                varNameGroups.set(clean, varNameGroups.get(clean) + 1);
            });
            varNameGroups.forEach((count, name) => {
                if (count > 1) {
                    pushWarn('warning', `Variable name "${name}" is duplicated (${count}x).`, null, `var_dup_${name}`);
                }
            });

            if (startNodes.length) {
                const visited = new Set();
                const queue = startNodes.map(n => n.id);
                while (queue.length) {
                    const current = queue.shift();
                    if (visited.has(current)) continue;
                    visited.add(current);

                    getTraversalTargets(current).forEach(nextId => {
                        if (!visited.has(nextId)) queue.push(nextId);
                    });
                }
                const unreachable = nodes.value.filter(n => n.type !== 'start' && !isDocNodeType(n.type) && !visited.has(n.id));
                if (unreachable.length) {
                    pushWarn('warning', `Unreachable nodes detected: ${unreachable.length}.`, unreachable[0].id, 'unreachable_nodes');
                }

                if (questEndNodes.length) {
                    const reachableQuestEnds = questEndNodes.filter(n => visited.has(n.id));
                    if (!reachableQuestEnds.length) {
                        pushWarn('critical', 'Start flow does not reach any Quest End node.', startNodes[0]?.id || null, 'quest_end_unreachable');
                    }
                    const terminalDeadEnds = nodes.value.filter(n => {
                        if (!visited.has(n.id) || isDocNodeType(n.type) || n.type === 'quest_end') return false;
                        return getTraversalTargets(n.id).length === 0;
                    });
                    if (terminalDeadEnds.length) {
                        pushWarn('warning', `Terminal dead-ends without Quest End: ${terminalDeadEnds.length}.`, terminalDeadEnds[0].id, 'terminal_dead_ends');
                    }
                }
            }

            return warnings.slice(0, 14);
        });

        const warningNodeIdSet = computed(() => new Set(
            graphWarnings.value
                .map(w => w.nodeId)
                .filter(Boolean)
        ));

        const hierarchyTypeFilters = computed(() => {
            const counts = new Map();
            nodes.value.forEach(n => {
                counts.set(n.type, (counts.get(n.type) || 0) + 1);
            });
            return Array.from(counts.entries())
                .sort((a, b) => getNodeTypeLabel(a[0]).localeCompare(getNodeTypeLabel(b[0])))
                .map(([type, count]) => ({ type, label: getNodeTypeLabel(type), count }));
        });

        const toggleHierarchyTypeFilter = (type) => {
            hierarchySearch.include[type] = !(hierarchySearch.include[type] !== false);
        };

        const clearHierarchyFilters = () => {
            hierarchySearch.query = '';
            hierarchySearch.warningsOnly = false;
            Object.keys(hierarchySearch.include).forEach(type => {
                hierarchySearch.include[type] = true;
            });
        };

        const filteredHierarchyRows = computed(() => {
            const tokens = tokenizeSearch(hierarchySearch.query);
            const warningsOnly = hierarchySearch.warningsOnly;
            const warningSet = warningNodeIdSet.value;
            return hierarchyRows.value.filter(row => {
                if (!row || !row.nodeType) return false;
                if (hierarchySearch.include[row.nodeType] === false) return false;
                if (warningsOnly && (!row.nodeId || !warningSet.has(row.nodeId))) return false;
                if (!tokens.length) return true;
                const hay = row.searchText || '';
                return tokens.every(t => hay.includes(t));
            });
        });

        const autosaveStatusText = computed(() => {
            if (autosave.status === 'error') return 'error';
            if (!autosave.lastSavedAt) return 'not saved yet';
            const time = new Date(autosave.lastSavedAt).toLocaleTimeString();
            if (autosave.status === 'pending') return `saving... (${time})`;
            if (autosave.status === 'restored') return `restored ${time}`;
            return `saved ${time}`;
        });

        const toggleHierarchyPanel = () => {
            hierarchyPanelOpen.value = !hierarchyPanelOpen.value;
        };

        const closeNodeConnectMenu = () => {
            nodeConnectMenu.visible = false;
            nodeConnectMenu.fromNodeId = null;
            nodeConnectMenu.fromSocketId = null;
        };

        const clampNodeConnectMenuPosition = () => {
            if (!canvasContainer.value || !nodeConnectMenu.visible) return;
            const rect = canvasContainer.value.getBoundingClientRect();
            const margin = 12;
            const menuWidth = nodeConnectMenuEl.value?.offsetWidth || 360;
            const menuHeight = nodeConnectMenuEl.value?.offsetHeight || 420;
            const maxX = Math.max(margin, rect.width - menuWidth - margin);
            const maxY = Math.max(margin, rect.height - menuHeight - margin);

            nodeConnectMenu.x = Math.min(Math.max(nodeConnectMenu.x, margin), maxX);
            nodeConnectMenu.y = Math.min(Math.max(nodeConnectMenu.y, margin), maxY);
        };

        const openNodeConnectMenu = (clientX, clientY, fromNodeId = null, fromSocketId = null) => {
            if (!canvasContainer.value) return;
            const rect = canvasContainer.value.getBoundingClientRect();
            const localX = clientX - rect.left;
            const localY = clientY - rect.top;
            const world = toWorld(clientX, clientY);

            nodeConnectMenu.x = localX;
            nodeConnectMenu.y = localY;
            nodeConnectMenu.worldX = world.x;
            nodeConnectMenu.worldY = world.y;
            nodeConnectMenu.fromNodeId = fromNodeId || null;
            nodeConnectMenu.fromSocketId = fromSocketId || null;
            nodeConnectMenu.visible = true;
            clampNodeConnectMenuPosition();
            nextTick(() => {
                clampNodeConnectMenuPosition();
            });
        };

        const createConnection = (fromNodeId, fromSocketId, toNodeId, toSocketId = 'in') => {
            if (!fromNodeId || !fromSocketId || !toNodeId || fromNodeId === toNodeId) return false;
            const toNode = nodes.value.find(n => n.id === toNodeId);
            if (!canConnectToNode(toNode)) return false;

            connections.value = connections.value.filter(c =>
                !(c.from === fromNodeId && c.fromSocket === fromSocketId)
            );

            connections.value.push({
                id: genId('conn'),
                from: fromNodeId,
                fromSocket: fromSocketId,
                to: toNodeId,
                toSocket: toSocketId,
                path: ''
            });
            schedulePathUpdate([fromNodeId, toNodeId]);
            return true;
        };

        const createNodeFromContext = (type) => {
            if (!nodeConnectMenu.visible) {
                closeNodeConnectMenu();
                return;
            }

            const node = spawnNode(type, nodeConnectMenu.worldX - 150, nodeConnectMenu.worldY - 50);
            if (nodeConnectMenu.fromNodeId && nodeConnectMenu.fromSocketId) {
                createConnection(nodeConnectMenu.fromNodeId, nodeConnectMenu.fromSocketId, node.id, 'in');
            }

            selectedNodeId.value = node.id;
            selectedNodeIds.value = [node.id];
            selectedConnId.value = null;
            tab.value = 'props';
            closeNodeConnectMenu();
        };

        // Approximate socket positions relative to node (Fixed geometry approach)
        const getSocketPos = (nodeId, socketType) => {
            if (!canvasContainer.value) return { x: 0, y: 0 };

            // Read real socket coordinates from DOM so lines always align with UI
            const socket = getSocketElement(nodeId, socketType);
            if (!socket) return { x: 0, y: 0 };

            const socketRect = socket.getBoundingClientRect();
            const centerX = socketRect.left + socketRect.width / 2;
            const centerY = socketRect.top + socketRect.height / 2;

            return toWorld(centerX, centerY);
        };

        const isSocketOccupied = (nodeId, socketId) => connections.value.some(c =>
            (c.from === nodeId && c.fromSocket === socketId) ||
            (c.to === nodeId && (c.toSocket || 'in') === socketId)
        );

        // --- MOUSE EVENTS HANDLING (CORE FIX) ---
        
        const startPan = (e) => {
            if (e.button === 1) e.preventDefault();
            isPanning.value = true;
            lastMouse.x = e.clientX;
            lastMouse.y = e.clientY;
        };

        const onCanvasMouseDown = (e) => {
            closeNodeConnectMenu();
            if (linkPicker.active) {
                if (e.button === 0) cancelLinkPicker();
                return;
            }
            if (e.button === 1) {
                startPan(e);
                return;
            }
            if (e.button !== 0) return;

            // If clicking on node/socket/button � do not start panning
            if (e.target.closest('.node-wrapper') || e.target.closest('.socket') || e.target.closest('button')) {
                return;
            }

            if (createKey.value) {
                const world = toWorld(e.clientX, e.clientY);
                if (createKey.value === 'group') {
                    const data = defaultNodeData('group');
                    const width = clampGroupWidth(data.width);
                    const height = clampGroupHeight(data.height);
                    spawnNode('group', world.x - width / 2, world.y - height / 2, data);
                } else {
                    spawnNode(createKey.value, world.x - 150, world.y - 50);
                }
                selectedNodeIds.value = [nodes.value[nodes.value.length - 1].id];
                selectedNodeId.value = selectedNodeIds.value[0];
                selectedConnId.value = null;
                return;
            }

            // Clicking empty space starts box selection
            const local = toLocal(e.clientX, e.clientY);
            const world = toWorld(e.clientX, e.clientY);
            selectionBox.active = true;
            selectionBox.shift = e.shiftKey;
            selectionBox.baseIds = selectionBox.shift ? selectedNodeIds.value.slice() : [];
            selectionBox.startX = local.x;
            selectionBox.startY = local.y;
            selectionBox.startWorldX = world.x;
            selectionBox.startWorldY = world.y;
            selectionBox.x = local.x;
            selectionBox.y = local.y;
            selectionBox.w = 0;
            selectionBox.h = 0;
            refreshNodeHitSizeCache();
            if (!selectionBox.shift) {
                selectedNodeId.value = null;
                selectedNodeIds.value = [];
            }
            selectedConnId.value = null;
        };

        const onCanvasContextMenu = (e) => {
            if (!canvasContainer.value) return;
            if (dragLine.value || draggingNode.value || selectionBox.active || resizingGroup.value) return;
            if (linkPicker.active) cancelLinkPicker();

            if (e.target && typeof e.target.closest === 'function') {
                if (e.target.closest('.node-wrapper')) return;
                if (e.target.closest('.socket')) return;
                if (e.target.closest('.node-context-menu')) return;
                if (e.target.closest('.glass-panel')) return;
                if (e.target.closest('button')) return;
                if (e.target.closest('input, textarea, select')) return;
            }

            e.preventDefault();
            selectedConnId.value = null;
            openNodeConnectMenu(e.clientX, e.clientY);
        };

        const handleWheel = (e) => {
            const zoomIntensity = 0.1;
            const rect = canvasContainer.value.getBoundingClientRect();
            
            // Mouse pos relative to canvas
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // World pos before zoom
            const worldX = (mouseX - pan.x) / scale.value;
            const worldY = (mouseY - pan.y) / scale.value;

            // Apply zoom
            const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
            const newScale = Math.min(Math.max(0.2, scale.value + delta), 3);
            
            scale.value = newScale;

            // Adjust pan to keep world pos under mouse
            pan.x = mouseX - worldX * newScale;
            pan.y = mouseY - worldY * newScale;
        };

        const startDragNode = (node, e) => {
            if (!selectedNodeIds.value.includes(node.id)) {
                selectedNodeIds.value = [node.id];
            }
            selectedNodeId.value = node.id;
            selectedConnId.value = null;
            tab.value = 'props';

            const selected = selectedNodeIds.value.map(id => nodes.value.find(n => n.id === id)).filter(Boolean);
            const dragSet = new Map();
            selected.forEach(n => dragSet.set(n.id, n));
            selected.filter(n => n.type === 'group').forEach(groupNode => {
                getGroupMemberNodes(groupNode).forEach(member => {
                    if (!dragSet.has(member.id)) dragSet.set(member.id, member);
                });
            });
            const dragNodes = Array.from(dragSet.values());
            const dragNodeIds = dragNodes.map(n => n.id);

            draggingNode.value = dragNodes.length > 1
                ? { nodes: dragNodes, nodeIds: dragNodeIds }
                : { node: node, nodeIds: [node.id] };
            lastMouse.x = e.clientX;
            lastMouse.y = e.clientY;
        };

        const startGroupResize = (groupNode, edge, e) => {
            if (!groupNode || groupNode.type !== 'group') return;
            if (e.button !== 0) return;
            resizingGroup.value = {
                nodeId: groupNode.id,
                edge,
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                startX: Number(groupNode.x) || 0,
                startY: Number(groupNode.y) || 0,
                startWidth: clampGroupWidth(groupNode.data?.width),
                startHeight: clampGroupHeight(groupNode.data?.height)
            };
        };

        const onNodeMouseDown = (node, e) => {
            closeNodeConnectMenu();
            if (linkPicker.active) {
                const sourceState = nodes.value.find(n => n.id === linkPicker.sourceStateId);
                if (node.type === 'link_entry' && sourceState && sourceState.type === 'link_state') {
                    assignLinkEntryToState(sourceState, node);
                    selectedNodeId.value = sourceState.id;
                    selectedNodeIds.value = [sourceState.id];
                    selectedConnId.value = null;
                    tab.value = 'props';
                }
                cancelLinkPicker();
                return;
            }
            if (e.button === 1) {
                startPan(e);
                return;
            }
            if (e.button !== 0) return;

            if (e.shiftKey) {
                if (selectedNodeIds.value.includes(node.id)) {
                    selectedNodeIds.value = selectedNodeIds.value.filter(id => id !== node.id);
                } else {
                    selectedNodeIds.value = [...selectedNodeIds.value, node.id];
                }
                selectedNodeId.value = selectedNodeIds.value.length === 1 ? selectedNodeIds.value[0] : null;
                selectedConnId.value = null;
                return;
            }

            if (e.altKey) {
                if (selectedNodeIds.value.length > 1 && selectedNodeIds.value.includes(node.id)) {
                    const dups = duplicateNodes(selectedNodeIds.value, 20);
                    if (dups.length) startDragNode(dups[0], e);
                } else {
                    const dup = duplicateNode(node);
                    if (dup) startDragNode(dup, e);
                }
                return;
            }

            // Click on node = select + drag node
            startDragNode(node, e);
        };

        const startDragLine = (nodeId, socketId, e) => {
            closeNodeConnectMenu();
            const startPos = getSocketPos(nodeId, socketId);
            const fallbackPos = toWorld(e.clientX, e.clientY);
            const validStart = (startPos.x || startPos.y) ? startPos : fallbackPos;

            dragLine.value = {
                from: nodeId,
                socket: socketId,
                startPos: validStart,
                currPos: validStart,
                path: makeBezier(validStart.x, validStart.y, validStart.x, validStart.y)
            };
        };

        const processGlobalMouseMove = (clientX, clientY) => {
            const worldPos = toWorld(clientX, clientY);
            lastWorldMouse.x = worldPos.x;
            lastWorldMouse.y = worldPos.y;
            lastWorldMouse.valid = true;

            if (resizingGroup.value) {
                const state = resizingGroup.value;
                const groupNode = nodes.value.find(n => n.id === state.nodeId && n.type === 'group');
                if (groupNode && groupNode.data) {
                    const dx = (clientX - state.startMouseX) / scale.value;
                    const dy = (clientY - state.startMouseY) / scale.value;
                    let rawWidth = state.startWidth;
                    let rawHeight = state.startHeight;

                    const growsRight = state.edge === 'r' || state.edge === 'tr' || state.edge === 'br';
                    const growsLeft = state.edge === 'l' || state.edge === 'tl' || state.edge === 'bl';
                    const growsBottom = state.edge === 'b' || state.edge === 'bl' || state.edge === 'br';
                    const growsTop = state.edge === 't' || state.edge === 'tl' || state.edge === 'tr';

                    if (growsRight) rawWidth = state.startWidth + dx;
                    if (growsLeft) rawWidth = state.startWidth - dx;
                    if (growsBottom) rawHeight = state.startHeight + dy;
                    if (growsTop) rawHeight = state.startHeight - dy;

                    const width = clampGroupWidth(rawWidth);
                    const height = clampGroupHeight(rawHeight);

                    if (growsLeft) {
                        groupNode.x = state.startX + (state.startWidth - width);
                    } else {
                        groupNode.x = state.startX;
                    }

                    if (growsTop) {
                        groupNode.y = state.startY + (state.startHeight - height);
                    } else {
                        groupNode.y = state.startY;
                    }

                    groupNode.data.width = width;
                    groupNode.data.height = height;
                }
                return;
            }

            // 0. Selection box
            if (selectionBox.active) {
                const local = toLocal(clientX, clientY);
                const x = Math.min(selectionBox.startX, local.x);
                const y = Math.min(selectionBox.startY, local.y);
                const w = Math.abs(selectionBox.startX - local.x);
                const h = Math.abs(selectionBox.startY - local.y);
                selectionBox.x = x;
                selectionBox.y = y;
                selectionBox.w = w;
                selectionBox.h = h;

                const selWorldRect = {
                    left: Math.min(selectionBox.startWorldX, worldPos.x),
                    top: Math.min(selectionBox.startWorldY, worldPos.y),
                    right: Math.max(selectionBox.startWorldX, worldPos.x),
                    bottom: Math.max(selectionBox.startWorldY, worldPos.y)
                };

                const hits = [];
                nodes.value.forEach(n => {
                    const bounds = getNodeHitBounds(n);
                    if (!bounds) return;
                    const intersect = !(
                        (bounds.x + bounds.width) < selWorldRect.left ||
                        bounds.x > selWorldRect.right ||
                        (bounds.y + bounds.height) < selWorldRect.top ||
                        bounds.y > selWorldRect.bottom
                    );
                    if (intersect) hits.push(n.id);
                });
                if (selectionBox.shift) {
                    const base = new Set(selectionBox.baseIds);
                    hits.forEach(id => {
                        if (base.has(id)) base.delete(id);
                        else base.add(id);
                    });
                    selectedNodeIds.value = Array.from(base);
                } else {
                    selectedNodeIds.value = hits;
                }
                selectedNodeId.value = selectedNodeIds.value.length === 1 ? selectedNodeIds.value[0] : null;
                selectedConnId.value = null;
            }

            // 1. Panning
            if (isPanning.value) {
                const dx = clientX - lastMouse.x;
                const dy = clientY - lastMouse.y;
                pan.x += dx;
                pan.y += dy;
                lastMouse.x = clientX;
                lastMouse.y = clientY;
            }

            // 2. Node Dragging (Corrected for Scale)
            if (draggingNode.value) {
                const dx = (clientX - lastMouse.x) / scale.value;
                const dy = (clientY - lastMouse.y) / scale.value;

                if (draggingNode.value.nodes) {
                    draggingNode.value.nodes.forEach(n => {
                        n.x += dx;
                        n.y += dy;
                    });
                } else {
                    draggingNode.value.node.x += dx;
                    draggingNode.value.node.y += dy;
                }

                lastMouse.x = clientX;
                lastMouse.y = clientY;
                schedulePathUpdate(draggingNode.value.nodeIds);
            }

            // 3. Line Dragging
            if (dragLine.value) {
                dragLine.value.currPos = worldPos;
                
                // Update bezier
                const start = dragLine.value.startPos;
                const end = worldPos;
                dragLine.value.path = makeBezier(start.x, start.y, end.x, end.y);
            }
        };

        const flushGlobalMouseMove = () => {
            mouseMoveRaf = null;
            if (!pendingMouseMove.has) return;
            const { clientX, clientY } = pendingMouseMove;
            pendingMouseMove.has = false;
            processGlobalMouseMove(clientX, clientY);
        };

        const onGlobalMouseMove = (e) => {
            pendingMouseMove.clientX = e.clientX;
            pendingMouseMove.clientY = e.clientY;
            pendingMouseMove.has = true;
            if (mouseMoveRaf != null) return;
            mouseMoveRaf = queueFrame(flushGlobalMouseMove);
        };

        const onGlobalMouseUp = (e) => {
            isPanning.value = false;
            draggingNode.value = null;
            if (resizingGroup.value) {
                resizingGroup.value = null;
            }
            const releasedDrag = dragLine.value
                ? { from: dragLine.value.from, socket: dragLine.value.socket }
                : null;
            dragLine.value = null;
            selectionBox.active = false;

            if (!releasedDrag) {
                if (nodeConnectMenu.visible) {
                    const insideMenu = e?.target && typeof e.target.closest === 'function' && e.target.closest('.node-context-menu');
                    if (e?.button === 0 && !insideMenu) closeNodeConnectMenu();
                }
                return;
            }

            if (!e || e.button !== 0 || !canvasContainer.value) return;

            const rect = canvasContainer.value.getBoundingClientRect();
            const insideCanvas = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (!insideCanvas) return;

            if (e.target && typeof e.target.closest === 'function') {
                if (e.target.closest('.socket')) return;
                if (e.target.closest('.node-wrapper')) return;
                if (e.target.closest('.glass-panel')) return;
                if (e.target.closest('button')) return;
            }

            openNodeConnectMenu(e.clientX, e.clientY, releasedDrag.from, releasedDrag.socket);
        };

        const onGlobalKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (editingNodeNameId.value) {
                    cancelNodeNameEdit();
                    return;
                }
                if (helpPanelOpen.value) {
                    helpPanelOpen.value = false;
                    return;
                }
                if (exportValidatorDocsOpen.value) {
                    exportValidatorDocsOpen.value = false;
                    return;
                }
                if (exportPanelOpen.value) {
                    exportPanelOpen.value = false;
                    exportValidatorDocsOpen.value = false;
                    return;
                }
                if (nodeConnectMenu.visible) {
                    closeNodeConnectMenu();
                    return;
                }
                if (linkPicker.active) {
                    cancelLinkPicker();
                    return;
                }
            }

            if (isEditingElement()) return;
            const key = e.key.toLowerCase();
            const isCmd = e.ctrlKey || e.metaKey;
            if (!isCmd && e.code === 'KeyG') {
                if (selectedNodeIds.value.length) {
                    const created = createGroupFromSelection();
                    if (created) e.preventDefault();
                } else {
                    createKey.value = 'group';
                }
                return;
            }
            if (['KeyC', 'KeyS', 'KeyA', 'KeyD', 'KeyE', 'KeyW', 'KeyO', 'KeyK', 'KeyF', 'KeyQ'].includes(e.code)) {
                const map = {
                    KeyC: 'condition',
                    KeyS: 'switcher',
                    KeyA: 'action',
                    KeyD: 'dialog',
                    KeyE: 'wait_event',
                    KeyW: 'wait_condition',
                    KeyO: 'objective_set',
                    KeyK: 'objective_complete',
                    KeyF: 'objective_fail',
                    KeyQ: 'quest_end'
                };
                createKey.value = map[e.code];
            }
            if (key === 'delete' || key === 'backspace') {
                if (selectedNodeIds.value.length) {
                    const toDelete = selectedNodeIds.value.slice();
                    toDelete.forEach(id => deleteNode(id));
                    selectedNodeIds.value = selectedNodeIds.value.filter(id => nodes.value.find(n => n.id === id));
                    selectedNodeId.value = selectedNodeIds.value.length === 1 ? selectedNodeIds.value[0] : null;
                    selectedConnId.value = null;
                    e.preventDefault();
                }
                return;
            }
            if (!isCmd) return;

            if (e.code === 'KeyC') {
                if (selectedNode.value) {
                    copySelectedNode();
                    e.preventDefault();
                }
                return;
            }

            if (e.code === 'KeyV') {
                const pasted = pasteClipboardNode();
                if (pasted) {
                    selectedNodeId.value = pasted.id;
                    selectedConnId.value = null;
                    tab.value = 'props';
                    e.preventDefault();
                }
            }
        };

        const onGlobalKeyUp = (e) => {
            if (['KeyC', 'KeyS', 'KeyA', 'KeyD', 'KeyE', 'KeyW', 'KeyO', 'KeyK', 'KeyF', 'KeyQ', 'KeyG'].includes(e.code)) {
                createKey.value = null;
            }
        };

        const onSocketMouseUp = (targetNodeId, targetSocket) => {
            closeNodeConnectMenu();
            if (!dragLine.value) return;
            createConnection(dragLine.value.from, dragLine.value.socket, targetNodeId, targetSocket);
            dragLine.value = null;
        };

        // --- RENDERING LINES ---
        const makeBezier = (x1, y1, x2, y2) => {
            const dist = Math.abs(x1 - x2);
            const cpOffset = Math.max(dist * 0.5, 50);
            return `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
        };

        const buildSocketCacheKey = (nodeId, socketId) => `${nodeId}:${socketId || 'in'}`;

        const getSocketPosFromCache = (cache, nodeId, socketId) => {
            const key = buildSocketCacheKey(nodeId, socketId);
            if (cache.has(key)) return cache.get(key);
            const pos = getSocketPos(nodeId, socketId);
            cache.set(key, pos);
            return pos;
        };

        const updateSingleConnectionPath = (conn, socketCache) => {
            const p1 = getSocketPosFromCache(socketCache, conn.from, conn.fromSocket);
            const p2 = getSocketPosFromCache(socketCache, conn.to, conn.toSocket || 'in');
            conn.path = makeBezier(p1.x, p1.y, p2.x, p2.y);
        };

        const updateConnectionPaths = () => {
            const socketCache = new Map();
            connections.value.forEach(conn => {
                updateSingleConnectionPath(conn, socketCache);
            });
        };

        const updateConnectionPathsForNodes = (nodeIds) => {
            if (!nodeIds || !nodeIds.size) {
                updateConnectionPaths();
                return;
            }
            const socketCache = new Map();
            connections.value.forEach(conn => {
                if (!nodeIds.has(conn.from) && !nodeIds.has(conn.to)) return;
                updateSingleConnectionPath(conn, socketCache);
            });
        };

        const flushPathUpdate = () => {
            pathUpdateRaf = null;
            nextTick(() => {
                if (!pendingPathFullUpdate && !pendingPathNodeIds.size) return;
                if (pendingPathFullUpdate) {
                    updateConnectionPaths();
                } else {
                    updateConnectionPathsForNodes(new Set(pendingPathNodeIds));
                }
                pendingPathNodeIds.clear();
                pendingPathFullUpdate = false;
            });
        };

        const schedulePathUpdate = (nodeIds = null) => {
            if (Array.isArray(nodeIds) && nodeIds.length && !pendingPathFullUpdate) {
                nodeIds.forEach(id => pendingPathNodeIds.add(id));
            } else {
                pendingPathFullUpdate = true;
                pendingPathNodeIds.clear();
            }
            if (pathUpdateRaf != null) return;
            pathUpdateRaf = queueFrame(flushPathUpdate);
        };

        // --- LOGIC: Nodes CRUD ---
        const genId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        const createActionOp = () => ({
            id: genId('op'),
            varId: null,
            op: 'set',
            val: 0
        });

        const createSwitchCase = () => ({
            id: genId('case'),
            socketId: genId('socket'),
            value: ''
        });

        const normalizeEntryName = (name) => (name == null ? '' : String(name).trim());

        const getNextLinkEntryName = () => {
            const used = new Set(
                nodes.value
                    .filter(n => n.type === 'link_entry')
                    .map(n => normalizeEntryName(n.data?.name || n.data?.title))
                    .filter(Boolean)
            );
            let i = 1;
            while (used.has(`Link_${i}`)) i += 1;
            return `Link_${i}`;
        };

        const defaultNodeData = (type) => {
            if (type === 'dialog') return { title: getNodeTypeLabel('dialog'), speakerId: null, text: '', choices: [] };
            if (type === 'action') return { title: getNodeTypeLabel('action'), ops: [createActionOp()] };
            if (type === 'condition') return { title: getNodeTypeLabel('condition'), varId: null, op: 'eq', val: 0 };
            if (type === 'switcher') return { title: getNodeTypeLabel('switcher'), varId: null, cases: [createSwitchCase()] };
            if (type === 'wait_event') return { title: getNodeTypeLabel('wait_event'), eventKey: '', note: '' };
            if (type === 'wait_condition') return { title: getNodeTypeLabel('wait_condition'), varId: null, op: 'eq', val: 0 };
            if (type === 'objective_set') return { title: getNodeTypeLabel('objective_set'), objectiveId: '', objectiveText: '' };
            if (type === 'objective_complete') return { title: getNodeTypeLabel('objective_complete'), objectiveId: '', reason: '' };
            if (type === 'objective_fail') return { title: getNodeTypeLabel('objective_fail'), objectiveId: '', reason: '' };
            if (type === 'quest_end') return { title: getNodeTypeLabel('quest_end'), result: 'complete', endingNote: '' };
            if (type === 'link_state') return { title: getNodeTypeLabel('link_state'), entryId: null, entryName: '' };
            if (type === 'link_entry') {
                const name = getNextLinkEntryName();
                return { name, title: name };
            }
            if (type === 'comment') return { title: getNodeTypeLabel('comment'), text: '' };
            if (type === 'group') return { title: getNextGroupTitle(), color: GROUP_DEFAULT_COLOR, width: 360, height: 190, zoomTitleLock: false };
            if (type === 'frame') return { title: getNextGroupTitle(), color: GROUP_DEFAULT_COLOR, width: 420, height: 220, zoomTitleLock: false };
            return {};
        };

        const cloneNodeData = (type, data) => {
            const cloned = JSON.parse(JSON.stringify(data || {}));
            if (type === 'dialog') {
                if (!Array.isArray(cloned.choices)) cloned.choices = [];
                if (!('speakerId' in cloned)) cloned.speakerId = null;
                if (!('text' in cloned)) cloned.text = '';
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('dialog');
            }
            if (type === 'action') {
                if (!Array.isArray(cloned.ops)) cloned.ops = [];
                cloned.ops = cloned.ops.map(op => ({ ...op, id: genId('op') }));
                if (!cloned.ops.length) cloned.ops = [createActionOp()];
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('action');
            }
            if (type === 'condition') {
                if (!('varId' in cloned)) cloned.varId = null;
                if (!('op' in cloned)) cloned.op = 'eq';
                if (!('val' in cloned)) cloned.val = 0;
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('condition');
            }
            if (type === 'switcher') {
                if (!Array.isArray(cloned.cases)) cloned.cases = [];
                cloned.cases = cloned.cases.map(c => ({
                    ...c,
                    id: genId('case'),
                    socketId: genId('socket')
                }));
                if (!cloned.cases.length) cloned.cases = [createSwitchCase()];
                if (!('varId' in cloned)) cloned.varId = null;
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('switcher');
            }
            if (type === 'wait_event') {
                if (!('eventKey' in cloned)) cloned.eventKey = '';
                if (!('note' in cloned)) cloned.note = '';
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('wait_event');
            }
            if (type === 'wait_condition') {
                if (!('varId' in cloned)) cloned.varId = null;
                if (!('op' in cloned)) cloned.op = 'eq';
                if (!('val' in cloned)) cloned.val = 0;
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('wait_condition');
            }
            if (type === 'objective_set') {
                if (!('objectiveId' in cloned)) cloned.objectiveId = '';
                if (!('objectiveText' in cloned)) cloned.objectiveText = '';
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('objective_set');
            }
            if (type === 'objective_complete' || type === 'objective_fail') {
                if (!('objectiveId' in cloned)) cloned.objectiveId = '';
                if (!('reason' in cloned)) cloned.reason = '';
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel(type);
            }
            if (type === 'quest_end') {
                const result = String(cloned.result || 'complete').trim().toLowerCase();
                cloned.result = ['complete', 'fail', 'abort'].includes(result) ? result : 'complete';
                if (!('endingNote' in cloned)) cloned.endingNote = '';
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('quest_end');
            }
            if (type === 'link_state') {
                if (!('entryId' in cloned)) cloned.entryId = null;
                if (!('entryName' in cloned)) cloned.entryName = '';
                cloned.entryName = normalizeEntryName(cloned.entryName);
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('link_state');
            }
            if (type === 'link_entry') {
                cloned.name = getNextLinkEntryName();
                cloned.title = cloned.name;
            }
            if (type === 'comment') {
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNodeTypeLabel('comment');
                if (!('text' in cloned)) cloned.text = '';
            }
            if (type === 'group' || type === 'frame') {
                if (!('title' in cloned) || !String(cloned.title).trim()) cloned.title = getNextGroupTitle();
                cloned.color = normalizeGroupColor(cloned.color);
                cloned.width = clampGroupWidth(cloned.width);
                cloned.height = clampGroupHeight(cloned.height);
                cloned.zoomTitleLock = Boolean(cloned.zoomTitleLock);
            }
            return cloned;
        };

        const spawnNode = (type, x, y, dataOverride = null) => {
            const node = {
                id: genId('node'),
                type,
                x,
                y,
                data: dataOverride || defaultNodeData(type)
            };
            nodes.value.push(node);
            clearDomCaches();
            schedulePathUpdate([node.id]);
            return node;
        };

        const duplicateNode = (sourceNode, posOverride = null) => {
            if (sourceNode.type === 'start') return null;
            const data = cloneNodeData(sourceNode.type, sourceNode.data);
            const x = posOverride?.x ?? sourceNode.x;
            const y = posOverride?.y ?? sourceNode.y;
            const node = spawnNode(sourceNode.type, x, y, data);
            selectedNodeId.value = node.id;
            selectedConnId.value = null;
            tab.value = 'props';
            return node;
        };

        const duplicateNodes = (ids, offset = 20) => {
            const created = [];
            const idMap = new Map();
            ids.forEach(id => {
                const n = nodes.value.find(x => x.id === id);
                if (!n || n.type === 'start') return;
                const data = cloneNodeData(n.type, n.data);
                const node = spawnNode(n.type, n.x + offset, n.y + offset, data);
                idMap.set(id, node.id);
                created.push(node);
            });

            if (idMap.size) {
                const newConnections = [];
                connections.value.forEach(c => {
                    const newFrom = idMap.get(c.from);
                    const newTo = idMap.get(c.to);
                    if (newFrom && newTo) {
                        newConnections.push({
                            id: genId('conn'),
                            from: newFrom,
                            fromSocket: c.fromSocket,
                            to: newTo,
                            toSocket: c.toSocket,
                            path: ''
                        });
                    }
                });
                connections.value = connections.value.concat(newConnections);
                schedulePathUpdate(created.map(n => n.id));
            }

            selectedNodeIds.value = created.map(n => n.id);
            selectedNodeId.value = created.length === 1 ? created[0].id : null;
            selectedConnId.value = null;
            tab.value = 'props';
            return created;
        };

        const isEditingElement = () => {
            const el = document.activeElement;
            if (!el) return false;
            const tag = el.tagName;
            return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        };

        const copySelectedNode = () => {
            if (!selectedNode.value || selectedNode.value.type === 'start') return;
            nodeClipboard.value = {
                type: selectedNode.value.type,
                data: JSON.parse(JSON.stringify(selectedNode.value.data)),
                x: selectedNode.value.x,
                y: selectedNode.value.y
            };
        };

        const pasteClipboardNode = () => {
            if (!nodeClipboard.value) return null;
            const base = nodeClipboard.value;
            const data = cloneNodeData(base.type, base.data);
            const x = lastWorldMouse.valid ? lastWorldMouse.x : base.x + 30;
            const y = lastWorldMouse.valid ? lastWorldMouse.y : base.y + 30;
            return spawnNode(base.type, x, y, data);
        };

        const createGroupFromSelection = () => {
            const selected = selectedNodeIds.value
                .map(id => nodes.value.find(n => n.id === id))
                .filter(n => n && n.type !== 'group');
            if (!selected.length) return null;

            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;

            selected.forEach(node => {
                const b = getNodeWorldBounds(node);
                if (!b) return;
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.width);
                maxY = Math.max(maxY, b.y + b.height);
            });

            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                return null;
            }

            const pad = 36;
            const data = defaultNodeData('group');
            data.title = getNextGroupTitle();
            data.width = clampGroupWidth(maxX - minX + pad * 2);
            data.height = clampGroupHeight(maxY - minY + pad * 2);
            const group = spawnNode('group', minX - pad, minY - pad, data);
            selectedNodeIds.value = [group.id];
            selectedNodeId.value = group.id;
            selectedConnId.value = null;
            tab.value = 'props';
            return group;
        };

        const addNode = (type) => {
            closeNodeConnectMenu();
            const rect = canvasContainer.value.getBoundingClientRect();
            // Center of visible screen converted to world coords
            const center = toWorld(rect.width/2 + rect.left, rect.height/2 + rect.top);

            if (type === 'group' || type === 'frame') {
                const data = defaultNodeData(type === 'frame' ? 'group' : type);
                const width = clampGroupWidth(data.width);
                const height = clampGroupHeight(data.height);
                spawnNode('group', center.x - width / 2, center.y - height / 2, data);
                return;
            }

            spawnNode(type, center.x - 150, center.y - 50);
        };

        const deleteNode = (id) => {
            const target = nodes.value.find(n => n.id === id);
            if (target && target.type === 'start') return;

            if (editingNodeNameId.value === id) {
                cancelNodeNameEdit();
            }

            if (target && target.type === 'link_entry') {
                const removedName = normalizeEntryName(target.data?.name || target.data?.title);
                nodes.value.forEach(n => {
                    if (n.type !== 'link_state') return;
                    if (n.data?.entryId === target.id) {
                        n.data.entryId = null;
                        n.data.entryName = '';
                        return;
                    }
                    if (removedName && normalizeEntryName(n.data?.entryName) === removedName) {
                        n.data.entryName = '';
                    }
                });
            }

            nodes.value = nodes.value.filter(n => n.id !== id);
            connections.value = connections.value.filter(c => c.from !== id && c.to !== id);
            if (selectedNodeId.value === id) selectedNodeId.value = null;
            selectedNodeIds.value = selectedNodeIds.value.filter(nid => nid !== id);
            clearDomCaches();
            schedulePathUpdate([id]);
        };

        const selectNode = (id) => {
            selectedNodeId.value = id;
            selectedNodeIds.value = [id];
            selectedConnId.value = null;
            tab.value = 'props';
        };
        const selectConnection = (id) => { selectedConnId.value = id; selectedNodeId.value = null; };

        const deleteConnection = (id) => {
            const target = connections.value.find(c => c.id === id) || null;
            connections.value = connections.value.filter(c => c.id !== id);
            if (selectedConnId.value === id) selectedConnId.value = null;
            if (target) schedulePathUpdate([target.from, target.to]);
        };

        const onConnectionClick = (id, e) => {
            if (e?.altKey) {
                deleteConnection(id);
                return;
            }
            selectConnection(id);
        };

        // --- LOGIC: Variables ---
        const addVariable = () => {
            const nextIndex = variables.value.length + 1;
            variables.value.push({
                id: Date.now().toString(),
                name: `Var_${nextIndex}`,
                type: 'num',
                init: 0,
                options: []
            });
        };

        const updateVariableType = (variable) => {
            if (variable.type === 'bool') {
                variable.init = Boolean(variable.init);
            } else if (variable.type === 'string') {
                variable.init = variable.init != null ? String(variable.init) : '';
            } else if (variable.type === 'enum') {
                if (!Array.isArray(variable.options)) variable.options = [];
                if (!variable.options.length) variable.options = ['Option_1'];
                if (!variable.options.includes(variable.init)) variable.init = variable.options[0];
            } else {
                const parsedValue = Number(variable.init);
                variable.init = Number.isNaN(parsedValue) ? 0 : parsedValue;
            }

            // Update action ops tied to this variable
            nodes.value.forEach(node => {
                if (node.type !== 'action' || !Array.isArray(node.data.ops)) return;
                node.data.ops.forEach(op => {
                    if (op.varId !== variable.id) return;
                    if (variable.type === 'bool') {
                        op.op = 'set';
                        op.val = Boolean(op.val);
                    } else if (variable.type === 'string') {
                        op.op = 'set';
                        op.val = op.val != null ? String(op.val) : '';
                    } else if (variable.type === 'enum') {
                        op.op = 'set';
                        if (!Array.isArray(variable.options)) variable.options = [];
                        if (!variable.options.length) variable.options = ['Option_1'];
                        op.val = variable.options.includes(op.val) ? op.val : variable.options[0];
                    } else {
                        if (!['add', 'sub', 'mul', 'div', 'set'].includes(op.op)) op.op = 'set';
                        const numVal = Number(op.val);
                        op.val = Number.isNaN(numVal) ? 0 : numVal;
                    }
                });
            });

            // Update condition/switcher tied to this variable
            nodes.value.forEach(node => {
                if ((node.type === 'condition' || node.type === 'wait_condition') && node.data.varId === variable.id) {
                    if (variable.type === 'bool') {
                        node.data.op = ['eq', 'neq'].includes(node.data.op) ? node.data.op : 'eq';
                        node.data.val = Boolean(node.data.val);
                    } else if (variable.type === 'string') {
                        node.data.op = ['eq', 'neq'].includes(node.data.op) ? node.data.op : 'eq';
                        node.data.val = node.data.val != null ? String(node.data.val) : '';
                    } else if (variable.type === 'enum') {
                        node.data.op = ['eq', 'neq'].includes(node.data.op) ? node.data.op : 'eq';
                        if (!Array.isArray(variable.options)) variable.options = [];
                        if (!variable.options.length) variable.options = ['Option_1'];
                        node.data.val = variable.options.includes(node.data.val) ? node.data.val : variable.options[0];
                    } else {
                        node.data.op = ['eq', 'neq', 'gt', 'lt'].includes(node.data.op) ? node.data.op : 'eq';
                        const numVal = Number(node.data.val);
                        node.data.val = Number.isNaN(numVal) ? 0 : numVal;
                    }
                }

                if (node.type === 'switcher' && node.data.varId === variable.id) {
                    if (!Array.isArray(node.data.cases)) return;
                    node.data.cases.forEach(c => {
                        if (variable.type === 'bool') {
                            c.value = Boolean(c.value);
                        } else if (variable.type === 'string') {
                            c.value = c.value != null ? String(c.value) : '';
                        } else if (variable.type === 'enum') {
                            if (!Array.isArray(variable.options)) variable.options = [];
                            if (!variable.options.length) variable.options = ['Option_1'];
                            c.value = variable.options.includes(c.value) ? c.value : variable.options[0];
                        } else {
                            const numVal = Number(c.value);
                            c.value = Number.isNaN(numVal) ? 0 : numVal;
                        }
                    });
                }
            });
        };

        const removeVariable = (variableId) => {
            variables.value = variables.value.filter(v => v.id !== variableId);

            // Clear references to deleted variable in condition/action/switcher nodes.
            nodes.value.forEach(node => {
                if (node.type === 'condition' && node.data.varId === variableId) {
                    node.data.varId = null;
                }

                if (node.type === 'action' && Array.isArray(node.data.ops)) {
                    node.data.ops = node.data.ops.filter(op => op.varId !== variableId);
                }

                if (node.type === 'switcher' && node.data.varId === variableId) {
                    node.data.varId = null;
                }
                if (node.type === 'wait_condition' && node.data.varId === variableId) {
                    node.data.varId = null;
                }
            });
        };

        const getVariableTypeClass = (type) => {
            if (type === 'bool') return 'bg-orange-900/40 text-orange-300 border border-orange-500/30';
            if (type === 'string') return 'bg-pink-900/40 text-pink-300 border border-pink-500/30';
            if (type === 'enum') return 'bg-teal-900/40 text-teal-300 border border-teal-500/30';
            return 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/30';
        };

        const getVariableTypeLabel = (type) => {
            if (type === 'bool') return 'Bool';
            if (type === 'string') return 'String';
            if (type === 'enum') return 'Enum';
            return 'Num';
        };

        const addEnumOption = (variable) => {
            if (!Array.isArray(variable.options)) variable.options = [];
            const nextIndex = variable.options.length + 1;
            variable.options.push(`Option_${nextIndex}`);
            if (!variable.options.includes(variable.init)) {
                variable.init = variable.options[0];
            }
            updateVariableType(variable);
        };

        const removeEnumOption = (variable, index) => {
            if (!Array.isArray(variable.options)) return;
            variable.options.splice(index, 1);
            if (!variable.options.length) variable.options = ['Option_1'];
            if (!variable.options.includes(variable.init)) {
                variable.init = variable.options[0];
            }
            updateVariableType(variable);
        };

        const getVarOptions = (id) => {
            const opts = variables.value.find(v => v.id === id)?.options;
            return Array.isArray(opts) ? opts : [];
        };

        // --- LOGIC: Characters ---
        const addCharacter = () => {
            const nextIndex = characters.value.length + 1;
            characters.value.push({
                id: `char_${Date.now()}`,
                name: `NPC_${nextIndex}`
            });
        };

        const removeCharacter = (id) => {
            characters.value = characters.value.filter(c => c.id !== id);
            nodes.value.forEach(node => {
                if (node.type === 'dialog' && node.data.speakerId === id) {
                    node.data.speakerId = null;
                }
            });
        };

        const getCharacterName = (id) => characters.value.find(c => c.id === id)?.name || '???';

        const getVarType = (id) => variables.value.find(v => v.id === id)?.type || null;
        const getRuntimeDisplay = (v) => {
            const val = runtimeVars.value[v.id];
            if (val === undefined || val === null) return '\\u2014';
            if (v.type === 'bool') return val ? 'True' : 'False';
            if (v.type === 'num') return (Number(val) || 0).toString();
            return val != null ? String(val) : '';
        };


        const onActionVarChange = (op) => {
            const v = variables.value.find(v => v.id === op.varId);
            if (!v) return;
            if (v.type === 'bool') {
                op.op = 'set';
                op.val = Boolean(v.init);
            } else if (v.type === 'string') {
                op.op = 'set';
                op.val = v.init != null ? String(v.init) : '';
            } else if (v.type === 'enum') {
                op.op = 'set';
                if (!Array.isArray(v.options)) v.options = [];
                if (!v.options.length) v.options = ['Option_1'];
                op.val = v.options.includes(op.val) ? op.val : v.options[0];
            } else {
                if (!['add', 'sub', 'mul', 'div', 'set'].includes(op.op)) op.op = 'set';
                const numVal = Number(op.val);
                op.val = Number.isNaN(numVal) ? 0 : numVal;
            }
        };

        const addActionOp = (node) => {
            if (!node?.data) return;
            if (!Array.isArray(node.data.ops)) node.data.ops = [];
            node.data.ops.push(createActionOp());
            schedulePathUpdate([node.id]);
        };

        const removeActionOp = (node, index) => {
            if (!node?.data || !Array.isArray(node.data.ops)) return;
            node.data.ops.splice(index, 1);
            schedulePathUpdate([node.id]);
        };

        const addSwitcherCase = (node) => {
            if (!node?.data) return;
            if (!Array.isArray(node.data.cases)) node.data.cases = [];
            node.data.cases.push(createSwitchCase());
            clearDomCaches();
            schedulePathUpdate([node.id]);
        };

        const removeSwitcherCase = (node, caseItem) => {
            if (!node?.data || !Array.isArray(node.data.cases)) return;
            node.data.cases = node.data.cases.filter(c => c.id !== caseItem.id);
            connections.value = connections.value.filter(c => !(c.from === node.id && c.fromSocket === caseItem.socketId));
            clearDomCaches();
            schedulePathUpdate([node.id]);
        };

        const onSwitcherVarChange = (node) => {
            if (!node?.data) return;
            const v = variables.value.find(v => v.id === node.data.varId);
            if (!v) return;
            if (!Array.isArray(node.data.cases)) node.data.cases = [];
            node.data.cases.forEach(c => {
                if (v.type === 'bool') c.value = false;
                else if (v.type === 'string') c.value = '';
                else if (v.type === 'enum') {
                    if (!Array.isArray(v.options)) v.options = [];
                    if (!v.options.length) v.options = ['Option_1'];
                    c.value = v.options[0];
                } else c.value = 0;
            });
        };

        // --- LOGIC: Helper ---
        const getVarName = (id) => variables.value.find(v => v.id === id)?.name || '???';
        const getConditionText = (d) => {
            const v = getVarName(d.varId);
            const opMap = { eq: '==', neq: '!=', gt: '>', lt: '<' };
            return d.varId ? `${v} ${opMap[d.op] || '??'} ${d.val}` : 'Select Variable';
        };

        const evaluateConditionNode = (conditionData) => {
            const variable = variables.value.find(v => v.id === conditionData?.varId);
            const vType = variable?.type || 'num';
            const rawVal = runtimeVars.value[conditionData?.varId];
            let val = rawVal;
            let target = conditionData?.val;
            let res = false;

            if (vType === 'bool') {
                val = Boolean(rawVal);
                target = Boolean(conditionData?.val);
                if (conditionData?.op === 'eq') res = val === target;
                if (conditionData?.op === 'neq') res = val !== target;
            } else if (vType === 'string' || vType === 'enum') {
                val = rawVal != null ? String(rawVal) : '';
                target = conditionData?.val != null ? String(conditionData?.val) : '';
                if (conditionData?.op === 'eq') res = val === target;
                if (conditionData?.op === 'neq') res = val !== target;
            } else {
                val = Number(rawVal) || 0;
                target = Number(conditionData?.val) || 0;
                if (conditionData?.op === 'eq') res = val == target;
                if (conditionData?.op === 'gt') res = val > target;
                if (conditionData?.op === 'lt') res = val < target;
                if (conditionData?.op === 'neq') res = val != target;
            }

            return res;
        };
        const selectedNode = computed(() => nodes.value.find(n => n.id === selectedNodeId.value));

        const resetView = () => {
            pan.x = 0; pan.y = 0; scale.value = 1;
        };

        // --- RUNTIME ---
        const runScenario = () => {
            const start = nodes.value.find(n => n.type === 'start');
            if (!start) { alert("No Start node!"); return; }
            
            // Init Vars
            runtimeVars.value = {};
            variables.value.forEach(v => runtimeVars.value[v.id] = v.init);
            
            gameLog.value = [];
            gameFinished.value = false;
            isPlayMode.value = true;
            
            processNode(start);
        };

        const processNode = (node) => {
            activeNode.value = node;
            
            if (node.type === 'start') {
                traverse(node.id, 'default');
            }
            else if (node.type === 'action') {
                node.data.ops.forEach(op => {
                    if (!op.varId) return;
                    const v = variables.value.find(v => v.id === op.varId);
                    if (!v) return;

                    if (v.type === 'bool') {
                        if (op.op === 'toggle') {
                            runtimeVars.value[op.varId] = !Boolean(runtimeVars.value[op.varId]);
                        } else {
                            runtimeVars.value[op.varId] = Boolean(op.val);
                        }
                        return;
                    }

                    if (v.type === 'string' || v.type === 'enum') {
                        runtimeVars.value[op.varId] = op.val != null ? String(op.val) : '';
                        return;
                    }

                    const current = Number(runtimeVars.value[op.varId]) || 0;
                    const val = Number(op.val) || 0;
                    if (op.op === 'add') runtimeVars.value[op.varId] = current + val;
                    else if (op.op === 'sub') runtimeVars.value[op.varId] = current - val;
                    else if (op.op === 'mul') runtimeVars.value[op.varId] = current * val;
                    else if (op.op === 'div') runtimeVars.value[op.varId] = current / val;
                    else if (op.op === 'set') runtimeVars.value[op.varId] = val;
                });
                traverse(node.id, 'default');
            }
            else if (node.type === 'switcher') {
                const variable = variables.value.find(v => v.id === node.data.varId);
                const vType = variable?.type || 'num';
                const rawVal = runtimeVars.value[node.data.varId];
                let current = rawVal;

                if (vType === 'bool') current = Boolean(rawVal);
                else if (vType === 'string' || vType === 'enum') current = rawVal != null ? String(rawVal) : '';
                else current = Number(rawVal) || 0;

                let matched = null;
                if (Array.isArray(node.data.cases)) {
                    for (const c of node.data.cases) {
                        let caseVal = c.value;
                        if (vType === 'bool') caseVal = Boolean(c.value);
                        else if (vType === 'string' || vType === 'enum') caseVal = c.value != null ? String(c.value) : '';
                        else caseVal = Number(c.value) || 0;

                        if (caseVal === current) { matched = c; break; }
                    }
                }

                traverse(node.id, matched ? matched.socketId : 'default');
            }
            else if (node.type === 'condition') {
                const res = evaluateConditionNode(node.data);
                traverse(node.id, res ? 'true' : 'false');
            }
            else if (node.type === 'wait_event') {
                // Simulator behavior: treat wait as instantly fulfilled.
                traverse(node.id, 'default');
            }
            else if (node.type === 'wait_condition') {
                const isReady = evaluateConditionNode(node.data);
                if (!isReady) {
                    gameFinished.value = true;
                    return;
                }
                traverse(node.id, 'default');
            }
            else if (node.type === 'objective_set' || node.type === 'objective_complete' || node.type === 'objective_fail') {
                // Simulator behavior: objective hooks are side effects in engine bridge, continue immediately.
                traverse(node.id, 'default');
            }
            else if (node.type === 'quest_end') {
                // Explicit terminal node for scenario completion states.
                gameFinished.value = true;
                return;
            }
            else if (node.type === 'link_state') {
                const entryNode = getLinkEntryForState(node);
                if (!entryNode) {
                    gameFinished.value = true;
                    return;
                }
                processNode(entryNode);
            }
            else if (node.type === 'link_entry') {
                traverse(node.id, 'default');
            }
            else if (isDocNodeType(node.type)) {
                traverse(node.id, 'default');
            }
            // Dialog stops and waits for UI
        };

        const traverse = (nodeId, socket) => {
            setTimeout(() => {
                const conn = connections.value.find(c => c.from === nodeId && c.fromSocket === socket);
                if (conn) {
                    const next = nodes.value.find(n => n.id === conn.to);
                    if (next) processNode(next);
                } else {
                    if (activeNode.value.type !== 'dialog') gameFinished.value = true;
                }
            }, 200);
        };

        const makeChoice = (idx) => {
            gameLog.value.push({
                speakerId: activeNode.value.data.speakerId,
                text: activeNode.value.data.text,
                choice: activeNode.value.data.choices[idx].text
            });
            traverse(activeNode.value.id, 'choice-' + idx);
        };

        const triggerLoad = () => {
            if (loadInput.value) loadInput.value.click();
        };

        const buildProjectPayload = () => ({
            version: 1,
            title: currentProjectTitle.value || '',
            nodes: nodes.value,
            connections: connections.value,
            variables: variables.value,
            characters: characters.value,
            pan: { x: pan.x, y: pan.y },
            scale: scale.value
        });

        const buildSerializableProjectPayload = () => {
            const payload = buildProjectPayload();
            try {
                return JSON.parse(JSON.stringify(payload));
            } catch (err) {
                console.error('Failed to serialize project payload for exporter bridge', err);
                return {
                    version: 1,
                    title: currentProjectTitle.value || '',
                    nodes: Array.isArray(nodes.value) ? nodes.value.map(n => ({ ...n, data: n?.data ? { ...n.data } : {} })) : [],
                    connections: Array.isArray(connections.value) ? connections.value.map(c => ({ ...c })) : [],
                    variables: Array.isArray(variables.value) ? variables.value.map(v => ({ ...v })) : [],
                    characters: Array.isArray(characters.value) ? characters.value.map(c => ({ ...c })) : [],
                    pan: { x: pan.x, y: pan.y },
                    scale: scale.value
                };
            }
        };

        const saveAutosaveNow = () => {
            if (autosaveLocked.value) return;
            try {
                const snapshot = {
                    savedAt: Date.now(),
                    data: buildProjectPayload()
                };
                localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(snapshot));
                autosave.lastSavedAt = snapshot.savedAt;
                autosave.status = 'saved';
            } catch (err) {
                autosave.status = 'error';
            }
        };

        const scheduleAutosave = () => {
            if (autosaveLocked.value) return;
            if (autosave.lastRestoredAt && Date.now() - autosave.lastRestoredAt < 1200) return;
            autosave.status = 'pending';
            if (autosaveTimer) clearTimeout(autosaveTimer);
            autosaveTimer = setTimeout(() => {
                saveAutosaveNow();
            }, 700);
        };

        const restoreAutosave = () => {
            try {
                const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
                if (!raw) return false;
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.data || !Array.isArray(parsed.data.nodes)) return false;
                autosaveLocked.value = true;
                applyProjectData(parsed.data);
                autosaveLocked.value = false;
                autosave.lastSavedAt = Number(parsed.savedAt) || Date.now();
                autosave.lastRestoredAt = Date.now();
                autosave.status = 'restored';
                return true;
            } catch (err) {
                autosaveLocked.value = false;
                autosave.status = 'error';
                return false;
            }
        };

        const applyProjectData = (data) => {
            nodes.value = Array.isArray(data.nodes) ? data.nodes : [];
            connections.value = Array.isArray(data.connections) ? data.connections : [];
            variables.value = Array.isArray(data.variables) ? data.variables : [];
            characters.value = Array.isArray(data.characters) ? data.characters : [];
            pan.x = data.pan?.x ?? 0;
            pan.y = data.pan?.y ?? 0;
            scale.value = data.scale ?? 1;
            currentProjectTitle.value = data.title || '';

            // Normalize loaded data
            variables.value.forEach(v => updateVariableType(v));
            const usedEntryNames = new Set();
            const nextLoadedEntryName = () => {
                let i = 1;
                while (usedEntryNames.has(`Link_${i}`)) i += 1;
                return `Link_${i}`;
            };

            nodes.value.forEach(n => {
                if (!n.data || typeof n.data !== 'object') n.data = {};
                if (n.type === 'frame') n.type = 'group';

                if (n.type === 'action') {
                    if (!Array.isArray(n.data?.ops)) n.data.ops = [];
                    n.data.ops = n.data.ops.map(op => ({ ...op, id: op.id || genId('op') }));
                    if (!n.data.ops.length) n.data.ops = [createActionOp()];
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('action');
                }
                if (n.type === 'switcher') {
                    if (!Array.isArray(n.data?.cases)) n.data.cases = [];
                    n.data.cases = n.data.cases.map(c => ({
                        ...c,
                        id: c.id || genId('case'),
                        socketId: c.socketId || genId('socket')
                    }));
                    if (!n.data.cases.length) n.data.cases = [createSwitchCase()];
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('switcher');
                }
                if (n.type === 'wait_event') {
                    if (!('eventKey' in n.data)) n.data.eventKey = '';
                    if (!('note' in n.data)) n.data.note = '';
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('wait_event');
                }
                if (n.type === 'wait_condition') {
                    if (!('varId' in n.data)) n.data.varId = null;
                    if (!('op' in n.data)) n.data.op = 'eq';
                    if (!('val' in n.data)) n.data.val = 0;
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('wait_condition');
                }
                if (n.type === 'objective_set') {
                    if (!('objectiveId' in n.data)) n.data.objectiveId = '';
                    if (!('objectiveText' in n.data)) n.data.objectiveText = '';
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('objective_set');
                }
                if (n.type === 'objective_complete' || n.type === 'objective_fail') {
                    if (!('objectiveId' in n.data)) n.data.objectiveId = '';
                    if (!('reason' in n.data)) n.data.reason = '';
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel(n.type);
                }
                if (n.type === 'quest_end') {
                    const result = String(n.data?.result || 'complete').trim().toLowerCase();
                    n.data.result = ['complete', 'fail', 'abort'].includes(result) ? result : 'complete';
                    if (!('endingNote' in n.data)) n.data.endingNote = '';
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('quest_end');
                }
                if (n.type === 'dialog') {
                    if (!Array.isArray(n.data?.choices)) n.data.choices = [];
                    if (!('speakerId' in n.data)) n.data.speakerId = null;
                    if (!('text' in n.data)) n.data.text = '';
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('dialog');
                }
                if (n.type === 'condition') {
                    if (!('varId' in n.data)) n.data.varId = null;
                    if (!('op' in n.data)) n.data.op = 'eq';
                    if (!('val' in n.data)) n.data.val = 0;
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('condition');
                }
                if (n.type === 'link_state') {
                    if (!('entryId' in n.data)) n.data.entryId = null;
                    if (!('entryName' in n.data)) n.data.entryName = '';
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('link_state');
                    n.data.entryName = normalizeEntryName(n.data.entryName);
                }
                if (n.type === 'link_entry') {
                    if (!('name' in n.data)) n.data.name = '';
                    if (!('title' in n.data)) n.data.title = '';
                    let name = normalizeEntryName(n.data.title || n.data.name);
                    if (!name) name = nextLoadedEntryName();
                    while (usedEntryNames.has(name)) {
                        name = nextLoadedEntryName();
                    }
                    usedEntryNames.add(name);
                    n.data.name = name;
                    n.data.title = name;
                }
                if (n.type === 'comment') {
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNodeTypeLabel('comment');
                    if (!('text' in n.data)) n.data.text = '';
                }
                if (n.type === 'group') {
                    if (!('title' in n.data) || !String(n.data.title).trim()) n.data.title = getNextGroupTitle();
                    n.data.color = normalizeGroupColor(n.data.color);
                    n.data.width = clampGroupWidth(n.data.width);
                    n.data.height = clampGroupHeight(n.data.height);
                    n.data.zoomTitleLock = Boolean(n.data.zoomTitleLock);
                }
            });

            nodes.value.forEach(n => {
                if (n.type !== 'link_state') return;
                const hasValidId = n.data.entryId && nodes.value.find(x => x.id === n.data.entryId && x.type === 'link_entry');
                if (hasValidId) return;
                const legacyName = normalizeEntryName(n.data.entryName);
                if (!legacyName) {
                    n.data.entryId = null;
                    return;
                }
                const found = nodes.value.find(x => x.type === 'link_entry' && normalizeEntryName(x.data?.name || x.data?.title) === legacyName);
                n.data.entryId = found ? found.id : null;
            });

            selectedNodeId.value = null;
            selectedConnId.value = null;
            clearDomCaches();
            schedulePathUpdate();
        };

        watch(
            [nodes, connections, variables, characters, () => pan.x, () => pan.y, scale, currentProjectTitle],
            () => {
                scheduleAutosave();
            },
            { deep: true }
        );
        watch(exportPanelOpen, (open) => {
            if (!open) exportValidatorDocsOpen.value = false;
        });

        const saveProject = () => {
            const payload = buildProjectPayload();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'quest_architect.json';
            a.click();
            URL.revokeObjectURL(url);
        };

        const loadProject = (e) => {
            const f = e.target.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    applyProjectData(data);
                    cloud.currentId = null;
                } catch (err) {
                    alert('Project load error');
                }
            };
            r.readAsText(f);
            e.target.value = '';
        };

        const initSupabaseAuto = () => {
            try {
                supabase.value = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            } catch (e) {
                console.error('Supabase init failed', e);
            }
        };

        const openCloudModal = async (mode) => {
            if (!supabase.value) return;
            cloud.mode = mode;
            cloud.show = true;
            if (mode === 'save') {
                cloud.saveTitle = currentProjectTitle.value || cloud.saveTitle || 'New Project';
            }
            await fetchCloudList();
        };

        const fetchCloudList = async () => {
            if (!supabase.value) return;
            cloud.loading = true;
            const { data, error } = await supabase.value
                .from('quest_projects')
                .select('id, title, created_at, updated_at')
                .order('updated_at', { ascending: false });
            if (error) {
                console.error('Cloud list error:', error);
                cloud.list = [];
            } else {
                cloud.list = data || [];
            }
            cloud.loading = false;
        };

        const saveToCloud = async () => {
            if (!supabase.value) return;
            const title = (cloud.saveTitle || '').trim();
            if (!title) {
                alert('Enter a project title');
                return;
            }

            const { data: userData, error: userErr } = await supabase.value.auth.getUser();
            if (userErr || !userData?.user) {
                alert('Not authenticated');
                return;
            }
            const userId = userData.user.id;

            let targetId = cloud.currentId;
            const existing = cloud.list.find(q => q.title === title);
            if (existing && existing.id !== cloud.currentId) {
            const ok = confirm(`Project "${title}" already exists. Overwrite?`);
                if (!ok) return;
                targetId = existing.id;
            }

            const payload = buildProjectPayload();
            payload.title = title;

            const row = {
                client_id: userId,
                title,
                data: payload,
                updated_at: new Date().toISOString()
            };
            if (targetId) row.id = targetId;

            const { data, error } = await supabase.value
                .from('quest_projects')
                .upsert(row)
                .select();

            if (error) {
                alert('Save error: ' + error.message);
                return;
            }
            if (data && data[0]) {
                cloud.currentId = data[0].id;
            }
            currentProjectTitle.value = title;
            cloud.show = false;
            fetchCloudList();
        };

        const loadFromCloud = async (questMeta) => {
            if (!supabase.value) return;
            cloud.loading = true;
            const { data, error } = await supabase.value
                .from('quest_projects')
                .select('data, title')
                .eq('id', questMeta.id)
                .single();
            if (error) {
                alert('Load error: ' + error.message);
                cloud.loading = false;
                return;
            }
            applyProjectData(data.data || {});
            currentProjectTitle.value = data.title || '';
            cloud.currentId = questMeta.id;
            cloud.saveTitle = currentProjectTitle.value || cloud.saveTitle;
            cloud.show = false;
            cloud.loading = false;
        };

        const deleteFromCloud = async (questMeta) => {
            if (!supabase.value) return;
            const ok = confirm(`Delete project "${questMeta.title}"?`);
            if (!ok) return;
            const { error } = await supabase.value
                .from('quest_projects')
                .delete()
                .eq('id', questMeta.id);
            if (error) {
                alert('Delete error: ' + error.message);
                return;
            }
            if (cloud.currentId === questMeta.id) {
                cloud.currentId = null;
                currentProjectTitle.value = '';
            }
            fetchCloudList();
        };

        // Init
        onMounted(() => {
            syncAuthFromSession();
            resetView();

            const restored = restoreAutosave();
            if (!restored) {
                const startId = 'start';
                nodes.value.push({ id: startId, type: 'start', x: 100, y: 100, data: {} });
                clearDomCaches();
                schedulePathUpdate();
            }

            // Global listeners: drag/pan/line keep working even if cursor leaves the canvas
            window.addEventListener('mousemove', onGlobalMouseMove);
            window.addEventListener('mouseup', onGlobalMouseUp);
            window.addEventListener('keydown', onGlobalKeyDown);
            window.addEventListener('keyup', onGlobalKeyUp);
            window.addEventListener('message', onAuthMessage);
            window.addEventListener('message', onExporterMessage);
            window.addEventListener('focus', syncAuthFromSession);
            document.addEventListener('visibilitychange', syncAuthFromSession);
        });

        onBeforeUnmount(() => {
            if (autosaveTimer) {
                clearTimeout(autosaveTimer);
                autosaveTimer = null;
                saveAutosaveNow();
            }
            if (pathUpdateRaf != null) {
                cancelFrame(pathUpdateRaf);
                pathUpdateRaf = null;
            }
            if (mouseMoveRaf != null) {
                cancelFrame(mouseMoveRaf);
                mouseMoveRaf = null;
            }
            if (authHintTimer) {
                clearTimeout(authHintTimer);
                authHintTimer = null;
            }
            authHintKey.value = null;
            pendingMouseMove.has = false;
            pendingPathNodeIds.clear();
            pendingPathFullUpdate = false;
            clearDomCaches();
            window.removeEventListener('mousemove', onGlobalMouseMove);
            window.removeEventListener('mouseup', onGlobalMouseUp);
            window.removeEventListener('keydown', onGlobalKeyDown);
            window.removeEventListener('keyup', onGlobalKeyUp);
            window.removeEventListener('message', onAuthMessage);
            window.removeEventListener('message', onExporterMessage);
            window.removeEventListener('focus', syncAuthFromSession);
            document.removeEventListener('visibilitychange', syncAuthFromSession);
        });

        return {
            nodes, connections, variables, characters, pan, scale, canvasContainer, loadInput,
            isAuth, cloud, currentProjectTitle,
            selectedNodeId, selectedNodeIds, selectedNode, selectedConnId,
            tab, isPlayMode, gameLog, activeNode, gameFinished,
            dragLine,
            selectionBox, hotkeyHints,
            helpPanelOpen, hotkeysPanelOpen, exportPanelOpen, exportValidatorDocsOpen, helpSections, nodeDocs, autosaveStatusText,
            authHintKey,
            formatDocText,
            editingNodeNameId, nodeNameDraft,
            hierarchySearch, hierarchyTypeFilters, filteredHierarchyRows,
            groupColorPalette,
            linkEntryOptions,
            linkPicker, hierarchyPanelOpen, hierarchyRows, graphWarnings,
            nodeConnectMenu, nodeConnectMenuEl, nodeConnectMenuTitle, connectableNodeOptions,
            
            handleWheel, onCanvasMouseDown, onCanvasContextMenu, startPan, onNodeMouseDown, startDragNode, startDragLine,
            startGroupResize,
            onGlobalMouseMove, onGlobalMouseUp, onSocketMouseUp,
            createNodeFromContext,
            addNode, deleteNode, selectNode, selectConnection, onConnectionClick,
            onLinkStateTargetChange, onLinkEntryNameInput, onLinkEntryTitleInput, startLinkPicker, jumpToLinkEntry, getLinkEntryForState, jumpToNode, toggleHierarchyPanel,
            toggleHierarchyTypeFilter, clearHierarchyFilters,
            startNodeNameEdit, commitNodeNameEdit, cancelNodeNameEdit, isNodeNameEditable, getNodeDisplayName,
            addVariable, updateVariableType, removeVariable, getVariableTypeClass, getVariableTypeLabel, getVarType, getVarOptions,
            addEnumOption, removeEnumOption,
            addActionOp, removeActionOp, onActionVarChange,
            addSwitcherCase, removeSwitcherCase, onSwitcherVarChange,
            addCharacter, removeCharacter, getCharacterName, getRuntimeDisplay,
            isSocketOccupied, canHaveInputSocket, getNodeStyle, getNodeHeaderStyle, getNodeHeaderContentStyle, setGroupColor, normalizeGroupColor, getGroupMemberCount,
            getVarName, getConditionText, getNodeIcon, getNodeTypeLabel,
            resetView, runScenario, makeChoice,
            saveProject, loadProject, triggerLoad,
            notifyAuthRequired,
            openCloudModal, saveToCloud, loadFromCloud, deleteFromCloud
        };
    }
}).mount('#app');

