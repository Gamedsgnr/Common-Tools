const SUPABASE_URL='https://vmwwvwtsznxwoswzdzui.supabase.co';
const SUPABASE_KEY='sb_publishable_hfVfEOEyUxTAl9TCGQLQdA_2qpquHGk';
const { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } = Vue;

createApp({
    setup() {
        const loadInput = ref(null);
        const canvasContainer = ref(null);
        const pan = reactive({ x: 0, y: 0 });
        const scale = ref(1);
        const nodes = ref([]);
        const selectedNodeId = ref(null);
        const appMode = ref('base');
        const dragNode = reactive({ id: null, dx: 0, dy: 0 });
        const dragLine = ref(null);
        const isPanning = reactive({ active: false, lastX: 0, lastY: 0 });
        const paletteDragType = ref(null);
        const currentProjectTitle = ref('');
        const activeRightTab = ref('node');
        const simulationDuration = ref(300);
        const simulationStep = ref(0.25);
        const simulationResult = ref(null);
        const simulationHoverIndex = ref(null);
        const simulationHoverCursor = reactive({ x: 0, y: 0, width: 0, height: 0 });
        const simulationLeftShell = ref(null);
        const simulationGraphCanvas = ref(null);
        const simulationChartSize = reactive({ width: 1200, height: 520 });
        const simulationTableHeight = ref(220);
        const simulationSplitterDrag = reactive({ active: false, lastY: 0 });
        const simulationFactoryCounts = reactive({});
        const simulationFactoryTab = ref('manual');
        const optimizerMode = ref('balanced');
        const optimizerTargetResourceId = ref('');
        const optimizerTargetRate = ref(0);
        const optimizerMaxCount = ref(30);
        const optimizerMaxTotalCount = ref(0);
        const optimizerFactoryCostWeight = ref(1);
        const optimizerMaxIterations = ref(80);
        const optimizerUseManualSeed = ref(false);
        const optimizerUseManualFloor = ref(false);
        const optimizerUseRandomRestart = ref(true);
        const optimizerRunning = ref(false);
        const optimizerProgressText = ref('');
        const optimizerConstraintsCollapsed = ref(true);
        const optimizerCalcParticles = ref([]);
        const optimizerHelpOpen = ref(false);
        const optimizerFactoryConfig = reactive({});
        const optimizerFixedMigrationDone = ref(false);
        const optimizerLastRun = ref(null);
        const optimizerCalcViewport = reactive({ width: 0, height: 0, lastTs: 0 });
        let optimizerCalcRaf = null;
        let connectionRebuildRaf = null;

        const editingNodeNameId = ref(null);
        const nodeNameDraft = ref('');

        const isAuth = ref(false);
        const supabase = ref(null);
        const cloud = reactive({ show:false, mode:'load', list:[], loading:false, saveTitle:'Factory Project', currentId:null });

        const rid = (p) => `${p}_${Math.random().toString(36).slice(2,8)}`;
        const fmt = (n,d=1) => Number(Number(n||0).toFixed(d)).toString();

        const selectedNode = computed(() => nodes.value.find(n => n.id===selectedNodeId.value) || null);
        const resourceNodes = computed(() => nodes.value.filter(n => n.type==='resource'));
        const factoryNodes = computed(() => nodes.value.filter(n => n.type==='factory'));
        const getNodeById = (id) => nodes.value.find(n => n.id===id) || null;
        const CONNECTION_PALETTE = ['#7dd3fc', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#fb7185', '#60a5fa', '#2dd4bf', '#f59e0b', '#22d3ee'];
        const hashString = (s) => {
            let h = 2166136261;
            const str = String(s || '');
            for (let i = 0; i < str.length; i += 1) {
                h ^= str.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return Math.abs(h >>> 0);
        };
        const getConnectionColor = (conn) => {
            const seed = `${conn.from}`;
            return CONNECTION_PALETTE[hashString(seed) % CONNECTION_PALETTE.length];
        };
        const getResourceColor = (resourceId) => CONNECTION_PALETTE[hashString(resourceId) % CONNECTION_PALETTE.length];
        const rateClass = (value) => {
            const v = Number(value || 0);
            if (v > 1e-8) return 'text-emerald-300';
            if (v < -1e-8) return 'text-rose-300';
            return 'text-slate-400';
        };
        const netRatePanelClass = (value) => {
            const v = Number(value || 0);
            if (v > 1e-8) return 'text-sky-100';
            if (v < -1e-8) return 'text-rose-100';
            return 'text-slate-200';
        };
        const summaryToneClass = (tone) => {
            if (tone === 'ok') return 'tone-ok';
            if (tone === 'warn') return 'tone-warn';
            if (tone === 'bad') return 'tone-bad';
            return 'tone-info';
        };

        const baseNetRateRows = computed(() => {
            const byId = new Map();
            resourceNodes.value.forEach(r => {
                byId.set(r.id, { id: r.id, name: r.data?.name || 'Resource', rate: 0 });
            });
            factoryNodes.value.forEach(f => {
                const cycle = Math.max(0.0001, Number(f.data?.cycle || 0));
                if (!cycle || !Number.isFinite(cycle)) return;
                (f.data.inputs || []).forEach(i => {
                    const row = byId.get(i.resourceNodeId);
                    if (!row) return;
                    row.rate -= Number(i.amount || 0) / cycle;
                });
                (f.data.outputs || []).forEach(o => {
                    const row = byId.get(o.resourceNodeId);
                    if (!row) return;
                    row.rate += Number(o.amount || 0) / cycle;
                });
            });
            return [...byId.values()]
                .filter(r => Math.abs(r.rate) > 1e-8)
                .sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
        });

        const simulationNetRateRows = computed(() => simulationResult.value?.netRateRows || []);
        const simulationTableRows = computed(() => simulationResult.value?.tableRows || []);
        const optimizerSuggestedRows = computed(() => {
            const run = optimizerLastRun.value;
            if (!run?.counts) return [];
            return factoryNodes.value
                .map(f => ({
                    id: f.id,
                    name: f.data?.name || 'Factory',
                    count: Number(run.counts[f.id] || 0)
                }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        });
        const simulationLegendRows = computed(() => {
            const result = simulationResult.value;
            if (!result) return [];
            return resourceNodes.value
                .filter(r => Array.isArray(result.series?.[r.id]))
                .map(r => ({
                    id: r.id,
                    name: r.data?.name || 'Resource',
                    color: getResourceColor(r.id)
                }));
        });
        const simulationSummary = computed(() => {
            const result = simulationResult.value;
            if (!result || !result.tableRows?.length) return ['Run simulation to generate summary'];
            const rows = result.tableRows;
            const deficits = rows
                .filter(r => r.unmet > 1e-6 || r.effectiveNet < -1e-6)
                .sort((a, b) => (b.unmet - a.unmet) || (a.effectiveNet - b.effectiveNet));
            const surpluses = rows
                .filter(r => r.unmet <= 1e-6 && r.effectiveNet > 1e-6)
                .sort((a, b) => b.effectiveNet - a.effectiveNet);
            const balanced = rows.filter(r => r.unmet <= 1e-6 && Math.abs(r.effectiveNet) <= 1e-6);
            const blocked = (result.factoryRows || []).filter(f => f.blockedRatio > 0.1).sort((a, b) => b.blockedRatio - a.blockedRatio);
            const unmetTotal = rows.reduce((sum, r) => sum + Number(r.unmet || 0), 0);
            const lines = [];
            lines.push(`Duration: ${fmt(result.duration, 1)}s, step: ${fmt(result.step, 2)}s.`);
            lines.push(deficits.length
                ? `Deficit: ${deficits.slice(0, 3).map(d => `${d.name} (unmet ${fmt(d.unmet / result.duration, 3)}/s)`).join(', ')}.`
                : 'Deficit: none.');
            lines.push(surpluses.length
                ? `Surplus: ${surpluses.slice(0, 3).map(s => `${s.name} (+${fmt(s.effectiveNet / result.duration, 3)}/s)`).join(', ')}.`
                : 'Surplus: none.');
            lines.push(blocked.length
                ? `Bottlenecks: ${blocked.slice(0, 3).map(f => `${f.name} (${fmt(f.blockedRatio * 100, 0)}% blocked)`).join(', ')}.`
                : 'Bottlenecks: no significant idle due to missing resources.');
            lines.push(`Unmet requests total: ${fmt(unmetTotal, 2)}.`);
            lines.push(`Balanced resources: ${balanced.length}.`);
            lines.push(deficits.length
                ? 'Status: imbalanced configuration for selected simulation counts.'
                : 'Status: feasible configuration, no net deficits detected.');
            return lines;
        });
        const simulationSummaryKpis = computed(() => {
            const result = simulationResult.value;
            if (!result || !result.tableRows?.length) {
                return [
                    { id: 'health', title: 'Health Score', value: 'n/a', note: 'Run simulation first', tone: 'info' },
                    { id: 'deficit', title: 'Deficit Rate', value: 'n/a', note: 'No data', tone: 'info' },
                    { id: 'bottleneck', title: 'Peak Bottleneck', value: 'n/a', note: 'No data', tone: 'info' },
                    { id: 'target', title: 'Target Fit', value: 'n/a', note: 'Set optimizer target', tone: 'info' }
                ];
            }
            const rows = result.tableRows;
            const duration = Math.max(1e-6, Number(result.duration || 1));
            const deficits = rows.filter(r => r.unmet > 1e-6 || r.effectiveNet < -1e-6);
            const deficitRate = rows.reduce((sum, r) => sum + Number(r.unmet || 0), 0) / duration;
            const balancedCount = rows.filter(r => r.unmet <= 1e-6 && Math.abs(r.effectiveNet) <= 1e-6).length;
            const blockedRows = (result.factoryRows || []).filter(f => Number(f.blockedRatio || 0) > 0);
            const peakBlocked = blockedRows.length ? Math.max(...blockedRows.map(f => Number(f.blockedRatio || 0))) : 0;
            const meanUtil = (result.factoryRows || []).length
                ? (result.factoryRows || []).reduce((s, f) => s + Number(f.utilization || 0), 0) / Math.max(1, result.factoryRows.length)
                : 0;
            const deficitPenalty = Math.min(60, (deficits.length * 7) + deficitRate * 160);
            const blockedPenalty = Math.min(25, peakBlocked * 55);
            const utilPenalty = Math.max(0, 12 - meanUtil * 12);
            const health = Math.max(0, Math.min(100, Math.round(100 - deficitPenalty - blockedPenalty - utilPenalty)));

            const targetResourceId = optimizerTargetResourceId.value || '';
            const targetRate = Math.max(0, Number(optimizerTargetRate.value || 0));
            const targetRow = targetResourceId ? rows.find(r => r.id === targetResourceId) : null;
            const actualTargetRate = targetRow ? (Number(targetRow.effectiveNet || 0) / duration) : 0;
            const targetDelta = targetRate > 0 ? (actualTargetRate - targetRate) : 0;
            const targetTolerance = Math.max(0.03, targetRate * 0.08);
            let targetTone = 'info';
            let targetValue = 'No target';
            let targetNote = 'Set target in Optimizer panel';
            if (targetRate > 0 && targetRow) {
                const pct = targetRate > 1e-9 ? (targetDelta / targetRate) * 100 : 0;
                targetValue = `${fmt(actualTargetRate, 3)}/s`;
                targetNote = `${pct >= 0 ? '+' : ''}${fmt(pct, 1)}% vs goal`;
                if (Math.abs(targetDelta) <= targetTolerance) targetTone = 'ok';
                else if (targetDelta < 0) targetTone = 'bad';
                else targetTone = 'warn';
            }

            return [
                {
                    id: 'health',
                    title: 'Health Score',
                    value: `${health}`,
                    note: `${balancedCount}/${rows.length} resources balanced`,
                    tone: health >= 80 ? 'ok' : (health >= 55 ? 'warn' : 'bad')
                },
                {
                    id: 'deficit',
                    title: 'Deficit Rate',
                    value: `${fmt(deficitRate, 3)}/s`,
                    note: deficits.length ? `${deficits.length} resources affected` : 'No unmet requests',
                    tone: deficitRate < 1e-6 ? 'ok' : (deficitRate < 0.2 ? 'warn' : 'bad')
                },
                {
                    id: 'bottleneck',
                    title: 'Peak Bottleneck',
                    value: `${fmt(peakBlocked * 100, 1)}%`,
                    note: `Avg utilization ${fmt(meanUtil * 100, 1)}%`,
                    tone: peakBlocked < 0.12 ? 'ok' : (peakBlocked < 0.35 ? 'warn' : 'bad')
                },
                {
                    id: 'target',
                    title: 'Target Fit',
                    value: targetValue,
                    note: targetNote,
                    tone: targetTone
                }
            ];
        });
        const simulationRecommendations = computed(() => {
            const result = simulationResult.value;
            if (!result || !result.tableRows?.length) {
                return [{ id: 'run', text: 'Run simulation to generate design recommendations.', tone: 'info' }];
            }
            const rows = result.tableRows;
            const duration = Math.max(1e-6, Number(result.duration || 1));
            const recs = [];

            const deficits = rows
                .filter(r => Number(r.unmet || 0) > 1e-6 || Number(r.effectiveNet || 0) < -1e-6)
                .sort((a, b) => (Number(b.unmet || 0) - Number(a.unmet || 0)) || (Number(a.effectiveNet || 0) - Number(b.effectiveNet || 0)));
            if (deficits.length) {
                const d = deficits[0];
                const neededRate = Math.max(Number(d.unmet || 0) / duration, -(Number(d.effectiveNet || 0) / duration));
                const producerOptions = factoryNodes.value
                    .map(f => {
                        const cycle = Math.max(0.1, Number(f.data?.cycle || 0));
                        const output = (f.data.outputs || []).find(o => o.resourceNodeId === d.id && Number(o.amount || 0) > 0);
                        if (!output) return null;
                        return {
                            name: f.data?.name || 'Factory',
                            rate: Number(output.amount || 0) / cycle
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b.rate - a.rate);
                if (producerOptions.length) {
                    const best = producerOptions[0];
                    const addCount = Math.max(1, Math.ceil(neededRate / Math.max(1e-6, best.rate)));
                    recs.push({
                        id: `deficit_${d.id}`,
                        tone: 'bad',
                        text: `Deficit on ${d.name}: add about +${addCount} ${best.name} (needs ~${fmt(neededRate, 3)}/s).`
                    });
                } else {
                    recs.push({
                        id: `deficit_source_${d.id}`,
                        tone: 'bad',
                        text: `Deficit on ${d.name}: no producer in graph. Add production path before consumers.`
                    });
                }
            }

            const blocked = (result.factoryRows || [])
                .filter(f => Number(f.blockedRatio || 0) > 0.2)
                .sort((a, b) => Number(b.blockedRatio || 0) - Number(a.blockedRatio || 0));
            if (blocked.length) {
                const f = blocked[0];
                recs.push({
                    id: `blocked_${f.id}`,
                    tone: 'warn',
                    text: `${f.name} blocked ${fmt(Number(f.blockedRatio || 0) * 100, 1)}% of time. Increase upstream supply or reduce downstream pull.`
                });
            }

            const surpluses = rows
                .filter(r => Number(r.unmet || 0) <= 1e-6 && Number(r.effectiveNet || 0) / duration > 0.08)
                .sort((a, b) => Number(b.effectiveNet || 0) - Number(a.effectiveNet || 0));
            if (surpluses.length) {
                const s = surpluses[0];
                recs.push({
                    id: `surplus_${s.id}`,
                    tone: 'info',
                    text: `${s.name} has stable surplus (+${fmt(Number(s.effectiveNet || 0) / duration, 3)}/s). You can reduce related factory counts to save capacity.`
                });
            }

            const targetResourceId = optimizerTargetResourceId.value || '';
            const targetRate = Math.max(0, Number(optimizerTargetRate.value || 0));
            if (targetResourceId && targetRate > 0) {
                const t = rows.find(r => r.id === targetResourceId);
                if (t) {
                    const actual = Number(t.effectiveNet || 0) / duration;
                    const delta = actual - targetRate;
                    const tolerance = Math.max(0.03, targetRate * 0.08);
                    if (delta < -tolerance) {
                        recs.push({
                            id: `target_under_${targetResourceId}`,
                            tone: 'bad',
                            text: `Target underfilled by ${fmt(-delta, 3)}/s. Increase target chain capacity until ${fmt(targetRate, 3)}/s.`
                        });
                    } else if (delta > tolerance) {
                        recs.push({
                            id: `target_over_${targetResourceId}`,
                            tone: 'warn',
                            text: `Target overshoot +${fmt(delta, 3)}/s. Reduce optional producers to free up resources.`
                        });
                    }
                }
            }

            if (!recs.length) {
                recs.push({
                    id: 'stable',
                    tone: 'ok',
                    text: 'Configuration looks stable. Try increasing target rate or reducing factory cost to find a leaner setup.'
                });
            }
            return recs.slice(0, 4);
        });
        const clampSimulationTableHeight = (height) => {
            const shellHeight = simulationLeftShell.value?.getBoundingClientRect()?.height || 920;
            const minTable = 132;
            const maxTable = Math.max(220, Math.floor(shellHeight * 0.56));
            return Math.max(minTable, Math.min(maxTable, Math.round(height)));
        };
        const updateSimulationChartSize = () => {
            const canvas = simulationGraphCanvas.value;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const width = Math.max(420, Math.floor(rect.width - 20));
            const height = Math.max(250, Math.floor(rect.height - 16));
            simulationChartSize.width = width;
            simulationChartSize.height = height;
        };
        const getCalcOverlaySize = () => {
            const rect = simulationGraphCanvas.value?.getBoundingClientRect();
            return {
                width: Math.max(260, Math.floor(rect?.width || simulationChartSize.width || 900)),
                height: Math.max(180, Math.floor(rect?.height || simulationChartSize.height || 380))
            };
        };
        const createOptimizerCalcParticles = () => {
            const { width, height } = getCalcOverlaySize();
            optimizerCalcViewport.width = width;
            optimizerCalcViewport.height = height;
            optimizerCalcViewport.lastTs = 0;
            const seeds = [];
            resourceNodes.value.forEach(r => seeds.push({ type: 'resource', icon: 'fa-solid fa-cube' }));
            factoryNodes.value.forEach(f => seeds.push({ type: 'factory', icon: 'fa-solid fa-industry' }));
            if (!seeds.length) {
                seeds.push({ type: 'resource', icon: 'fa-solid fa-cube' });
                seeds.push({ type: 'factory', icon: 'fa-solid fa-industry' });
            }
            const count = Math.min(24, Math.max(10, seeds.length * 2));
            const particles = [];
            for (let i = 0; i < count; i += 1) {
                const seed = seeds[i % seeds.length];
                const size = seed.type === 'factory' ? 28 : 24;
                let x = size + Math.random() * Math.max(10, width - size * 2);
                let y = size + Math.random() * Math.max(10, height - size * 2);
                let attempts = 0;
                while (attempts < 36) {
                    let overlap = false;
                    for (let j = 0; j < particles.length; j += 1) {
                        const p = particles[j];
                        const dx = p.x - x;
                        const dy = p.y - y;
                        if ((dx * dx + dy * dy) < ((p.size + size) * 0.5) ** 2) {
                            overlap = true;
                            break;
                        }
                    }
                    if (!overlap) break;
                    x = size + Math.random() * Math.max(10, width - size * 2);
                    y = size + Math.random() * Math.max(10, height - size * 2);
                    attempts += 1;
                }
                const angle = Math.random() * Math.PI * 2;
                const speed = 78 + Math.random() * 38;
                particles.push({
                    id: `calc_${i}_${Date.now()}`,
                    type: seed.type,
                    icon: seed.icon,
                    size,
                    x,
                    y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed
                });
            }
            optimizerCalcParticles.value = particles;
        };
        const stepOptimizerCalcParticles = (ts) => {
            if (!optimizerRunning.value) return;
            const particles = optimizerCalcParticles.value;
            if (!particles.length) {
                createOptimizerCalcParticles();
            }
            const { width, height } = getCalcOverlaySize();
            optimizerCalcViewport.width = width;
            optimizerCalcViewport.height = height;
            const prevTs = optimizerCalcViewport.lastTs || ts;
            const dt = Math.min(0.034, Math.max(0.008, (ts - prevTs) / 1000));
            optimizerCalcViewport.lastTs = ts;

            for (let i = 0; i < particles.length; i += 1) {
                const p = particles[i];
                const radius = p.size * 0.5;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                if (p.x - radius <= 0) { p.x = radius; p.vx = Math.abs(p.vx); }
                if (p.x + radius >= width) { p.x = width - radius; p.vx = -Math.abs(p.vx); }
                if (p.y - radius <= 0) { p.y = radius; p.vy = Math.abs(p.vy); }
                if (p.y + radius >= height) { p.y = height - radius; p.vy = -Math.abs(p.vy); }
            }

            for (let i = 0; i < particles.length; i += 1) {
                for (let j = i + 1; j < particles.length; j += 1) {
                    const a = particles[i];
                    const b = particles[j];
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const distSq = dx * dx + dy * dy;
                    const minDist = (a.size + b.size) * 0.5;
                    if (distSq >= minDist * minDist) continue;
                    const dist = Math.max(0.0001, Math.sqrt(distSq));
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const overlap = minDist - dist;
                    a.x -= nx * overlap * 0.5;
                    a.y -= ny * overlap * 0.5;
                    b.x += nx * overlap * 0.5;
                    b.y += ny * overlap * 0.5;

                    const vaN = a.vx * nx + a.vy * ny;
                    const vbN = b.vx * nx + b.vy * ny;
                    const vaT = -a.vx * ny + a.vy * nx;
                    const vbT = -b.vx * ny + b.vy * nx;
                    a.vx = vbN * nx - vaT * ny;
                    a.vy = vbN * ny + vaT * nx;
                    b.vx = vaN * nx - vbT * ny;
                    b.vy = vaN * ny + vbT * nx;
                }
            }

            optimizerCalcRaf = requestAnimationFrame(stepOptimizerCalcParticles);
        };
        const startOptimizerCalcAnimation = () => {
            if (optimizerCalcRaf !== null) cancelAnimationFrame(optimizerCalcRaf);
            createOptimizerCalcParticles();
            optimizerCalcRaf = requestAnimationFrame(stepOptimizerCalcParticles);
        };
        const stopOptimizerCalcAnimation = () => {
            if (optimizerCalcRaf !== null) {
                cancelAnimationFrame(optimizerCalcRaf);
                optimizerCalcRaf = null;
            }
            optimizerCalcParticles.value = [];
            optimizerCalcViewport.lastTs = 0;
        };
        const simulationChart = computed(() => {
            const result = simulationResult.value;
            if (!result || !result.times?.length) return null;
            const width = Math.max(420, simulationChartSize.width || 1200);
            const height = Math.max(250, simulationChartSize.height || 520);
            const padL = 52;
            const padR = 20;
            const padT = 18;
            const padB = 30;
            const plotW = width - padL - padR;
            const plotH = height - padT - padB;
            let minY = Infinity;
            let maxY = -Infinity;
            Object.values(result.series).forEach(values => {
                values.forEach(v => {
                    if (v < minY) minY = v;
                    if (v > maxY) maxY = v;
                });
            });
            if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
            if (Math.abs(maxY - minY) < 1e-9) {
                maxY += 1;
                minY -= 1;
            }
            const duration = Math.max(0.0001, Number(result.duration || 1));
            const mapX = (t) => padL + (Math.max(0, Math.min(duration, t)) / duration) * plotW;
            const mapY = (v) => padT + ((maxY - v) / (maxY - minY)) * plotH;
            const paths = resourceNodes.value
                .map(r => {
                    const values = result.series[r.id];
                    if (!values || !values.length) return null;
                    let d = '';
                    for (let i = 0; i < values.length; i += 1) {
                        const cmd = i === 0 ? 'M' : 'L';
                        d += `${cmd} ${mapX(result.times[i])} ${mapY(values[i])} `;
                    }
                    return {
                        id: r.id,
                        name: r.data?.name || 'Resource',
                        color: getResourceColor(r.id),
                        d: d.trim()
                    };
                })
                .filter(Boolean);
            return { width, height, padL, padR, padT, padB, plotW, plotH, minY, maxY, zeroY: mapY(0), paths };
        });
        const simulationHover = computed(() => {
            const result = simulationResult.value;
            const chart = simulationChart.value;
            const idx = simulationHoverIndex.value;
            if (!result || !chart || idx == null || idx < 0 || idx >= result.times.length) return null;
            const time = result.times[idx];
            const x = chart.padL + (time / Math.max(result.duration, 1e-6)) * chart.plotW;
            const points = resourceNodes.value
                .map(r => {
                    const values = result.series?.[r.id];
                    if (!values || idx >= values.length) return null;
                    const value = values[idx];
                    const y = chart.padT + ((chart.maxY - value) / Math.max(chart.maxY - chart.minY, 1e-6)) * chart.plotH;
                    return { id: r.id, name: r.data?.name || 'Resource', color: getResourceColor(r.id), value, y };
                })
                .filter(Boolean)
                .sort((a, b) => a.name.localeCompare(b.name));
            return { index: idx, time, x, points };
        });
        const simulationTooltipStyle = computed(() => {
            if (!simulationHover.value) return {};
            const panelW = 236;
            const panelH = 180;
            let left = simulationHoverCursor.x + 14;
            let top = simulationHoverCursor.y + 14;
            if (simulationHoverCursor.width > 0 && left + panelW > simulationHoverCursor.width - 8) {
                left = simulationHoverCursor.x - panelW - 14;
            }
            if (simulationHoverCursor.height > 0 && top + panelH > simulationHoverCursor.height - 8) {
                top = simulationHoverCursor.y - panelH - 14;
            }
            left = Math.max(8, left);
            top = Math.max(8, top);
            return { left: `${left}px`, top: `${top}px` };
        });

        const renderedConnections = ref([]);

        const getNodeStyle = (node) => ({ left: `${node.x}px`, top: `${node.y}px`, width: '300px' });
        const getSocketCenter = (nodeId, socketId) => {
            const canvasEl = canvasContainer.value;
            if (!canvasEl) return null;
            const socketEl = canvasEl.querySelector(`.socket[data-node-id="${nodeId}"][data-socket-id="${socketId}"]`);
            if (!socketEl) return null;
            const canvasRect = canvasEl.getBoundingClientRect();
            const r = socketEl.getBoundingClientRect();
            return {
                x: (r.left + r.width * 0.5 - canvasRect.left - pan.x) / scale.value,
                y: (r.top + r.height * 0.5 - canvasRect.top - pan.y) / scale.value
            };
        };
        const fallbackSocketPos = (nodeId, socket) => {
            const node = getNodeById(nodeId);
            if (!node) return { x: 0, y: 0 };
            return { x: socket === 'out' ? node.x + 300 : node.x, y: node.y + 28 };
        };
        const buildCurvePath = (fromPoint, toPoint, routeMeta = null) => {
            const a = fromPoint;
            const b = toPoint;
            const dx = b.x - a.x;
            const dir = dx >= 0 ? 1 : -1;
            const bend = Math.max(70, Math.min(220, Math.abs(dx) * 0.45));
            const c1x = a.x + bend * dir;
            const c2x = b.x - bend * dir;
            const kind = routeMeta?.kind || '';
            const biasY = kind === 'input' ? -42 : (kind === 'output' ? 42 : 0);
            return `M ${a.x} ${a.y} C ${c1x} ${a.y + biasY}, ${c2x} ${b.y + biasY}, ${b.x} ${b.y}`;
        };
        const buildRerouteBezierPath = (fromPoint, toPoint, routeMeta) => {
            const a = fromPoint;
            const b = toPoint;
            const spanLayers = Math.max(2, routeMeta?.spanLayers || 2);
            const busY = routeMeta?.trunkY ?? (Math.min(a.y, b.y) - 110);
            const nearPad = Math.max(108, Math.min(190, 92 + (spanLayers - 1) * 18));
            const inAnchor = { x: a.x + nearPad, y: busY };
            const outAnchor = { x: b.x - nearPad, y: busY };
            if (outAnchor.x <= inAnchor.x + 40) return { path: buildCurvePath(a, b, routeMeta), anchors: [] };

            const riseHandle = Math.max(28, Math.min(110, nearPad * 0.58));
            const dropHandle = riseHandle;
            const topSpan = outAnchor.x - inAnchor.x;
            const topHandle = Math.max(18, topSpan / 3);

            const parts = [
                `M ${a.x} ${a.y}`,
                // Segment 1: smooth rise/drop to near-source anchor on bus.
                `C ${a.x + riseHandle} ${a.y}, ${inAnchor.x - riseHandle} ${busY}, ${inAnchor.x} ${busY}`,
                // Segment 2: bus as straight bezier (controls on the same Y).
                `C ${inAnchor.x + topHandle} ${busY}, ${outAnchor.x - topHandle} ${busY}, ${outAnchor.x} ${busY}`,
                // Segment 3: smooth drop/rise from near-target anchor to socket.
                `C ${outAnchor.x + dropHandle} ${busY}, ${b.x - dropHandle} ${b.y}, ${b.x} ${b.y}`
            ];
            return { path: parts.join(' '), anchors: [inAnchor, outAnchor] };
        };
        const buildPathData = (fromId, toId, mouseX, mouseY, routeMeta = null) => {
            const a = getSocketCenter(fromId, 'out') || fallbackSocketPos(fromId, 'out');
            const b = toId
                ? (getSocketCenter(toId, 'in') || fallbackSocketPos(toId, 'in'))
                : { x: mouseX, y: mouseY };
            if (!toId) return { path: buildCurvePath(a, b, routeMeta), anchors: [] };
            const dx = b.x - a.x;
            const spanLayers = routeMeta?.spanLayers ?? Math.max(0, Math.round(dx / H_SPACING_CONST));
            if (dx <= 0 || spanLayers <= 1) return { path: buildCurvePath(a, b, routeMeta), anchors: [] };
            return buildRerouteBezierPath(a, b, { ...routeMeta, spanLayers });
        };
        const buildPath = (fromId, toId, mouseX, mouseY, routeMeta = null) => {
            return buildPathData(fromId, toId, mouseX, mouseY, routeMeta).path;
        };
        const rebuildRenderedConnections = () => {
            const out = [];
            factoryNodes.value.forEach(f => {
                (f.data.inputs || []).forEach((i, idx) => {
                    if (getNodeById(i.resourceNodeId)) {
                        out.push({ id: `in_${f.id}_${i.resourceNodeId}_${idx}`, from: i.resourceNodeId, to: f.id, kind: 'input' });
                    }
                });
                (f.data.outputs || []).forEach((o, idx) => {
                    if (getNodeById(o.resourceNodeId)) {
                        out.push({ id: `out_${f.id}_${o.resourceNodeId}_${idx}`, from: f.id, to: o.resourceNodeId, kind: 'output' });
                    }
                });
            });
            const nodeRect = (node) => {
                const height = node.type === 'factory' ? 260 : 96;
                return { x: node.x, y: node.y, w: 300, h: height };
            };
            const intersectsHorizontalBand = (y, minX, maxX, ignoreSet) => {
                const pad = 24;
                for (const n of nodes.value) {
                    if (ignoreSet.has(n.id)) continue;
                    const r = nodeRect(n);
                    const overlapX = r.x <= (maxX + pad) && (r.x + r.w) >= (minX - pad);
                    const overlapY = y >= (r.y - pad) && y <= (r.y + r.h + pad);
                    if (overlapX && overlapY) return true;
                }
                return false;
            };
            const topNodeInCorridor = (minX, maxX, ignoreSet) => {
                let top = Infinity;
                for (const n of nodes.value) {
                    if (ignoreSet.has(n.id)) continue;
                    const r = nodeRect(n);
                    const overlapX = r.x <= (maxX + 24) && (r.x + r.w) >= (minX - 24);
                    if (!overlapX) continue;
                    top = Math.min(top, r.y);
                }
                return top;
            };
            const bottomNodeInCorridor = (minX, maxX, ignoreSet) => {
                let bottom = -Infinity;
                for (const n of nodes.value) {
                    if (ignoreSet.has(n.id)) continue;
                    const r = nodeRect(n);
                    const overlapX = r.x <= (maxX + 24) && (r.x + r.w) >= (minX - 24);
                    if (!overlapX) continue;
                    bottom = Math.max(bottom, r.y + r.h);
                }
                return bottom;
            };
            const corridorKey = (minX, maxX) => {
                const s = Math.floor(minX / (H_SPACING_CONST * 0.8));
                const e = Math.floor(maxX / (H_SPACING_CONST * 0.8));
                return `${Math.min(s, e)}_${Math.max(s, e)}`;
            };

            const enriched = out.map(c => {
                const a = getSocketCenter(c.from, 'out') || fallbackSocketPos(c.from, 'out');
                const b = getSocketCenter(c.to, 'in') || fallbackSocketPos(c.to, 'in');
                const dx = b.x - a.x;
                const spanLayers = Math.max(0, Math.round(dx / H_SPACING_CONST));
                return {
                    ...c,
                    _a: a,
                    _b: b,
                    _dx: dx,
                    _span: spanLayers,
                    _minX: Math.min(a.x, b.x),
                    _maxX: Math.max(a.x, b.x)
                };
            });
            enriched.sort((a, b) => (b._span - a._span) || (a._minX - b._minX) || (a._a.y - b._a.y));

            const usedLaneByCorridor = new Map();
            const BUS_LANE_STEP = 64;
            const BUS_MIN_GAP = 56;
            const SPAN_LIFT_STEP = 58;
            const occupiedBusSegments = [];
            const rangesOverlap = (aMin, aMax, bMin, bMax) => aMin <= bMax && bMin <= aMax;
            const busConflict = (y, minX, maxX) => occupiedBusSegments.some(seg =>
                Math.abs(seg.y - y) < BUS_MIN_GAP && rangesOverlap(minX, maxX, seg.minX, seg.maxX)
            );
            renderedConnections.value = enriched.map(c => {
                if (c._dx <= 0 || c._span <= 1) {
                    const pathData = buildPathData(c.from, c.to, null, null, { spanLayers: c._span, kind: c.kind });
                    return { ...c, path: pathData.path, anchors: pathData.anchors, color: getConnectionColor(c) };
                }

                const minX = c._minX;
                const maxX = c._maxX;
                const ignoreSet = new Set([c.from, c.to]);
                const key = corridorKey(minX, maxX);
                const spanKey = `${key}|${c._span}`;
                const lane = usedLaneByCorridor.get(spanKey) || 0;
                usedLaneByCorridor.set(spanKey, lane + 1);

                const corridorTop = topNodeInCorridor(minX, maxX, ignoreSet);
                const corridorBottom = bottomNodeInCorridor(minX, maxX, ignoreSet);
                const minEndpointY = Math.min(c._a.y, c._b.y);
                const maxEndpointY = Math.max(c._a.y, c._b.y);
                const spanBoost = Math.max(0, c._span - 1) * SPAN_LIFT_STEP;
                const isInputFlow = c.kind === 'input';
                let trunkY;
                if (isInputFlow) {
                    trunkY = Number.isFinite(corridorTop)
                        ? (corridorTop - 96 - spanBoost - lane * BUS_LANE_STEP)
                        : (minEndpointY - 96 - spanBoost - lane * BUS_LANE_STEP);
                    trunkY = Math.min(trunkY, minEndpointY - 70);
                } else {
                    trunkY = Number.isFinite(corridorBottom)
                        ? (corridorBottom + 96 + spanBoost + lane * BUS_LANE_STEP)
                        : (maxEndpointY + 96 + spanBoost + lane * BUS_LANE_STEP);
                    trunkY = Math.max(trunkY, maxEndpointY + 70);
                }

                let guard = 0;
                while (guard < 18) {
                    const blockedByNode = intersectsHorizontalBand(trunkY, minX, maxX, ignoreSet);
                    const blockedByBus = busConflict(trunkY, minX, maxX);
                    if (!blockedByNode && !blockedByBus) break;
                    trunkY += isInputFlow ? -BUS_LANE_STEP : BUS_LANE_STEP;
                    guard += 1;
                }
                occupiedBusSegments.push({ minX, maxX, y: trunkY });

                const pathData = buildPathData(c.from, c.to, null, null, {
                    spanLayers: c._span,
                    trunkY,
                    kind: c.kind
                });
                return {
                    ...c,
                    path: pathData.path,
                    anchors: pathData.anchors,
                    color: getConnectionColor(c)
                };
            });
        };
        const scheduleConnectionRebuild = () => {
            if (connectionRebuildRaf !== null) return;
            connectionRebuildRaf = requestAnimationFrame(() => {
                connectionRebuildRaf = null;
                nextTick(rebuildRenderedConnections);
            });
        };
        const centerViewOnNodes = () => {
            if (!canvasContainer.value || !nodes.value.length) return;
            const NODE_W = 300;
            const NODE_H = 220;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            nodes.value.forEach(n => {
                minX = Math.min(minX, n.x);
                minY = Math.min(minY, n.y);
                maxX = Math.max(maxX, n.x + NODE_W);
                maxY = Math.max(maxY, n.y + NODE_H);
            });
            const graphCx = (minX + maxX) * 0.5;
            const graphCy = (minY + maxY) * 0.5;
            const rect = canvasContainer.value.getBoundingClientRect();
            const viewCx = rect.width * 0.5;
            const viewCy = rect.height * 0.5;
            pan.x = viewCx - graphCx * scale.value;
            pan.y = viewCy - graphCy * scale.value;
            scheduleConnectionRebuild();
        };
        const START_X_CONST = -360;
        const START_Y_CONST = 90;
        const H_SPACING_CONST = 420;
        const V_SPACING_CONST = 380;
        const getNextFactoryName = () => {
            let maxNum = 0;
            nodes.value.forEach(n => {
                if (n.type !== 'factory') return;
                const m = String(n.data?.name || '').match(/^Factory(?:_(\d+))?$/);
                if (!m) return;
                const num = m[1] ? Number(m[1]) : 1;
                if (num > maxNum) maxNum = num;
            });
            return `Factory_${maxNum + 1}`;
        };
        const getNextResourceName = () => {
            let maxNum = 0;
            nodes.value.forEach(n => {
                if (n.type !== 'resource') return;
                const m = String(n.data?.name || '').match(/^Resource(?:_(\d+))?$/);
                if (!m) return;
                const num = m[1] ? Number(m[1]) : 1;
                if (num > maxNum) maxNum = num;
            });
            return `Resource_${maxNum + 1}`;
        };

        const selectNode = (id) => { selectedNodeId.value = id; };
        const addNode = (type, x, y) => {
            const suggested = { x, y };
            const node = type==='resource'
                ? { id: rid('node'), type, x: suggested.x, y: suggested.y, data: { name:getNextResourceName() } }
                : { id: rid('node'), type, x: suggested.x, y: suggested.y, data: { name:getNextFactoryName(), cycle: 2, inputs: [], outputs: [] } };
            nodes.value.push(node);
            selectedNodeId.value = node.id;
            recompute();
        };
        const getViewportWorldCenter = () => {
            if (!canvasContainer.value) return { x: 0, y: 0 };
            const rect = canvasContainer.value.getBoundingClientRect();
            return {
                x: (rect.width * 0.5 - pan.x) / scale.value,
                y: (rect.height * 0.5 - pan.y) / scale.value
            };
        };
        const addNodeFromSidebar = (type) => {
            const center = getViewportWorldCenter();
            const typeCount = nodes.value.filter(n => n.type === type).length;
            const x = center.x - 150 + (type === 'factory' ? 40 : -40);
            const y = center.y - 90 + typeCount * 28;
            addNode(type, x, y);
        };
        const syncSimulationFactoryState = () => {
            const ids = new Set(factoryNodes.value.map(f => f.id));
            factoryNodes.value.forEach(f => {
                const current = Number(simulationFactoryCounts[f.id]);
                if (!Number.isFinite(current)) {
                    simulationFactoryCounts[f.id] = 1;
                    return;
                }
                simulationFactoryCounts[f.id] = Math.max(0, Math.floor(current));
            });
            Object.keys(simulationFactoryCounts).forEach(id => {
                if (!ids.has(id)) delete simulationFactoryCounts[id];
            });
        };
        const syncOptimizerFactoryState = () => {
            const parseNonNegativeInt = (value, fallback = 0) => {
                if (value === null || value === undefined || value === '') return fallback;
                const n = Number(value);
                if (!Number.isFinite(n) || n < 0) return fallback;
                return Math.floor(n);
            };
            const parseOptionalNonNegativeInt = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const n = Number(value);
                if (!Number.isFinite(n) || n < 0) return null;
                return Math.floor(n);
            };
            const ids = new Set(factoryNodes.value.map(f => f.id));
            factoryNodes.value.forEach(f => {
                if (!optimizerFactoryConfig[f.id] || typeof optimizerFactoryConfig[f.id] !== 'object') {
                    optimizerFactoryConfig[f.id] = { enabled: true, min: 0, max: 0, fixed: null };
                }
                const cfg = optimizerFactoryConfig[f.id];
                cfg.enabled = cfg.enabled !== false;
                cfg.min = parseNonNegativeInt(cfg.min, 0);
                cfg.max = parseNonNegativeInt(cfg.max, 0);
                cfg.fixed = parseOptionalNonNegativeInt(cfg.fixed);
            });
            Object.keys(optimizerFactoryConfig).forEach(id => {
                if (!ids.has(id)) delete optimizerFactoryConfig[id];
            });
            if (!optimizerFixedMigrationDone.value && factoryNodes.value.length) {
                const allZeroFixed = factoryNodes.value.every(f => {
                    const cfg = optimizerFactoryConfig[f.id];
                    return cfg && cfg.fixed === 0 && cfg.min === 0 && cfg.max === 0;
                });
                if (allZeroFixed) {
                    factoryNodes.value.forEach(f => {
                        optimizerFactoryConfig[f.id].fixed = null;
                    });
                }
                optimizerFixedMigrationDone.value = true;
            }
        };
        const getOptimizerFactoryConfig = (factoryId) => {
            if (!optimizerFactoryConfig[factoryId] || typeof optimizerFactoryConfig[factoryId] !== 'object') {
                optimizerFactoryConfig[factoryId] = { enabled: true, min: 0, max: 0, fixed: null };
            }
            return optimizerFactoryConfig[factoryId];
        };
        const ensureOptimizerTargetResource = () => {
            const ids = new Set(resourceNodes.value.map(r => r.id));
            if (!optimizerTargetResourceId.value || !ids.has(optimizerTargetResourceId.value)) {
                optimizerTargetResourceId.value = resourceNodes.value[0]?.id || '';
            }
        };
        const setAppMode = (mode) => {
            appMode.value = mode === 'simulation' ? 'simulation' : 'base';
            if (appMode.value === 'simulation') {
                syncSimulationFactoryState();
                syncOptimizerFactoryState();
                ensureOptimizerTargetResource();
                nextTick(updateSimulationChartSize);
            }
        };
        const startSimulationSplitterDrag = (e) => {
            if (appMode.value !== 'simulation') return;
            simulationSplitterDrag.active = true;
            simulationSplitterDrag.lastY = e.clientY;
            document.body.style.cursor = 'row-resize';
        };
        const onSimulationMouseMove = (e) => {
            const chart = simulationChart.value;
            const result = simulationResult.value;
            if (!chart || !result || !result.times?.length) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (!rect.width) return;
            if (Math.abs(simulationChartSize.width - rect.width) > 1 || Math.abs(simulationChartSize.height - rect.height) > 1) {
                simulationChartSize.width = Math.max(420, Math.floor(rect.width));
                simulationChartSize.height = Math.max(250, Math.floor(rect.height));
            }
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            simulationHoverCursor.x = px;
            simulationHoverCursor.y = py;
            simulationHoverCursor.width = rect.width;
            simulationHoverCursor.height = rect.height;
            const plotStart = (chart.padL / chart.width) * rect.width;
            const plotWidth = (chart.plotW / chart.width) * rect.width;
            const ratio = Math.max(0, Math.min(1, (px - plotStart) / Math.max(plotWidth, 1)));
            const idx = Math.round(ratio * (result.times.length - 1));
            simulationHoverIndex.value = idx;
        };
        const onSimulationMouseLeave = () => {
            simulationHoverIndex.value = null;
            simulationHoverCursor.x = 0;
            simulationHoverCursor.y = 0;
        };
        const waitNextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        const buildCountSnapshot = (source = simulationFactoryCounts) => {
            const snapshot = {};
            factoryNodes.value.forEach(f => {
                const raw = Number(source?.[f.id] || 0);
                snapshot[f.id] = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
            });
            return snapshot;
        };
        const simulateWithCounts = (countSource = simulationFactoryCounts, options = {}) => {
            const collectSeries = options.collectSeries !== false;
            const duration = Math.max(5, Number(simulationDuration.value || 0));
            const stepInput = Number(simulationStep.value);
            const dt = Number.isFinite(stepInput) ? Math.max(0.05, stepInput) : 0.25;
            const resources = resourceNodes.value.map(r => ({ id: r.id, name: r.data?.name || 'Resource' }));
            const stocks = {};
            const produced = {};
            const consumed = {};
            const unmet = {};
            const series = {};
            const minStock = {};
            const maxStock = {};
            resources.forEach(r => {
                stocks[r.id] = 0;
                produced[r.id] = 0;
                consumed[r.id] = 0;
                unmet[r.id] = 0;
                minStock[r.id] = 0;
                maxStock[r.id] = 0;
                if (collectSeries) series[r.id] = [];
            });

            const factories = factoryNodes.value.map(f => {
                const cycle = Math.max(0.1, Number(f.data?.cycle || 0));
                const count = Math.max(0, Math.floor(Number(countSource?.[f.id] || 0)));
                const inputs = (f.data.inputs || [])
                    .map(i => ({ resourceNodeId: i.resourceNodeId, amount: Math.max(0, Number(i.amount || 0)) }))
                    .filter(i => i.resourceNodeId && i.amount > 0);
                const outputs = (f.data.outputs || [])
                    .map(o => ({ resourceNodeId: o.resourceNodeId, amount: Math.max(0, Number(o.amount || 0)) }))
                    .filter(o => o.resourceNodeId && o.amount > 0);
                return {
                    id: f.id,
                    name: f.data?.name || 'Factory',
                    cycle,
                    count,
                    inputs,
                    outputs,
                    inProgress: [],
                    completed: 0,
                    blockedSlotTime: 0,
                    busyAccum: 0
                };
            });

            const times = [];
            const sampleEvery = Math.max(1, Math.round(0.5 / dt));
            const recordSample = (t) => {
                if (!collectSeries) return;
                times.push(Number(t.toFixed(4)));
                resources.forEach(r => {
                    series[r.id].push(stocks[r.id]);
                });
            };

            let t = 0;
            let sampleTick = 0;
            recordSample(0);
            while (t < duration - 1e-9) {
                t = Math.min(duration, t + dt);

                factories.forEach(f => {
                    if (f.count <= 0) return;
                    let completedNow = 0;
                    const remaining = [];
                    for (let i = 0; i < f.inProgress.length; i += 1) {
                        const endAt = f.inProgress[i];
                        if (endAt <= t + 1e-9) completedNow += 1;
                        else remaining.push(endAt);
                    }
                    f.inProgress = remaining;
                    if (completedNow > 0) {
                        f.completed += completedNow;
                        f.outputs.forEach(o => {
                            const delta = o.amount * completedNow;
                            stocks[o.resourceNodeId] = (stocks[o.resourceNodeId] || 0) + delta;
                            produced[o.resourceNodeId] = (produced[o.resourceNodeId] || 0) + delta;
                        });
                    }
                });

                factories.forEach(f => {
                    if (f.count <= 0) return;
                    let available = f.count - f.inProgress.length;
                    while (available > 0) {
                        let canStart = true;
                        for (let i = 0; i < f.inputs.length; i += 1) {
                            const inp = f.inputs[i];
                            if ((stocks[inp.resourceNodeId] || 0) + 1e-9 < inp.amount) {
                                canStart = false;
                                break;
                            }
                        }
                        if (!canStart) break;
                        for (let i = 0; i < f.inputs.length; i += 1) {
                            const inp = f.inputs[i];
                            stocks[inp.resourceNodeId] = Math.max(0, (stocks[inp.resourceNodeId] || 0) - inp.amount);
                            consumed[inp.resourceNodeId] = (consumed[inp.resourceNodeId] || 0) + inp.amount;
                        }
                        f.inProgress.push(t + f.cycle);
                        available -= 1;
                    }

                    if (available > 0 && f.inputs.length) {
                        const missedStarts = available * (dt / Math.max(f.cycle, 1e-6));
                        f.inputs.forEach(inp => {
                            const have = Math.max(0, Number(stocks[inp.resourceNodeId] || 0));
                            const startsPossibleByThisInput = Math.floor((have / Math.max(inp.amount, 1e-6)) + 1e-9);
                            const shortageStarts = Math.max(0, available - startsPossibleByThisInput);
                            const shortageShare = available > 0 ? (shortageStarts / available) : 0;
                            const miss = inp.amount * missedStarts * shortageShare;
                            if (miss > 0) unmet[inp.resourceNodeId] = (unmet[inp.resourceNodeId] || 0) + miss;
                        });
                        f.blockedSlotTime += available * dt;
                    }

                    const busyRatio = f.count > 0 ? f.inProgress.length / f.count : 0;
                    f.busyAccum += busyRatio * dt;
                });

                resources.forEach(r => {
                    const value = Number(stocks[r.id] || 0);
                    if (value < minStock[r.id]) minStock[r.id] = value;
                    if (value > maxStock[r.id]) maxStock[r.id] = value;
                });

                sampleTick += 1;
                if (sampleTick >= sampleEvery || t >= duration - 1e-9) {
                    recordSample(t);
                    sampleTick = 0;
                }
            }

            const tableRows = resources.map(r => {
                const prod = produced[r.id] || 0;
                const cons = consumed[r.id] || 0;
                const miss = unmet[r.id] || 0;
                const req = cons + miss;
                const net = prod - cons;
                const effectiveNet = net - miss;
                return {
                    id: r.id,
                    name: r.name,
                    produced: prod,
                    consumed: cons,
                    requested: req,
                    unmet: miss,
                    net,
                    effectiveNet,
                    finalStock: stocks[r.id] || 0,
                    min: minStock[r.id] || 0,
                    max: maxStock[r.id] || 0
                };
            });

            return {
                duration,
                step: dt,
                times: collectSeries ? times : [],
                series: collectSeries ? series : {},
                tableRows,
                netRateRows: tableRows.map(r => ({
                    id: r.id,
                    name: r.name,
                    rate: r.effectiveNet / Math.max(duration, 1e-6),
                    shortageRate: r.unmet / Math.max(duration, 1e-6)
                })),
                factoryRows: factories.map(f => ({
                    id: f.id,
                    name: f.name,
                    completed: f.completed,
                    utilization: f.busyAccum / Math.max(duration, 1e-6),
                    blockedRatio: f.blockedSlotTime / Math.max(1e-6, duration * Math.max(1, f.count))
                }))
            };
        };
        const getOptimizerScore = (result, counts, options = {}) => {
            const {
                mode = 'balanced',
                targetResourceId = '',
                targetRate = 0,
                factoryCostWeight = 1,
                baselinePositiveRate = 0
            } = options;
            const duration = Math.max(1e-6, Number(result?.duration || 0));
            const rows = result?.tableRows || [];
            const unmetRate = rows.reduce((s, r) => s + Number(r.unmet || 0), 0) / duration;
            const negativeEffectiveRate = rows.reduce((s, r) => s + Math.max(0, -(Number(r.effectiveNet || 0) / duration)), 0);
            const positiveEffectiveRate = rows.reduce((s, r) => s + Math.max(0, Number(r.effectiveNet || 0) / duration), 0);
            const targetRow = targetResourceId ? rows.find(r => r.id === targetResourceId) : null;
            const actualTargetRate = targetRow ? (Number(targetRow.effectiveNet || 0) / duration) : positiveEffectiveRate;
            const targetDeficitRate = targetResourceId ? Math.max(0, Number(targetRate || 0) - actualTargetRate) : 0;
            const targetOvershootRate = targetResourceId ? Math.max(0, actualTargetRate - Number(targetRate || 0)) : 0;
            const throughputLossRate = Math.max(0, Number(baselinePositiveRate || 0) - positiveEffectiveRate);
            const totalCount = Object.values(counts || {}).reduce((s, n) => s + Math.max(0, Number(n || 0)), 0);
            const countPenalty = totalCount * Math.max(0, Number(factoryCostWeight || 0)) * 0.18;

            if (mode === 'target_rate') {
                const underTarget = targetDeficitRate > 1e-6;
                return (
                    targetDeficitRate * 12000 +
                    unmetRate * (underTarget ? 120 : 900) +
                    negativeEffectiveRate * (underTarget ? 120 : 650) +
                    targetOvershootRate * 65 +
                    throughputLossRate * 90 +
                    countPenalty * (underTarget ? 0.25 : 0.75)
                );
            }
            if (mode === 'max_output') {
                return (
                    unmetRate * 740 +
                    negativeEffectiveRate * 480 +
                    countPenalty * 0.62 -
                    actualTargetRate * 520
                );
            }
            if (mode === 'min_deficit') {
                return (
                    unmetRate * 2300 +
                    negativeEffectiveRate * 1050 +
                    throughputLossRate * 140 +
                    countPenalty * 0.42
                );
            }
            if (mode === 'min_factories') {
                return (
                    countPenalty * 3.4 +
                    unmetRate * 1300 +
                    targetDeficitRate * 920 +
                    negativeEffectiveRate * 760
                );
            }
            return (
                unmetRate * 1500 +
                negativeEffectiveRate * 720 +
                targetDeficitRate * 240 +
                targetOvershootRate * 28 +
                throughputLossRate * 180 +
                countPenalty
            );
        };
        const runSimulation = () => {
            syncSimulationFactoryState();
            syncOptimizerFactoryState();
            ensureOptimizerTargetResource();
            nextTick(updateSimulationChartSize);
            simulationResult.value = simulateWithCounts(simulationFactoryCounts);
            simulationHoverIndex.value = null;
        };
        const buildOptimizerBounds = (baseCounts) => {
            const bounds = {};
            const globalMaxPerFactory = Math.max(1, Math.floor(Number(optimizerMaxCount.value || 30)));
            const useManualFloor = !!optimizerUseManualFloor.value;
            let minTotal = 0;
            factoryNodes.value.forEach(f => {
                const id = f.id;
                const cfg = optimizerFactoryConfig[id] || { enabled: true, min: 0, max: 0, fixed: null };
                const current = Math.max(0, Math.floor(Number(baseCounts?.[id] || 0)));
                if (cfg.enabled === false) {
                    bounds[id] = { min: 0, max: 0 };
                    return;
                }
                let min = Math.max(0, Math.floor(Number(cfg.min || 0)));
                let maxByCfg = Math.max(0, Math.floor(Number(cfg.max || 0)));
                let max = maxByCfg > 0 ? maxByCfg : globalMaxPerFactory;
                const hasFixed = cfg.fixed !== null && cfg.fixed !== undefined && cfg.fixed !== '' && Number.isFinite(Number(cfg.fixed)) && Number(cfg.fixed) >= 0;
                if (hasFixed) {
                    const fixed = Math.max(0, Math.floor(Number(cfg.fixed)));
                    min = fixed;
                    max = fixed;
                }
                if (useManualFloor) {
                    min = Math.max(min, current);
                }
                if (max < min) max = min;
                bounds[id] = { min, max };
                minTotal += min;
            });
            let maxTotal = Math.max(0, Math.floor(Number(optimizerMaxTotalCount.value || 0)));
            if (maxTotal > 0 && maxTotal < minTotal) maxTotal = minTotal;
            return { bounds, maxTotal };
        };
        const enforceBoundsAndTotals = (rawCounts, bounds, maxTotal = 0) => {
            const out = {};
            const ids = Object.keys(bounds);
            ids.forEach(id => {
                const b = bounds[id];
                const v = Math.max(0, Math.floor(Number(rawCounts?.[id] || 0)));
                out[id] = Math.min(b.max, Math.max(b.min, v));
            });
            if (maxTotal > 0) {
                let total = ids.reduce((s, id) => s + out[id], 0);
                let overflow = total - maxTotal;
                if (overflow > 0) {
                    const order = [...ids].sort((a, b) => (out[b] - bounds[b].min) - (out[a] - bounds[a].min));
                    for (let i = 0; i < order.length && overflow > 0; i += 1) {
                        const id = order[i];
                        const reducible = Math.max(0, out[id] - bounds[id].min);
                        if (reducible <= 0) continue;
                        const dec = Math.min(reducible, overflow);
                        out[id] -= dec;
                        overflow -= dec;
                    }
                }
            }
            return out;
        };
        const countsEqual = (a, b, bounds) => {
            const ids = Object.keys(bounds);
            for (let i = 0; i < ids.length; i += 1) {
                const id = ids[i];
                if (Number(a?.[id] || 0) !== Number(b?.[id] || 0)) return false;
            }
            return true;
        };
        const pushUniqueStart = (starts, candidate, bounds) => {
            if (!candidate) return;
            const normalized = candidate;
            const exists = starts.some(s => countsEqual(s, normalized, bounds));
            if (!exists) starts.push(normalized);
        };
        const buildRandomCounts = (bounds, maxTotal = 0) => {
            const ids = Object.keys(bounds);
            const counts = {};
            ids.forEach(id => { counts[id] = bounds[id].min; });
            let budget = maxTotal > 0
                ? Math.max(0, maxTotal - ids.reduce((s, id) => s + counts[id], 0))
                : Number.POSITIVE_INFINITY;
            const shuffled = [...ids].sort(() => Math.random() - 0.5);
            shuffled.forEach(id => {
                const room = Math.max(0, bounds[id].max - counts[id]);
                if (room <= 0 || budget <= 0) return;
                const cap = Number.isFinite(budget) ? Math.min(room, budget) : room;
                const add = Math.floor(Math.random() * (cap + 1));
                counts[id] += add;
                if (Number.isFinite(budget)) budget -= add;
            });
            return counts;
        };
        const buildTargetDrivenSeed = (bounds, maxTotal, targetResourceId, targetRate) => {
            if (!targetResourceId || !Number.isFinite(targetRate) || targetRate <= 0) return null;
            const ids = Object.keys(bounds);
            const counts = {};
            ids.forEach(id => { counts[id] = bounds[id].min; });
            const flowByFactory = new Map();
            const producersByResource = new Map();

            factoryNodes.value.forEach((f) => {
                if (!bounds[f.id] || bounds[f.id].max <= 0) return;
                const cycle = Math.max(0.1, Number(f.data?.cycle || 0));
                const inputs = (f.data.inputs || [])
                    .filter(i => i.resourceNodeId && Number(i.amount || 0) > 0)
                    .map(i => ({ resId: i.resourceNodeId, rate: Number(i.amount || 0) / cycle }));
                const outputs = (f.data.outputs || [])
                    .filter(o => o.resourceNodeId && Number(o.amount || 0) > 0)
                    .map(o => ({ resId: o.resourceNodeId, rate: Number(o.amount || 0) / cycle }));
                flowByFactory.set(f.id, { inputs, outputs });
                outputs.forEach((out) => {
                    if (!producersByResource.has(out.resId)) producersByResource.set(out.resId, []);
                    producersByResource.get(out.resId).push({
                        id: f.id,
                        rate: out.rate,
                        inputComplexity: inputs.length
                    });
                });
            });

            const requiredRate = new Map([[targetResourceId, targetRate]]);
            const queue = [targetResourceId];
            let guard = 0;
            while (queue.length && guard < 1500) {
                guard += 1;
                const resId = queue.shift();
                const req = Number(requiredRate.get(resId) || 0);
                if (req <= 1e-9) continue;

                const producers = [...(producersByResource.get(resId) || [])]
                    .sort((a, b) => (b.rate - a.rate) || (a.inputComplexity - b.inputComplexity));
                if (!producers.length) continue;

                let supply = 0;
                producers.forEach(p => { supply += Number(counts[p.id] || 0) * p.rate; });
                let shortfall = req - supply;
                if (shortfall <= 1e-9) continue;

                for (let i = 0; i < producers.length && shortfall > 1e-9; i += 1) {
                    const p = producers[i];
                    const b = bounds[p.id];
                    if (!b || b.max <= counts[p.id]) continue;
                    const needCount = Math.ceil(shortfall / Math.max(1e-9, p.rate));
                    let inc = Math.max(1, needCount);
                    inc = Math.min(inc, b.max - counts[p.id]);
                    if (maxTotal > 0) {
                        const total = ids.reduce((s, id) => s + Number(counts[id] || 0), 0);
                        inc = Math.min(inc, Math.max(0, maxTotal - total));
                    }
                    if (inc <= 0) continue;
                    counts[p.id] += inc;
                    shortfall -= inc * p.rate;

                    const flow = flowByFactory.get(p.id);
                    (flow?.inputs || []).forEach(inp => {
                        const addReq = inp.rate * inc;
                        requiredRate.set(inp.resId, Number(requiredRate.get(inp.resId) || 0) + addReq);
                        queue.push(inp.resId);
                    });
                }
            }
            return enforceBoundsAndTotals(counts, bounds, maxTotal);
        };
        const runFactoryOptimizer = async () => {
            if (optimizerRunning.value) return;
            syncSimulationFactoryState();
            syncOptimizerFactoryState();
            ensureOptimizerTargetResource();
            const ids = factoryNodes.value.map(f => f.id);
            if (!ids.length) {
                optimizerLastRun.value = null;
                return;
            }
            optimizerRunning.value = true;
            optimizerProgressText.value = '0%';
            startOptimizerCalcAnimation();

            try {
                const maxIterations = Math.max(1, Math.floor(Number(optimizerMaxIterations.value || 80)));
                const targetResourceId = optimizerTargetResourceId.value || '';
                const targetRate = Math.max(0, Number(optimizerTargetRate.value || 0));
                const objectiveMode = String(optimizerMode.value || 'balanced');
                const factoryCostWeight = Math.max(0, Number(optimizerFactoryCostWeight.value || 1));

                const currentCounts = buildCountSnapshot(simulationFactoryCounts);
                const { bounds, maxTotal } = buildOptimizerBounds(currentCounts);
                const baselineCounts = enforceBoundsAndTotals(currentCounts, bounds, maxTotal);
                const baselineResultForScore = simulateWithCounts(baselineCounts, { collectSeries: false });
                const baselinePositiveRate = (baselineResultForScore.tableRows || []).reduce((s, r) => s + Math.max(0, Number(r.effectiveNet || 0) / Math.max(1e-6, baselineResultForScore.duration || 1)), 0);
                const scoreOptions = {
                    mode: objectiveMode,
                    targetResourceId,
                    targetRate,
                    factoryCostWeight,
                    baselinePositiveRate
                };
                let evalCount = 0;
                const yieldStride = Math.max(10, Math.min(64, ids.length * 6));
                const updateProgress = (startIndex, totalStarts, iter, totalIter) => {
                    const phase = totalStarts > 0
                        ? `${startIndex + 1}/${totalStarts}`
                        : '1/1';
                    optimizerProgressText.value = `start ${phase} | iter ${Math.max(1, iter + 1)}/${totalIter} | eval ${evalCount}`;
                };
                const maybeYield = async (startIndex, totalStarts, iter, totalIter) => {
                    evalCount += 1;
                    if (evalCount % yieldStride !== 0) return;
                    updateProgress(startIndex, totalStarts, iter, totalIter);
                    await waitNextFrame();
                };

                const hillClimb = async (seedCounts, startIndex, totalStarts) => {
                    let bestCounts = enforceBoundsAndTotals(seedCounts, bounds, maxTotal);
                    let bestResult = simulateWithCounts(bestCounts, { collectSeries: false });
                    let bestScore = getOptimizerScore(bestResult, bestCounts, scoreOptions);
                    let used = 0;

                    for (let iter = 0; iter < maxIterations; iter += 1) {
                        let improved = false;
                        let nextCounts = bestCounts;
                        let nextResult = bestResult;
                        let nextScore = bestScore;
                        for (let idx = 0; idx < ids.length; idx += 1) {
                            const id = ids[idx];
                            const current = Number(bestCounts[id] || 0);
                            const deltas = [1, 2, -1, -2];
                            for (let d = 0; d < deltas.length; d += 1) {
                                const candidate = { ...bestCounts, [id]: current + deltas[d] };
                                const normalized = enforceBoundsAndTotals(candidate, bounds, maxTotal);
                                if (countsEqual(normalized, bestCounts, bounds)) continue;
                                const candidateResult = simulateWithCounts(normalized, { collectSeries: false });
                                const candidateScore = getOptimizerScore(candidateResult, normalized, scoreOptions);
                                if (candidateScore + 1e-9 < nextScore) {
                                    improved = true;
                                    nextCounts = normalized;
                                    nextResult = candidateResult;
                                    nextScore = candidateScore;
                                }
                                await maybeYield(startIndex, totalStarts, iter, maxIterations);
                            }
                        }
                        if (!improved && ids.length > 1) {
                            const probeCount = Math.min(22, Math.max(8, ids.length * 2));
                            for (let probe = 0; probe < probeCount; probe += 1) {
                                const candidate = { ...bestCounts };
                                const hops = Math.min(ids.length, 2 + Math.floor(Math.random() * 3));
                                for (let h = 0; h < hops; h += 1) {
                                    const id = ids[Math.floor(Math.random() * ids.length)];
                                    const deltaPool = [1, 2, 3, -1, -2];
                                    const delta = deltaPool[Math.floor(Math.random() * deltaPool.length)];
                                    candidate[id] = Number(candidate[id] || 0) + delta;
                                }
                                const normalized = enforceBoundsAndTotals(candidate, bounds, maxTotal);
                                if (countsEqual(normalized, bestCounts, bounds)) continue;
                                const candidateResult = simulateWithCounts(normalized, { collectSeries: false });
                                const candidateScore = getOptimizerScore(candidateResult, normalized, scoreOptions);
                                if (candidateScore + 1e-9 < nextScore) {
                                    improved = true;
                                    nextCounts = normalized;
                                    nextResult = candidateResult;
                                    nextScore = candidateScore;
                                    break;
                                }
                                await maybeYield(startIndex, totalStarts, iter, maxIterations);
                            }
                        }
                        if (!improved) break;
                        bestCounts = nextCounts;
                        bestResult = nextResult;
                        bestScore = nextScore;
                        used += 1;
                        updateProgress(startIndex, totalStarts, iter, maxIterations);
                        await waitNextFrame();
                    }
                    return { counts: bestCounts, result: bestResult, score: bestScore, used };
                };

                const starts = [];
                const mins = {};
                ids.forEach(id => { mins[id] = bounds[id].min; });
                pushUniqueStart(starts, enforceBoundsAndTotals(mins, bounds, maxTotal), bounds);
                if (optimizerUseManualSeed.value) {
                    pushUniqueStart(starts, enforceBoundsAndTotals(baselineCounts, bounds, maxTotal), bounds);
                }
                if (objectiveMode === 'target_rate' || objectiveMode === 'max_output') {
                    const chainSeed = buildTargetDrivenSeed(bounds, maxTotal, targetResourceId, targetRate);
                    pushUniqueStart(starts, chainSeed, bounds);
                }
                if (optimizerUseRandomRestart.value) {
                    pushUniqueStart(starts, enforceBoundsAndTotals(buildRandomCounts(bounds, maxTotal), bounds, maxTotal), bounds);
                    pushUniqueStart(starts, enforceBoundsAndTotals(buildRandomCounts(bounds, maxTotal), bounds, maxTotal), bounds);
                    pushUniqueStart(starts, enforceBoundsAndTotals(buildRandomCounts(bounds, maxTotal), bounds, maxTotal), bounds);
                }
                if (!starts.length) {
                    optimizerLastRun.value = null;
                    return;
                }

                let bestRun = null;
                for (let s = 0; s < starts.length; s += 1) {
                    updateProgress(s, starts.length, 0, maxIterations);
                    await waitNextFrame();
                    const run = await hillClimb(starts[s], s, starts.length);
                    if (!bestRun || run.score < bestRun.score) bestRun = run;
                }
                if (!bestRun) return;

                const bestCounts = bestRun.counts;
                const bestResult = simulateWithCounts(bestCounts, { collectSeries: true });
                ids.forEach(id => {
                    simulationFactoryCounts[id] = Math.max(0, Math.floor(Number(bestCounts[id] || 0)));
                });
                syncSimulationFactoryState();
                simulationResult.value = bestResult;
                simulationHoverIndex.value = null;

                const duration = Math.max(1e-6, Number(bestResult?.duration || 0));
                const rows = bestResult?.tableRows || [];
                const targetRow = targetResourceId ? rows.find(r => r.id === targetResourceId) : null;
                const unmetTotal = rows.reduce((s, r) => s + Number(r.unmet || 0), 0);
                const targetResourceName = targetResourceId
                    ? (resourceNodes.value.find(r => r.id === targetResourceId)?.data?.name || 'Target Resource')
                    : '';
                optimizerLastRun.value = {
                    mode: objectiveMode,
                    starts: starts.length,
                    iterations: bestRun.used,
                    score: bestRun.score,
                    counts: { ...bestCounts },
                    unmetTotal,
                    unmetRate: unmetTotal / duration,
                    targetResourceId,
                    targetResourceName,
                    targetRate,
                    targetActualRate: targetRow ? (Number(targetRow.effectiveNet || 0) / duration) : 0
                };
                optimizerProgressText.value = '100%';
                await waitNextFrame();
            } finally {
                optimizerRunning.value = false;
                stopOptimizerCalcAnimation();
                optimizerProgressText.value = '';
            }
        };
        const deleteNode = (id) => { nodes.value = nodes.value.filter(n => n.id!==id); factoryNodes.value.forEach(f => { f.data.inputs = (f.data.inputs || []).filter(i => i.resourceNodeId!==id); f.data.outputs = (f.data.outputs || []).filter(o => o.resourceNodeId!==id); }); if (selectedNodeId.value===id) selectedNodeId.value = null; recomputeWithLayout(); };
        const addFactoryIO = (factoryNode, key) => { factoryNode.data[key].push({ resourceNodeId: '', amount: 1 }); recompute(); };
        const recomputeAfterPropertyChange = () => { recompute(); };
        const startNodeNameEdit = (node) => {
            editingNodeNameId.value = node.id;
            nodeNameDraft.value = node.data.name || '';
        };
        const commitNodeNameEdit = (node) => {
            node.data.name = (nodeNameDraft.value || '').trim() || (node.type === 'resource' ? 'Resource' : 'Factory');
            editingNodeNameId.value = null;
            recompute();
        };
        const cancelNodeNameEdit = () => {
            editingNodeNameId.value = null;
        };

        const ensureFactoryMapping = (factoryNodeId, resourceNodeId, mode) => {
            const f = getNodeById(factoryNodeId); if (!f || f.type!=='factory') return;
            const key = mode==='input' ? 'inputs' : 'outputs';
            const list = f.data[key] || [];
            if (!list.find(i => i.resourceNodeId===resourceNodeId)) list.push({ resourceNodeId, amount: 1 });
            f.data[key] = list; recomputeWithLayout();
        };

        const startDragLine = (fromNodeId, fromSocket, e) => {
            const rect = canvasContainer.value.getBoundingClientRect();
            const x = (e.clientX - rect.left - pan.x) / scale.value;
            const y = (e.clientY - rect.top - pan.y) / scale.value;
            dragLine.value = { fromNodeId, fromSocket, path: buildPath(fromNodeId, null, x, y) };
        };
        const onSocketMouseUp = (toNodeId, toSocket) => {
            if (!dragLine.value || toSocket!=='in') return;
            const from = getNodeById(dragLine.value.fromNodeId);
            const to = getNodeById(toNodeId);
            dragLine.value = null;
            if (!from || !to || from.id===to.id) return;
            if (from.type==='resource' && to.type==='factory') return ensureFactoryMapping(to.id, from.id, 'input');
            if (from.type==='factory' && to.type==='resource') return ensureFactoryMapping(from.id, to.id, 'output');
            alert('Valid manual links: Resource -> Factory (input), Factory -> Resource (output)');
        };

        const onNodeHeaderMouseDown = (node, e) => {
            if (!canvasContainer.value) return;
            const rect = canvasContainer.value.getBoundingClientRect();
            const worldX = (e.clientX - rect.left - pan.x) / scale.value;
            const worldY = (e.clientY - rect.top - pan.y) / scale.value;
            dragNode.id = node.id;
            dragNode.dx = worldX - node.x;
            dragNode.dy = worldY - node.y;
            selectedNodeId.value = node.id;
        };
        const onMouseMove = (e) => {
            if (simulationSplitterDrag.active) {
                const dy = e.clientY - simulationSplitterDrag.lastY;
                simulationSplitterDrag.lastY = e.clientY;
                simulationTableHeight.value = clampSimulationTableHeight(simulationTableHeight.value - dy);
                nextTick(updateSimulationChartSize);
                return;
            }
            if (isPanning.active) {
                const dx = e.clientX - isPanning.lastX;
                const dy = e.clientY - isPanning.lastY;
                pan.x += dx;
                pan.y += dy;
                isPanning.lastX = e.clientX;
                isPanning.lastY = e.clientY;
            }
            if (dragNode.id) {
                const node = getNodeById(dragNode.id); if (!node) return;
                const rect = canvasContainer.value.getBoundingClientRect();
                const worldX = (e.clientX - rect.left - pan.x) / scale.value;
                const worldY = (e.clientY - rect.top - pan.y) / scale.value;
                node.x = Math.max(-4700, Math.min(4700, worldX - dragNode.dx));
                node.y = Math.max(-4700, Math.min(4700, worldY - dragNode.dy));
                scheduleConnectionRebuild();
            }
            if (dragLine.value) {
                const rect = canvasContainer.value.getBoundingClientRect();
                const x = (e.clientX - rect.left - pan.x) / scale.value;
                const y = (e.clientY - rect.top - pan.y) / scale.value;
                dragLine.value.path = buildPath(dragLine.value.fromNodeId, null, x, y);
            }
            if (isPanning.active) {
                scheduleConnectionRebuild();
            }
        };
        const onMouseUp = () => {
            dragNode.id = null;
            dragLine.value = null;
            isPanning.active = false;
            simulationSplitterDrag.active = false;
            document.body.style.cursor = '';
        };
        const onCanvasMouseDown = (e) => {
            if (e.button !== 0) return;
            const blocked = e.target.closest('input,textarea,select,button,.factory-bottom-tools,.glass-panel,.entity-card');
            if (blocked) return;
            isPanning.active = true;
            isPanning.lastX = e.clientX;
            isPanning.lastY = e.clientY;
            document.body.style.cursor = 'grabbing';
            if (e.target === canvasContainer.value || e.target.classList.contains('grid-canvas')) {
                selectedNodeId.value = null;
            }
        };

        const handleWheel = (e) => {
            if (!canvasContainer.value) return;
            const rect = canvasContainer.value.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const prev = scale.value;
            const step = e.deltaY < 0 ? 1.1 : 0.9;
            const next = Math.max(0.2, Math.min(2.5, prev * step));
            if (next === prev) return;
            const worldX = (mx - pan.x) / prev;
            const worldY = (my - pan.y) / prev;
            scale.value = next;
            pan.x = mx - worldX * next;
            pan.y = my - worldY * next;
            scheduleConnectionRebuild();
        };

        const onPaletteDragStart = (type, e) => { paletteDragType.value = type; e.dataTransfer.setData('text/plain', type); };
        const onPaletteDrop = (e) => {
            const type = e.dataTransfer.getData('text/plain') || paletteDragType.value;
            if (!type) return;
            const rect = canvasContainer.value.getBoundingClientRect();
            const x = ((e.clientX - rect.left) - pan.x) / scale.value;
            const y = ((e.clientY - rect.top) - pan.y) / scale.value;
            addNode(type, x, y); paletteDragType.value = null;
        };

        const autoLayout = () => {
            const all = nodes.value;
            if (!all.length) return;

            const H_SPACING = H_SPACING_CONST;
            const V_SPACING = V_SPACING_CONST;
            const START_X = START_X_CONST;
            const START_Y = START_Y_CONST;

            const nodeById = new Map(all.map(n => [n.id, n]));
            const adjacency = new Map(all.map(n => [n.id, new Set()]));
            const incoming = new Map(all.map(n => [n.id, new Set()]));
            const indegree = new Map(all.map(n => [n.id, 0]));
            const outdegree = new Map(all.map(n => [n.id, 0]));

            factoryNodes.value.forEach(f => {
                (f.data.inputs || []).forEach(i => {
                    if (!nodeById.has(i.resourceNodeId)) return;
                    if (!adjacency.get(i.resourceNodeId).has(f.id)) {
                        adjacency.get(i.resourceNodeId).add(f.id);
                        incoming.get(f.id).add(i.resourceNodeId);
                        indegree.set(f.id, (indegree.get(f.id) || 0) + 1);
                        outdegree.set(i.resourceNodeId, (outdegree.get(i.resourceNodeId) || 0) + 1);
                    }
                });
                (f.data.outputs || []).forEach(o => {
                    if (!nodeById.has(o.resourceNodeId)) return;
                    if (!adjacency.get(f.id).has(o.resourceNodeId)) {
                        adjacency.get(f.id).add(o.resourceNodeId);
                        incoming.get(o.resourceNodeId).add(f.id);
                        indegree.set(o.resourceNodeId, (indegree.get(o.resourceNodeId) || 0) + 1);
                        outdegree.set(f.id, (outdegree.get(f.id) || 0) + 1);
                    }
                });
            });

            const isolatedIds = new Set(all
                .map(n => n.id)
                .filter(id => (indegree.get(id) || 0) === 0 && (outdegree.get(id) || 0) === 0));

            const indegreeWalk = new Map(indegree);
            const queue = [];
            all.forEach(n => {
                if ((indegreeWalk.get(n.id) || 0) === 0 && !isolatedIds.has(n.id)) queue.push(n.id);
            });
            queue.sort((a, b) => (nodeById.get(a).y || 0) - (nodeById.get(b).y || 0));

            const layer = new Map();
            queue.forEach(id => layer.set(id, 0));
            while (queue.length) {
                const id = queue.shift();
                const base = layer.get(id) || 0;
                adjacency.get(id).forEach(nextId => {
                    layer.set(nextId, Math.max(layer.get(nextId) || 0, base + 1));
                    indegreeWalk.set(nextId, (indegreeWalk.get(nextId) || 1) - 1);
                    if (indegreeWalk.get(nextId) === 0) queue.push(nextId);
                });
            }

            let fallbackLayer = 0;
            layer.forEach(v => { fallbackLayer = Math.max(fallbackLayer, v); });
            all.forEach(n => {
                if (!layer.has(n.id) && !isolatedIds.has(n.id)) {
                    fallbackLayer += 1;
                    layer.set(n.id, fallbackLayer);
                }
            });

            const layers = new Map();
            all.forEach(n => {
                if (isolatedIds.has(n.id)) return;
                const l = layer.get(n.id) || 0;
                if (!layers.has(l)) layers.set(l, []);
                layers.get(l).push(n.id);
            });
            const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b);
            const prevY = new Map(all.map(n => [n.id, n.y || 0]));

            const avgY = (ids) => {
                if (!ids.length) return null;
                return ids.reduce((s, id) => s + (nodeById.get(id)?.y ?? prevY.get(id) ?? 0), 0) / ids.length;
            };
            const getLayoutNodeHeight = (node) => node?.type === 'resource' ? 110 : 262;
            const enforceLayerNonOverlap = (ids) => {
                ids.sort((a, b) => nodeById.get(a).y - nodeById.get(b).y);
                let lastBottom = -Infinity;
                ids.forEach((id) => {
                    const n = nodeById.get(id);
                    const h = getLayoutNodeHeight(n);
                    const minY = lastBottom + 52;
                    if (n.y < minY) n.y = minY;
                    lastBottom = n.y + h;
                });
            };

            sortedLayerKeys.forEach(l => {
                const ids = layers.get(l);
                ids.sort((a, b) => {
                    const predA = [...(incoming.get(a) || [])];
                    const predB = [...(incoming.get(b) || [])];
                    const succA = [...(adjacency.get(a) || [])];
                    const succB = [...(adjacency.get(b) || [])];
                    const pA = predA.length ? predA.reduce((s, x) => s + (prevY.get(x) || 0), 0) / predA.length : (prevY.get(a) || 0);
                    const pB = predB.length ? predB.reduce((s, x) => s + (prevY.get(x) || 0), 0) / predB.length : (prevY.get(b) || 0);
                    const sA = succA.length ? succA.reduce((s, x) => s + (prevY.get(x) || 0), 0) / succA.length : pA;
                    const sB = succB.length ? succB.reduce((s, x) => s + (prevY.get(x) || 0), 0) / succB.length : pB;
                    const scoreA = pA * 0.7 + sA * 0.3;
                    const scoreB = pB * 0.7 + sB * 0.3;
                    return scoreA - scoreB;
                });
                ids.forEach((id, idx) => {
                    const n = nodeById.get(id);
                    n.x = START_X + l * H_SPACING;
                    n.y = START_Y + idx * V_SPACING;
                });
            });

            const getTargetY = (id) => {
                const node = nodeById.get(id);
                if (!node) return null;

                const pred = [...(incoming.get(id) || [])];
                const succ = [...(adjacency.get(id) || [])];
                const predFactories = pred.filter(pid => nodeById.get(pid)?.type === 'factory');
                const succFactories = succ.filter(pid => nodeById.get(pid)?.type === 'factory');

                if (node.type === 'resource') {
                    if (predFactories.length && succFactories.length) {
                        const predY = avgY(predFactories);
                        const succY = avgY(succFactories);
                        const producedByRootFactory = predFactories.some(fid => (incoming.get(fid)?.size || 0) === 0);
                        return producedByRootFactory
                            ? predY * 0.35 + succY * 0.65
                            : predY * 0.7 + succY * 0.3;
                    }
                    if (predFactories.length) return avgY(predFactories);
                    if (succFactories.length) return avgY(succFactories);
                    if (pred.length) return avgY(pred);
                    if (succ.length) return avgY(succ);
                    return null;
                }

                if (pred.length) return avgY(pred);
                if (succ.length) return avgY(succ);
                return null;
            };

            for (let pass = 0; pass < 2; pass += 1) {
                sortedLayerKeys.forEach(l => {
                    const ids = layers.get(l);
                    ids.forEach(id => {
                        const n = nodeById.get(id);
                        const targetY = getTargetY(id);
                        if (targetY != null) n.y = n.y * 0.35 + targetY * 0.65;
                    });
                    enforceLayerNonOverlap(ids);
                });

                [...sortedLayerKeys].reverse().forEach(l => {
                    const ids = layers.get(l);
                    ids.forEach(id => {
                        const n = nodeById.get(id);
                        const targetY = getTargetY(id);
                        if (targetY != null) n.y = n.y * 0.5 + targetY * 0.5;
                    });
                    enforceLayerNonOverlap(ids);
                });
            }

            scheduleConnectionRebuild();
        };

        const recompute = () => {
            scheduleConnectionRebuild();
            syncSimulationFactoryState();
            syncOptimizerFactoryState();
            ensureOptimizerTargetResource();
        };
        const recomputeWithLayout = () => { autoLayout(); recompute(); };

        const saveProject = () => { const payload = { nodes: nodes.value, title: currentProjectTitle.value || '' }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'factory_architect_new.json'; a.click(); URL.revokeObjectURL(url); };
        const loadProject = (e) => { const f = e.target.files?.[0]; if(!f) return; const r = new FileReader(); r.onload = (ev) => { try { const d = JSON.parse(ev.target.result); nodes.value = Array.isArray(d.nodes) ? d.nodes : []; currentProjectTitle.value = d.title || ''; recompute(); nextTick(centerViewOnNodes); } catch { alert('Project load error'); } }; r.readAsText(f); e.target.value=''; };
        const triggerLoad = () => loadInput.value?.click();

        const initSupabaseAuto = () => { try { supabase.value = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch {} };
        const syncAuthFromSession = () => { const auth = sessionStorage.getItem('ct_supabase_auth')==='true'; isAuth.value = auth; if (auth && !supabase.value) initSupabaseAuto(); if (!auth) cloud.show = false; };
        const openCloudModal = async (mode) => { if (!supabase.value) return; cloud.mode = mode; cloud.show = true; if (mode==='save') cloud.saveTitle = currentProjectTitle.value || cloud.saveTitle || 'Factory Project'; await fetchCloudList(); };
        const fetchCloudList = async () => { if (!supabase.value) return; const { data, error } = await supabase.value.from('factory_projects').select('id,title,updated_at').order('updated_at', { ascending:false }); cloud.list = error ? [] : (data || []); };
        const saveToCloud = async () => { if (!supabase.value) return; const title = (cloud.saveTitle || '').trim(); if(!title) return; const { data:userData, error:userErr } = await supabase.value.auth.getUser(); if (userErr || !userData?.user) { alert('Not authenticated'); return; } let targetId = cloud.currentId; const existing = cloud.list.find(x => x.title===title); if (existing && existing.id!==cloud.currentId) { if (!confirm(`Project "${title}" exists. Overwrite?`)) return; targetId = existing.id; } const row = { client_id:userData.user.id, title, data:{ nodes:nodes.value, title }, updated_at:new Date().toISOString() }; if (targetId) row.id = targetId; const { data, error } = await supabase.value.from('factory_projects').upsert(row).select(); if (error) { alert('Save error: ' + error.message); return; } if (data && data[0]) cloud.currentId = data[0].id; currentProjectTitle.value = title; cloud.show = false; fetchCloudList(); };
        const loadFromCloud = async (meta) => { if (!supabase.value) return; const { data, error } = await supabase.value.from('factory_projects').select('data,title').eq('id', meta.id).single(); if (error) { alert('Load error: ' + error.message); return; } const d = data.data || {}; nodes.value = d.nodes || []; currentProjectTitle.value = data.title || ''; cloud.currentId = meta.id; cloud.show = false; recompute(); nextTick(centerViewOnNodes); };
        const deleteFromCloud = async (meta) => { if (!supabase.value) return; if (!confirm(`Delete project "${meta.title}"?`)) return; const { error } = await supabase.value.from('factory_projects').delete().eq('id', meta.id); if (error) { alert('Delete error: ' + error.message); return; } if (cloud.currentId===meta.id) { cloud.currentId = null; currentProjectTitle.value = ''; } fetchCloudList(); };

        const onGlobalMouseMove = (e) => onMouseMove(e);
        const onGlobalMouseUp = () => onMouseUp();
        const onGlobalResize = () => {
            simulationTableHeight.value = clampSimulationTableHeight(simulationTableHeight.value);
            nextTick(updateSimulationChartSize);
        };

        onMounted(() => {
            syncAuthFromSession();
            window.addEventListener('mousemove', onGlobalMouseMove);
            window.addEventListener('mouseup', onGlobalMouseUp);
            window.addEventListener('resize', onGlobalResize);
            window.addEventListener('message', (e) => { if (e?.data?.type==='ct_auth') syncAuthFromSession(); });
            const res1 = { id: rid('node'), type:'resource', x:-350, y:120, data:{ name:'Iron Ore' } };
            const res2 = { id: rid('node'), type:'resource', x:520, y:120, data:{ name:'Iron Ingot' } };
            const fac = { id: rid('node'), type:'factory', x:85, y:120, data:{ name:'Smelter', cycle:2, inputs:[{resourceNodeId:res1.id,amount:1}], outputs:[{resourceNodeId:res2.id,amount:1}] } };
            nodes.value = [res1, fac, res2];
            selectedNodeId.value = fac.id;
            recomputeWithLayout();
            nextTick(centerViewOnNodes);
            nextTick(updateSimulationChartSize);
        });

        onBeforeUnmount(() => {
            window.removeEventListener('mousemove', onGlobalMouseMove);
            window.removeEventListener('mouseup', onGlobalMouseUp);
            window.removeEventListener('resize', onGlobalResize);
            if (connectionRebuildRaf !== null) {
                cancelAnimationFrame(connectionRebuildRaf);
                connectionRebuildRaf = null;
            }
            stopOptimizerCalcAnimation();
        });

        return { loadInput, canvasContainer, pan, scale, nodes, selectedNodeId, selectedNode, resourceNodes, factoryNodes, renderedConnections, dragLine, currentProjectTitle, appMode, setAppMode, activeRightTab, baseNetRateRows, rateClass, netRatePanelClass, summaryToneClass, simulationDuration, simulationStep, simulationResult, simulationFactoryCounts, simulationFactoryTab, optimizerMode, optimizerTargetResourceId, optimizerTargetRate, optimizerMaxCount, optimizerMaxTotalCount, optimizerFactoryCostWeight, optimizerMaxIterations, optimizerUseManualSeed, optimizerUseManualFloor, optimizerUseRandomRestart, optimizerFactoryConfig, optimizerHelpOpen, optimizerLastRun, optimizerSuggestedRows, getOptimizerFactoryConfig, optimizerRunning, optimizerProgressText, optimizerConstraintsCollapsed, optimizerCalcParticles, simulationTableRows, simulationNetRateRows, simulationChart, simulationLegendRows, simulationHover, simulationTooltipStyle, simulationSummary, simulationSummaryKpis, simulationRecommendations, simulationLeftShell, simulationGraphCanvas, simulationTableHeight, onSimulationMouseMove, onSimulationMouseLeave, startSimulationSplitterDrag, runSimulation, runFactoryOptimizer, isAuth, cloud, fmt, editingNodeNameId, nodeNameDraft, getNodeStyle, selectNode, addNodeFromSidebar, deleteNode, addFactoryIO, recomputeAfterPropertyChange, recomputeWithLayout, startNodeNameEdit, commitNodeNameEdit, cancelNodeNameEdit, startDragLine, onSocketMouseUp, onNodeHeaderMouseDown, onCanvasMouseDown, handleWheel, onPaletteDragStart, onPaletteDrop, autoLayout, recompute, saveProject, loadProject, triggerLoad, openCloudModal, saveToCloud, loadFromCloud, deleteFromCloud };
    }
}).mount('#app');

