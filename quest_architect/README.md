# Quest Architect

Quest Architect is a visual quest-graph editor loaded by `QuestArchitect2.html`.

## Project Structure

- `QuestArchitect2.html` - main page markup and Vue template.
- `quest_architect/quest_architect.css` - UI styling (Glass System based panels and nodes).
- `quest_architect/quest_architect.js` - editor state, graph logic, runtime simulation, autosave, cloud operations.

## Core Concepts

- A quest is a directed graph of nodes + connections.
- Runtime traversal starts from `Start`.
- Connections are created by dragging from output sockets to compatible input sockets.
- Some node types are runtime nodes; some are documentation/layout only.

## Node Reference

1. `Start`
- Purpose: runtime entry point.
- IO: no input, one `default` output.
- Notes: should lead into first branch of your scenario.

2. `Dialog`
- Purpose: text line + player choices.
- IO: one input, dynamic choice outputs (`choice-1..N`).
- Notes: each reply creates a branch.

3. `Action`
- Purpose: mutate variables.
- IO: one input, one `default` output.
- Notes: supports numeric ops and direct assignment for bool/string/enum.

4. `Condition`
- Purpose: boolean branch.
- IO: one input, two outputs (`true`, `false`).
- Notes: compare variable against value.

5. `Switch`
- Purpose: multi-way branch.
- IO: one input, case outputs + `default`.
- Notes: useful for enums and multi-state logic.

6. `Link Entry`
- Purpose: named reusable destination.
- IO: no input, one `default` output.
- Notes: rename header to meaningful anchor name.

7. `Link State`
- Purpose: jump to selected `Link Entry`.
- IO: one input, no output.
- Notes: select target via dropdown or eyedropper; use jump action to focus target.

8. `Comment`
- Purpose: inline documentation.
- IO: no input, no output.
- Notes: ignored by runtime traversal.

9. `Group`
- Purpose: visual region for structure/documentation.
- IO: no input, no output.
- Notes: resize by corners and edges, tint in properties, always layout-only.

## Hotkeys and Interaction

- `C + Click` -> create `Condition`.
- `S + Click` -> create `Switch`.
- `A + Click` -> create `Action`.
- `D + Click` -> create `Dialog`.
- `G + Click` -> create `Group` at cursor.
- `G` with selected nodes -> wrap selection into a new Group by bounds.
- `Shift + Click` -> toggle node selection.
- `Shift + Drag` -> box selection.
- `Alt + Drag node` -> duplicate node/selection.
- `Alt + Click connection` -> delete connection.
- `Delete/Backspace` -> delete selected nodes.
- `Ctrl/Cmd + C / Ctrl/Cmd + V` -> copy/paste selected node.

## Documentation and Hierarchy

- `Docs` button opens full-screen user documentation overlay.
- Hierarchy panel supports:
  - tokenized substring search,
  - type filters,
  - warnings-only mode.
- Search checks both node names and internal content (dialog text, replies, action values, notes, etc.).

## Warnings and Safety

Warnings panel highlights risky graph states such as:

- duplicate `Link Entry` names,
- missing Link targets,
- disconnected branches,
- unreachable nodes.

Reachability logic includes `Link State -> Link Entry` chains (linked entries are treated as reachable).

## Persistence

- Local autosave is enabled (`localStorage` snapshot of graph state).
- Last session can be restored after reload/crash.
- Manual save/load to JSON is available.
- Cloud save/load is available for authenticated users (Supabase).

## Runtime Simulation

- `Run` executes traversal from `Start`.
- `Dialog` pauses and waits for player choice.
- `Action`, `Condition`, `Switch`, `Link State`, `Link Entry` continue traversal automatically.
- `Comment` and `Group` are non-runtime and only for documentation/layout.
