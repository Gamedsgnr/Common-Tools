#!/usr/bin/env python3
"""
Quest DataAsset builder.

Converts Quest Architect exports into canonical DataAsset JSON:
  - DataAsset export (pass-through normalization)
  - Runtime export
  - Unity export
  - Debug pack (extracts one of nested exports)
  - Raw source payload (nodes + connections)

Usage:
  python quest_architect/tools/quest_dataasset_builder.py \
      --input quest_debug_pack.json \
      --output quest_dataasset_from_debug.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


RUNTIME_TYPES = {
    "start",
    "dialog",
    "action",
    "condition",
    "switcher",
    "wait_event",
    "wait_condition",
    "objective_set",
    "objective_complete",
    "objective_fail",
    "quest_end",
    "link_state",
    "link_entry",
}

DOC_TYPES = {"comment", "group", "frame"}

TYPE_NAME_MAP = {
    "start": "Start",
    "dialog": "Dialog",
    "action": "Action",
    "condition": "Condition",
    "switcher": "Switcher",
    "wait_event": "WaitEvent",
    "wait_condition": "WaitCondition",
    "objective_set": "ObjectiveSet",
    "objective_complete": "ObjectiveComplete",
    "objective_fail": "ObjectiveFail",
    "quest_end": "QuestEnd",
    "link_state": "LinkState",
    "link_entry": "LinkEntry",
    "comment": "Comment",
    "group": "Group",
    "frame": "Group",
}


def as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def to_slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower())
    cleaned = cleaned.strip("_")
    return cleaned or "quest"


def get_type_name(raw_type: str) -> str:
    t = (raw_type or "").strip().lower()
    if t in TYPE_NAME_MAP:
        return TYPE_NAME_MAP[t]
    if not t:
        return "Node"
    parts = re.split(r"[^a-zA-Z0-9]+", t)
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def parse_json_file(path: Path) -> Any:
    # utf-8-sig safely handles both plain UTF-8 and UTF-8 with BOM.
    return json.loads(path.read_text(encoding="utf-8-sig"))


def parse_maybe_json(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return None
    return None


def detect_format(payload: Any) -> str:
    p = as_dict(payload)
    if ("Schema" in p or "schema" in p) and ("Nodes" in p or "nodes" in p):
        return "dataasset"
    if isinstance(p.get("graph"), dict):
        return "runtime"
    if "nodes" in p and "connections" in p:
        return "source"
    if any(k in p for k in ("runtimeExport", "dataAssetExport", "unityExport")):
        return "debug"
    return "unknown"


def normalize_links(raw_links: Iterable[Any]) -> List[Dict[str, Any]]:
    links: List[Dict[str, Any]] = []
    for item in raw_links:
        link = as_dict(item)
        socket = str(link.get("Socket", link.get("socket", link.get("fromSocket", "default"))))
        to = str(link.get("To", link.get("to", "")))
        if not to:
            continue
        kind = str(link.get("Kind", link.get("kind", "edge")))
        links.append({"Socket": socket, "To": to, "Kind": kind})
    return links


def normalize_nodes(raw_nodes: Iterable[Any]) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    for item in raw_nodes:
        node = as_dict(item)
        node_id = str(node.get("Id", node.get("id", "")))
        if not node_id:
            continue
        raw_type = str(node.get("Type", node.get("type", "")))
        title = str(node.get("Title", node.get("title", node.get("name", ""))))
        payload = node.get("Payload", node.get("payload", node.get("data", {})))
        links = node.get("Links", node.get("links", node.get("transitions", [])))
        nodes.append(
            {
                "Id": node_id,
                "Type": get_type_name(raw_type),
                "Title": title,
                "Payload": payload if isinstance(payload, dict) else {},
                "Links": normalize_links(as_list(links)),
            }
        )
    return nodes


def normalize_dataasset(payload: Any, file_stem: str) -> Dict[str, Any]:
    p = as_dict(payload)
    schema = str(p.get("Schema", p.get("schema", "QuestDataAsset.v1")))
    quest_id = str(p.get("QuestId", p.get("questId", to_slug(file_stem))))
    display_name = str(p.get("DisplayName", p.get("displayName", quest_id)))
    start_node = str(p.get("StartNodeId", p.get("startNodeId", "")))
    variables = as_list(p.get("Variables", p.get("variables", [])))
    characters = as_list(p.get("Characters", p.get("characters", [])))
    nodes = normalize_nodes(as_list(p.get("Nodes", p.get("nodes", []))))
    return {
        "Schema": schema or "QuestDataAsset.v1",
        "QuestId": quest_id or to_slug(file_stem),
        "DisplayName": display_name or quest_id or to_slug(file_stem),
        "StartNodeId": start_node,
        "Variables": variables,
        "Characters": characters,
        "Nodes": nodes,
    }


def from_runtime(payload: Any, file_stem: str) -> Dict[str, Any]:
    p = as_dict(payload)
    graph = as_dict(p.get("graph"))
    nodes = normalize_nodes(as_list(graph.get("nodes", [])))
    quest_title = str(
        p.get("title")
        or as_dict(p.get("meta")).get("title")
        or file_stem
    )
    quest_id = str(
        p.get("questId")
        or as_dict(p.get("meta")).get("questId")
        or to_slug(quest_title)
    )
    return {
        "Schema": "QuestDataAsset.v1",
        "QuestId": quest_id,
        "DisplayName": quest_title,
        "StartNodeId": str(graph.get("startNodeId", "")),
        "Variables": as_list(p.get("variables", [])),
        "Characters": as_list(p.get("characters", [])),
        "Nodes": nodes,
    }


def from_source(
    payload: Any,
    file_stem: str,
    include_docs: bool,
    inject_link_jumps: bool,
) -> Dict[str, Any]:
    p = as_dict(payload)
    raw_nodes = as_list(p.get("nodes", []))
    raw_connections = as_list(p.get("connections", []))

    outgoing: Dict[str, List[Dict[str, Any]]] = {}
    for c_raw in raw_connections:
        c = as_dict(c_raw)
        src = str(c.get("from", "")).strip()
        dst = str(c.get("to", "")).strip()
        if not src or not dst:
            continue
        outgoing.setdefault(src, []).append(
            {
                "Socket": str(c.get("fromSocket", "default")),
                "To": dst,
                "Kind": "edge",
            }
        )

    nodes: List[Dict[str, Any]] = []
    start_node_id = ""
    for n_raw in raw_nodes:
        n = as_dict(n_raw)
        node_id = str(n.get("id", "")).strip()
        if not node_id:
            continue

        node_type = str(n.get("type", "")).strip().lower()
        if node_type in DOC_TYPES and not include_docs:
            continue
        if node_type in RUNTIME_TYPES and not start_node_id and node_type == "start":
            start_node_id = node_id

        data = as_dict(n.get("data", {}))
        title = str(data.get("title") or data.get("name") or node_type or node_id)
        links = list(outgoing.get(node_id, []))

        if inject_link_jumps and node_type == "link_state":
            entry_id = str(data.get("entryId", "")).strip()
            if entry_id and not any(l["To"] == entry_id for l in links):
                links.append({"Socket": "link", "To": entry_id, "Kind": "link_jump"})

        nodes.append(
            {
                "Id": node_id,
                "Type": get_type_name(node_type),
                "Title": title,
                "Payload": data,
                "Links": normalize_links(links),
            }
        )

    quest_title = str(p.get("title", "")).strip() or file_stem
    quest_id = str(p.get("questId", "")).strip() or to_slug(quest_title)
    if not start_node_id:
        starts = [n["Id"] for n in nodes if n["Type"] == "Start"]
        start_node_id = starts[0] if starts else ""

    return {
        "Schema": "QuestDataAsset.v1",
        "QuestId": quest_id,
        "DisplayName": quest_title,
        "StartNodeId": start_node_id,
        "Variables": as_list(p.get("variables", [])),
        "Characters": as_list(p.get("characters", [])),
        "Nodes": nodes,
    }


def pick_from_debug(payload: Any) -> Tuple[Any, str]:
    p = as_dict(payload)
    for key in ("dataAssetExport", "runtimeExport", "unityExport"):
        parsed = parse_maybe_json(p.get(key))
        if parsed is not None:
            return parsed, key
    return payload, "debug_raw"


def build_dataasset(
    payload: Any,
    source_name: str,
    force_format: Optional[str],
    include_docs: bool,
    inject_link_jumps: bool,
) -> Dict[str, Any]:
    fmt = force_format or detect_format(payload)

    if fmt == "debug":
        nested_payload, nested_kind = pick_from_debug(payload)
        nested_fmt = detect_format(nested_payload)
        if nested_fmt == "unknown":
            raise ValueError(
                f"Debug pack does not contain parseable exports (picked: {nested_kind})."
            )
        return build_dataasset(
            nested_payload,
            source_name,
            nested_fmt,
            include_docs,
            inject_link_jumps,
        )
    if fmt == "dataasset":
        return normalize_dataasset(payload, source_name)
    if fmt == "runtime":
        return from_runtime(payload, source_name)
    if fmt == "source":
        return from_source(payload, source_name, include_docs, inject_link_jumps)

    # Unity export is "schema/nodes" and is normalized by dataasset path.
    if fmt == "unity":
        return normalize_dataasset(payload, source_name)

    raise ValueError(
        "Unsupported input format. Expected one of: dataasset, runtime, unity, source, debug."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build canonical Quest DataAsset JSON from Quest Architect exports."
    )
    parser.add_argument("--input", required=True, help="Path to input JSON export.")
    parser.add_argument("--output", required=True, help="Path to output DataAsset JSON.")
    parser.add_argument(
        "--format",
        choices=["auto", "dataasset", "runtime", "unity", "source", "debug"],
        default="auto",
        help="Force input format. Default: auto detect.",
    )
    parser.add_argument(
        "--include-docs",
        action="store_true",
        help="When source payload is used, include comment/group/frame nodes.",
    )
    parser.add_argument(
        "--no-link-jumps",
        action="store_true",
        help="When source payload is used, do not inject link_state -> entryId jumps.",
    )
    parser.add_argument(
        "--quest-id",
        default="",
        help="Override QuestId in the resulting DataAsset.",
    )
    parser.add_argument(
        "--display-name",
        default="",
        help="Override DisplayName in the resulting DataAsset.",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="Write compact JSON without indentation.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    try:
        payload = parse_json_file(input_path)
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to parse input JSON: {exc}", file=sys.stderr)
        return 1

    force_format = None if args.format == "auto" else args.format
    if force_format == "unity":
        # Unity format is normalized by the same path as dataasset.
        force_format = "dataasset"

    try:
        result = build_dataasset(
            payload=payload,
            source_name=input_path.stem,
            force_format=force_format,
            include_docs=bool(args.include_docs),
            inject_link_jumps=not bool(args.no_link_jumps),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to build DataAsset: {exc}", file=sys.stderr)
        return 1

    if args.quest_id:
        result["QuestId"] = args.quest_id
    if args.display_name:
        result["DisplayName"] = args.display_name

    output_path.parent.mkdir(parents=True, exist_ok=True)
    indent = None if args.compact else 2
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=indent),
        encoding="utf-8",
    )

    print(f"DataAsset written: {output_path}")
    print(
        f"QuestId={result.get('QuestId')} | StartNodeId={result.get('StartNodeId')} | Nodes={len(as_list(result.get('Nodes')))}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
