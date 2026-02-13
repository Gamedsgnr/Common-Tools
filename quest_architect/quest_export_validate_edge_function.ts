import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RUNTIME_TYPES = new Set([
  "start",
  "dialog",
  "action",
  "condition",
  "switcher",
  "link_state",
  "link_entry",
  "wait_event",
  "call_event",
  "wait_condition",
  "objective_set",
  "objective_complete",
  "objective_fail",
  "quest_end",
]);

const DOC_TYPES = new Set(["comment", "group"]);
const TERMINAL_TYPES = new Set(["objective_complete", "objective_fail", "quest_end"]);

type IssueLevel = "critical" | "warning";

type Issue = {
  level: IssueLevel;
  code: string;
  message: string;
  nodeId?: string;
  nodeTitle?: string;
  socketId?: string;
  socketLabel?: string;
};

type ValidateOptions = {
  pretty: boolean;
  includeDocs: boolean;
  includeSourceInDebug: boolean;
  localizationLocale: string;
};

type OutEdge = {
  to: string;
  socket: string;
  kind: "edge" | "link_jump";
};

type NodeNorm = {
  id: string;
  type: string;
  title: string;
  data: Record<string, any>;
};

type ValidationResult = {
  summary: {
    critical: number;
    warning: number;
    runtime: number;
    unreachable: number;
  };
  issues: Issue[];
  diagnostics: Array<{ name: string; value: string | number; note?: string }>;
  exports: {
    runtime: string;
    dataAsset: string;
    bundle: string;
    unity: string;
    debug: string;
  };
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY");
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const nowIso = () => new Date().toISOString();

function asObject(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function asArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: any, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function toNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toPascalCase(input: string): string {
  return String(input || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function slugify(input: string): string {
  const out = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return out || "quest";
}

function sanitizeLocale(input: any): string {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "ru";
  if (/^[a-z]{2,5}(-[a-z0-9]{2,5})?$/.test(raw)) return raw;
  return "ru";
}

function normalizeOptions(raw: any): ValidateOptions {
  const o = asObject(raw);
  return {
    pretty: Boolean(o.pretty ?? true),
    includeDocs: Boolean(o.includeDocs ?? false),
    includeSourceInDebug: Boolean(o.includeSourceInDebug ?? true),
    localizationLocale: sanitizeLocale(o.localizationLocale ?? "ru"),
  };
}

function json(status: number, body: Record<string, any>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function readBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

async function requireUser(token: string): Promise<{ id: string } | null> {
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id };
}

function shouldIncludeNodeType(type: string, includeDocs: boolean): boolean {
  if (RUNTIME_TYPES.has(type)) return true;
  if (includeDocs && DOC_TYPES.has(type)) return true;
  return false;
}

function getNodeTitle(node: any): string {
  const n = asObject(node);
  const d = asObject(n.data);
  return (
    asString(d.title).trim() ||
    asString(d.name).trim() ||
    asString(n.type).trim() ||
    "Node"
  );
}

function makeTextKey(questId: string, nodeId: string, suffix: string): string {
  return `quest.${slugify(questId)}.node.${slugify(nodeId)}.${slugify(suffix)}`;
}

function cloneRecord(v: any): Record<string, any> {
  return JSON.parse(JSON.stringify(asObject(v)));
}

function buildValidation(payloadRaw: any, options: ValidateOptions): ValidationResult {
  const payload = asObject(payloadRaw);

  const rawNodes = asArray<any>(payload.nodes);
  const rawConnections = asArray<any>(payload.connections);
  const rawVariables = asArray<any>(payload.variables);
  const rawCharacters = asArray<any>(payload.characters);

  const issues: Issue[] = [];
  const nodeTitleById = new Map<string, string>();
  const socketLabelById = new Map<string, string>();

  const addIssue = (
    level: IssueLevel,
    code: string,
    message: string,
    ctx: { nodeId?: string; socketId?: string } = {},
  ) => {
    const nodeId = ctx.nodeId?.trim() || "";
    const socketId = ctx.socketId?.trim() || "";

    const it: Issue = { level, code, message };
    if (nodeId) {
      it.nodeId = nodeId;
      it.nodeTitle = nodeTitleById.get(nodeId) || nodeId;
    }
    if (socketId) {
      it.socketId = socketId;
      it.socketLabel = socketLabelById.get(socketId) || socketId;
    }
    issues.push(it);
  };

  const nodes: NodeNorm[] = [];
  const nodeById = new Map<string, NodeNorm>();

  for (let i = 0; i < rawNodes.length; i += 1) {
    const n = asObject(rawNodes[i]);
    const id = asString(n.id).trim();
    const type = asString(n.type).trim().toLowerCase();
    const data = asObject(n.data);
    const title = getNodeTitle(n);

    if (!id) {
      addIssue("critical", "missing_node_id", `Node at index ${i} has no id.`);
      continue;
    }
    if (!type) {
      addIssue("critical", "missing_node_type", `Node "${id}" has no type.`, { nodeId: id });
      continue;
    }
    if (nodeById.has(id)) {
      addIssue("critical", "duplicate_node_id", `Duplicate node id "${id}".`, { nodeId: id });
      continue;
    }

    const norm: NodeNorm = { id, type, title, data };
    nodes.push(norm);
    nodeById.set(id, norm);
    nodeTitleById.set(id, title);

    if (!RUNTIME_TYPES.has(type) && !DOC_TYPES.has(type)) {
      addIssue("warning", "unknown_node_type", `Node "${id}" has unknown type "${type}".`, { nodeId: id });
    }
  }

  if (!nodes.length) {
    addIssue("critical", "no_nodes", "Payload contains no valid nodes.");
  }

  for (const n of nodes) {
    if (n.type === "dialog") {
      const choices = asArray<any>(n.data.choices);
      choices.forEach((choice, i) => {
        const socketId = `choice-${i}`;
        const txt = asString(choice?.text).trim();
        const label = txt ? `Choice "${txt}"` : `Choice #${i + 1}`;
        socketLabelById.set(socketId, `${n.title} -> ${label}`);
      });
    }
    if (n.type === "condition") {
      socketLabelById.set("true", `${n.title} -> True`);
      socketLabelById.set("false", `${n.title} -> False`);
    }
    if (n.type === "switcher") {
      const cases = asArray<any>(n.data.cases);
      cases.forEach((c, i) => {
        const socketId = asString(c?.socketId).trim();
        if (!socketId) return;
        const caseVal = c?.value == null ? "" : String(c.value).trim();
        const caseLabel = caseVal ? `Case "${caseVal}"` : `Case #${i + 1}`;
        socketLabelById.set(socketId, `${n.title} -> ${caseLabel}`);
      });
      socketLabelById.set("default", `${n.title} -> Default`);
    }
    if (
      n.type === "start" ||
      n.type === "action" ||
      n.type === "link_entry" ||
      n.type === "wait_event" ||
      n.type === "call_event" ||
      n.type === "wait_condition" ||
      n.type === "objective_set" ||
      n.type === "objective_complete" ||
      n.type === "objective_fail" ||
      n.type === "quest_end" ||
      n.type === "comment" ||
      n.type === "group"
    ) {
      socketLabelById.set("default", `${n.title} -> Next`);
    }
  }

  const variables = rawVariables
    .map((v) => asObject(v))
    .filter((v) => asString(v.id).trim())
    .map((v) => ({
      id: asString(v.id).trim(),
      name: asString(v.name).trim() || asString(v.id).trim(),
      type: asString(v.type).trim() || "num",
      init: v.init,
      options: asArray<string>(v.options),
    }));
  const variableIds = new Set(variables.map((v) => v.id));

  const characters = rawCharacters
    .map((c) => asObject(c))
    .filter((c) => asString(c.id).trim())
    .map((c) => ({
      id: asString(c.id).trim(),
      name: asString(c.name).trim() || asString(c.id).trim(),
    }));

  const starts = nodes.filter((n) => n.type === "start");
  if (starts.length === 0) {
    addIssue("critical", "missing_start", "No Start node found.");
  } else if (starts.length > 1) {
    addIssue("warning", "multiple_start", `Multiple Start nodes found (${starts.length}). Using first.`, {
      nodeId: starts[0].id,
    });
  }
  const startNodeId = starts[0]?.id || "";

  const linkEntriesById = new Map<string, NodeNorm>();
  const linkEntriesByName = new Map<string, NodeNorm>();

  for (const n of nodes) {
    if (n.type !== "link_entry") continue;
    linkEntriesById.set(n.id, n);
    const key = asString(n.data.name || n.data.title).trim();
    if (key) linkEntriesByName.set(key, n);
  }

  const outgoing = new Map<string, OutEdge[]>();
  const incomingCount = new Map<string, number>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incomingCount.set(n.id, 0);
  }

  for (let i = 0; i < rawConnections.length; i += 1) {
    const c = asObject(rawConnections[i]);
    const from = asString(c.from).trim();
    const to = asString(c.to).trim();
    const socket = asString(c.fromSocket || "default").trim() || "default";

    if (!from || !to) {
      addIssue("critical", "invalid_connection", `Connection at index ${i} has empty from/to.`);
      continue;
    }
    if (!nodeById.has(from) || !nodeById.has(to)) {
      addIssue("critical", "broken_connection", `Broken connection ${from} -> ${to} (node not found).`);
      continue;
    }

    outgoing.get(from)!.push({ to, socket, kind: "edge" });
    incomingCount.set(to, (incomingCount.get(to) || 0) + 1);
  }

  for (const n of nodes) {
    if (n.type !== "link_state") continue;

    const entryId = asString(n.data.entryId).trim();
    const entryName = asString(n.data.entryName).trim();
    let targetId = "";

    if (entryId && linkEntriesById.has(entryId)) targetId = entryId;
    else if (entryName && linkEntriesByName.has(entryName)) targetId = linkEntriesByName.get(entryName)!.id;

    if (!targetId) {
      addIssue("critical", "unresolved_link_target", `Link State "${n.id}" has unresolved target.`, { nodeId: n.id });
      continue;
    }

    outgoing.get(n.id)!.push({ to: targetId, socket: "link", kind: "link_jump" });
    incomingCount.set(targetId, (incomingCount.get(targetId) || 0) + 1);
  }

  for (const n of nodes) {
    if (n.type === "condition" || n.type === "wait_condition") {
      const varId = asString(n.data.varId).trim();
      if (!varId) addIssue("warning", "missing_condition_var", `Node "${n.id}" has empty varId.`, { nodeId: n.id });
      else if (!variableIds.has(varId)) addIssue("warning", "unknown_variable_ref", `Node "${n.id}" references unknown variable "${varId}".`, { nodeId: n.id });
    }

    if (n.type === "wait_event" || n.type === "call_event") {
      const eventKey = asString(n.data.eventKey).trim();
      if (!eventKey) addIssue("warning", "missing_event_key", `Node "${n.id}" has empty eventKey.`, { nodeId: n.id });
    }

    if (n.type === "objective_set" || n.type === "objective_complete" || n.type === "objective_fail") {
      const objectiveId = asString(n.data.objectiveId).trim();
      if (!objectiveId) addIssue("warning", "missing_objective_id", `Node "${n.id}" has empty objectiveId.`, { nodeId: n.id });
    }

    if (n.type === "dialog") {
      const choices = asArray<any>(n.data.choices);
      const outs = outgoing.get(n.id) || [];
      choices.forEach((_, i) => {
        const socketId = `choice-${i}`;
        const has = outs.some((e) => e.socket === socketId);
        if (!has) {
          addIssue("warning", "dialog_choice_unlinked", `Dialog "${n.id}" choice ${i} has no outgoing connection.`, {
            nodeId: n.id,
            socketId,
          });
        }
      });
    }

    if (n.type === "condition") {
      const outs = outgoing.get(n.id) || [];
      if (!outs.some((e) => e.socket === "true")) {
        addIssue("warning", "missing_true_branch", `Condition "${n.id}" has no "true" branch.`, {
          nodeId: n.id,
          socketId: "true",
        });
      }
      if (!outs.some((e) => e.socket === "false")) {
        addIssue("warning", "missing_false_branch", `Condition "${n.id}" has no "false" branch.`, {
          nodeId: n.id,
          socketId: "false",
        });
      }
    }

    if (n.type === "switcher") {
      const outs = outgoing.get(n.id) || [];
      const cases = asArray<any>(n.data.cases);
      const caseSockets = cases.map((c) => asString(c?.socketId).trim()).filter(Boolean);

      const hasCaseOut = caseSockets.some((s) => outs.some((o) => o.socket === s));
      const hasDefault = outs.some((o) => o.socket === "default");

      if (!hasCaseOut && !hasDefault) {
        addIssue("warning", "switcher_no_branches", `Switcher "${n.id}" has no outgoing branches.`, {
          nodeId: n.id,
        });
      }

      for (const s of caseSockets) {
        if (!outs.some((o) => o.socket === s)) {
          addIssue("warning", "switcher_case_unlinked", `Switcher "${n.id}" case socket "${s}" is not connected.`, {
            nodeId: n.id,
            socketId: s,
          });
        }
      }
    }

    if (n.type === "link_entry" && (incomingCount.get(n.id) || 0) === 0) {
      addIssue("warning", "orphan_link_entry", `Link Entry "${n.id}" has no incoming links.`, { nodeId: n.id });
    }
  }

  const includedNodes = nodes.filter((n) => shouldIncludeNodeType(n.type, options.includeDocs));
  const includedNodeIds = new Set(includedNodes.map((n) => n.id));
  const outFiltered = (id: string) => (outgoing.get(id) || []).filter((e) => includedNodeIds.has(e.to));

  const reachable = new Set<string>();
  if (startNodeId && includedNodeIds.has(startNodeId)) {
    const stack = [startNodeId];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of outFiltered(id)) {
        if (!reachable.has(e.to)) stack.push(e.to);
      }
    }
  }

  let unreachableCount = 0;
  for (const n of includedNodes) {
    if (!reachable.has(n.id)) {
      unreachableCount += 1;
      addIssue("warning", "unreachable_node", `Node "${n.id}" is unreachable from Start.`, { nodeId: n.id });
    }
  }

  for (const n of includedNodes) {
    if (DOC_TYPES.has(n.type)) continue;
    if (TERMINAL_TYPES.has(n.type)) continue;
    if ((outFiltered(n.id).length === 0)) {
      addIssue("warning", "dead_end", `Node "${n.id}" is a dead-end.`, { nodeId: n.id });
    }
  }

  const color = new Map<string, 0 | 1 | 2>();
  const cycleNodes = new Set<string>();

  const visit = (id: string) => {
    color.set(id, 1);
    for (const e of outFiltered(id)) {
      const c = color.get(e.to) || 0;
      if (c === 0) visit(e.to);
      else if (c === 1) cycleNodes.add(e.to);
    }
    color.set(id, 2);
  };

  for (const n of includedNodes) {
    if ((color.get(n.id) || 0) === 0) visit(n.id);
  }

  for (const id of cycleNodes) {
    addIssue("warning", "cycle_detected", `Cycle detected involving node "${id}".`, { nodeId: id });
  }

  const runtimeNodeCount = includedNodes.length;
  const runtimeEdgeCount = includedNodes.reduce((acc, n) => acc + outFiltered(n.id).length, 0);
  const branchNodes = includedNodes.filter((n) => outFiltered(n.id).length > 1).length;
  const leafNodes = includedNodes.filter((n) => outFiltered(n.id).length === 0).length;
  const avgOutDegree = runtimeNodeCount ? Number((runtimeEdgeCount / runtimeNodeCount).toFixed(2)) : 0;

  let approxMaxDepth = 0;
  if (startNodeId && includedNodeIds.has(startNodeId)) {
    const dist = new Map<string, number>();
    const q = [startNodeId];
    dist.set(startNodeId, 0);

    while (q.length) {
      const id = q.shift()!;
      const base = dist.get(id) || 0;
      if (base > approxMaxDepth) approxMaxDepth = base;

      for (const e of outFiltered(id)) {
        if (!dist.has(e.to)) {
          dist.set(e.to, base + 1);
          q.push(e.to);
        }
      }
    }
  }

  const diagnostics = [
    { name: "Runtime Nodes", value: runtimeNodeCount, note: "Nodes included in export." },
    { name: "Runtime Edges", value: runtimeEdgeCount, note: "Connections including link jumps." },
    { name: "Avg Out Degree", value: avgOutDegree, note: "Average outgoing edges per node." },
    { name: "Branch Nodes", value: branchNodes, note: "Nodes with >1 outgoing edge." },
    { name: "Leaf Nodes", value: leafNodes, note: "Nodes with no outgoing edge." },
    { name: "Approx Max Depth", value: approxMaxDepth, note: "Max BFS depth from Start." },
  ];

  const transitionsFor = (id: string) =>
    outFiltered(id).map((e) => ({
      socket: e.socket,
      to: e.to,
      kind: e.kind,
    }));

  const runtimeNodes = includedNodes.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    data: n.data,
    transitions: transitionsFor(n.id),
  }));

  const questId = slugify(asString(payload.title || ""));
  const displayName = asString(payload.title || "Untitled Quest");

  const localizationEntries = new Map<string, string>();

  const addLocalization = (key: string, text: string, nodeId: string) => {
    const cleanText = asString(text).trim();
    const cleanKey = asString(key).trim();
    if (!cleanText || !cleanKey) return;
    const existing = localizationEntries.get(cleanKey);
    if (existing && existing !== cleanText) {
      addIssue("warning", "loc_key_conflict", `Localization key conflict for "${cleanKey}".`, { nodeId });
      return;
    }
    localizationEntries.set(cleanKey, cleanText);
  };

  const localizePayload = (nodeType: string, nodeId: string, sourceData: Record<string, any>) => {
    const out = cloneRecord(sourceData);

    if (nodeType === "dialog") {
      const text = asString(out.text).trim();
      if (text) {
        const textKey = makeTextKey(questId, nodeId, "text");
        addLocalization(textKey, text, nodeId);
        delete out.text;
        out.textKey = textKey;
      }

      const choices = asArray<any>(out.choices);
      out.choices = choices.map((choice, index) => {
        const c = cloneRecord(choice);
        const choiceText = asString(c.text).trim();
        if (choiceText) {
          const choiceKey = makeTextKey(questId, nodeId, `choice_${index}`);
          addLocalization(choiceKey, choiceText, nodeId);
          delete c.text;
          c.textKey = choiceKey;
        }
        return c;
      });
      return out;
    }

    if (nodeType === "objective_set") {
      const objectiveText = asString(out.objectiveText).trim();
      if (objectiveText) {
        const key = makeTextKey(questId, nodeId, "objective_text");
        addLocalization(key, objectiveText, nodeId);
        delete out.objectiveText;
        out.objectiveTextKey = key;
      }
      return out;
    }

    if (nodeType === "objective_complete" || nodeType === "objective_fail") {
      const reason = asString(out.reason).trim();
      if (reason) {
        const key = makeTextKey(questId, nodeId, "reason");
        addLocalization(key, reason, nodeId);
        delete out.reason;
        out.reasonKey = key;
      }
      return out;
    }

    if (nodeType === "quest_end") {
      const endingNote = asString(out.endingNote).trim();
      if (endingNote) {
        const key = makeTextKey(questId, nodeId, "ending_note");
        addLocalization(key, endingNote, nodeId);
        delete out.endingNote;
        out.endingNoteKey = key;
      }
      return out;
    }

    return out;
  };

  const runtimeExportObj = {
    meta: {
      schema: "QuestRuntime.v1",
      generatedAt: nowIso(),
      title: asString(payload.title || ""),
      version: toNumber(payload.version, 1),
    },
    graph: {
      startNodeId: startNodeId || "",
      nodes: runtimeNodes,
    },
    variables: variables.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      init: v.init,
      options: v.options,
    })),
    characters,
  };

  const dataAssetExportObj = {
    Schema: "QuestDataAsset.v2",
    GeneratedAt: nowIso(),
    QuestId: questId,
    DisplayName: displayName,
    StartNodeId: startNodeId || "",
    Variables: variables.map((v) => ({
      Id: v.id,
      Name: v.name,
      Type: toPascalCase(v.type),
      InitialValue: v.init,
      Options: v.options,
    })),
    Characters: characters.map((c) => ({
      Id: c.id,
      Name: c.name,
    })),
    Nodes: runtimeNodes.map((n) => ({
      Id: n.id,
      Type: toPascalCase(n.type),
      Title: n.title,
      Payload: localizePayload(n.type, n.id, asObject(n.data)),
      Links: n.transitions.map((t) => ({
        Socket: t.socket,
        To: t.to,
        Kind: t.kind,
      })),
    })),
  };

  const stringTableExportObj = {
    Schema: "QuestStringTable.v1",
    GeneratedAt: nowIso(),
    TableId: `ST_Quest_${questId}`,
    Namespace: `quest.${questId}`,
    Locale: options.localizationLocale,
    Entries: Array.from(localizationEntries.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([Key, Text]) => ({ Key, Text })),
  };

  const bundleExportObj = {
    Schema: "QuestExportBundle.v1",
    GeneratedAt: nowIso(),
    QuestId: questId,
    DisplayName: displayName,
    Locale: options.localizationLocale,
    DataAsset: dataAssetExportObj,
    StringTable: stringTableExportObj,
  };

  const unityExportObj = {
    schema: "QuestUnity.v1",
    generatedAt: nowIso(),
    questId,
    displayName,
    startNodeId: startNodeId || "",
    variables: variables.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      initialValue: v.init,
      options: v.options,
    })),
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    nodes: runtimeNodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      payload: n.data,
      links: n.transitions,
    })),
  };

  issues.sort((a, b) => {
    if (a.level === b.level) return 0;
    return a.level === "critical" ? -1 : 1;
  });

  const summary = {
    critical: issues.filter((i) => i.level === "critical").length,
    warning: issues.filter((i) => i.level === "warning").length,
    runtime: runtimeNodeCount,
    unreachable: unreachableCount,
  };

  const debugExportObj: Record<string, any> = {
    meta: {
      schema: "QuestDebugPack.v2",
      generatedAt: nowIso(),
      title: asString(payload.title || ""),
    },
    summary,
    issues,
    diagnostics,
    runtimeExport: runtimeExportObj,
    dataAssetExport: dataAssetExportObj,
    bundleExport: bundleExportObj,
    unityExport: unityExportObj,
  };

  if (options.includeSourceInDebug) {
    debugExportObj.sourcePayload = payload;
  }

  const space = options.pretty ? 2 : 0;

  return {
    summary,
    issues,
    diagnostics,
    exports: {
      runtime: JSON.stringify(runtimeExportObj, null, space),
      dataAsset: JSON.stringify(dataAssetExportObj, null, space),
      bundle: JSON.stringify(bundleExportObj, null, space),
      unity: JSON.stringify(unityExportObj, null, space),
      debug: JSON.stringify(debugExportObj, null, space),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const token = readBearerToken(req);
    if (!token) return json(401, { ok: false, error: "Missing bearer token" });

    const user = await requireUser(token);
    if (!user) return json(401, { ok: false, error: "Invalid or expired token" });

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    if (!body || typeof body !== "object") {
      return json(400, { ok: false, error: "Request body must be an object" });
    }

    if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      return json(400, { ok: false, error: "Field 'payload' must be an object" });
    }

    const options = normalizeOptions(body.options);
    const result = buildValidation(body.payload, options);

    return json(200, {
      ok: true,
      summary: result.summary,
      issues: result.issues,
      diagnostics: result.diagnostics,
      exports: result.exports,
    });
  } catch (err) {
    console.error("quest-export-validate error:", err);
    return json(500, { ok: false, error: "Internal server error" });
  }
});
