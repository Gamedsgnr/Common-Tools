# Quest Architect Modules

This folder contains UI modules for `QuestArchitect2.html`.

## Files

- `quest_architect.css` - all styles previously in the page-level `<style>` block.
- `quest_architect.js` - all Vue/Supabase/runtime logic previously in the page-level inline `<script>` block.

## Entry Point

`QuestArchitect2.html` is still the page entry and now loads:

- `quest_architect/quest_architect.css`
- `quest_architect/quest_architect.js`

## Next Modular Steps

1. Split `quest_architect.js` into domain files:
   - `graph-core.js`
   - `ui-panels.js`
   - `runtime.js`
   - `persistence.js`
2. Keep `QuestArchitect2.html` focused on markup.
3. Add a lightweight build step only when needed.
