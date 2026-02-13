# Quest Architect

Quest Architect is a visual quest-graph editor loaded by `QuestArchitect2.html`.

## Project Structure

- `QuestArchitect2.html` - main page markup and Vue template.
- `quest_architect/quest_architect.css` - UI styling (Glass System based panels and nodes).
- `quest_architect/quest_architect.js` - editor state, graph logic, runtime simulation, autosave, cloud operations.
- `quest_architect/quest_architect_docs.html` - wiki-style UX documentation opened from `Docs`.
- `quest_architect/quest_architect_docs.css` - docs page styling.
- `quest_architect/quest_architect_docs.js` - docs page navigation behavior.

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

6. `Wait Event`
- Purpose: suspend quest flow until external runtime event is emitted.
- IO: one input, one `default` output.
- Notes: set event key (for example `quest.bandits_cleared`) and continue from default output.

7. `Call Event`
- Purpose: emit runtime event key immediately.
- IO: one input, one `default` output.
- Notes: use for direct event bridge calls (optional payload supported) and continue from default output.

8. `Wait Condition`
- Purpose: suspend quest flow until condition becomes true.
- IO: one input, one `default` output.
- Notes: same comparison model as `Condition`, but resumes only when true.

9. `Objective Set`
- Purpose: create/update objective entry in quest journal/task tracker.
- IO: one input, one `default` output.
- Notes: define `objectiveId` + objective text shown to player.

10. `Objective Complete`
- Purpose: mark objective as completed.
- IO: one input, one `default` output.
- Notes: references previously created `objectiveId`.

11. `Objective Fail`
- Purpose: mark objective as failed.
- IO: one input, one `default` output.
- Notes: supports optional reason text for logs/UI.

12. `Quest End`
- Purpose: explicit terminal node for final quest state.
- IO: one input, no output.
- Notes: use `result` (`complete/fail/abort`) and optional ending note.

13. `Link Entry`
- Purpose: named reusable destination.
- IO: no input, one `default` output.
- Notes: rename header to meaningful anchor name.

14. `Link State`
- Purpose: jump to selected `Link Entry`.
- IO: one input, no output.
- Notes: select target via dropdown or eyedropper; use jump action to focus target.

15. `Comment`
- Purpose: inline documentation.
- IO: no input, no output.
- Notes: ignored by runtime traversal.

16. `Group`
- Purpose: visual region for structure/documentation.
- IO: no input, no output.
- Notes: resize by corners and edges, tint in properties, always layout-only.

## Hotkeys and Interaction

- `C + Click` -> create `Condition`.
- `S + Click` -> create `Switch`.
- `A + Click` -> create `Action`.
- `D + Click` -> create `Dialog`.
- `E + Click` -> create `Wait Event`.
- `W + Click` -> create `Wait Condition`.
- `O + Click` -> create `Objective Set`.
- `K + Click` -> create `Objective Complete`.
- `F + Click` -> create `Objective Fail`.
- `Q + Click` -> create `Quest End`.
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
- disconnected branches / terminal dead-ends,
- missing `Quest End` or `Quest End` unreachable from `Start`,
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
- `Action`, `Condition`, `Switch`, `Call Event`, `Link State`, `Link Entry`, `Objective*` continue traversal automatically.
- `Quest End` explicitly terminates the scenario in simulator.
- `Wait Event` in simulator is treated as instantly fulfilled and continues via `default`.
- `Call Event` in simulator is treated as side-effect-only and continues via `default`.
- `Wait Condition` in simulator continues only if condition is currently true.
- `Comment` and `Group` are non-runtime and only for documentation/layout.
