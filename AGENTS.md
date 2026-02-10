# UI Style Rules

Before updating UI elements or creating new UI:

1. Use the "Glass System" from `style_palette.html` as the source of truth.
2. Prefer these tokens:
   - Background: `#1a1f2b`
   - Panel: `rgba(30, 41, 59, 0.45)`
   - Border: `rgba(148, 163, 184, 0.28)`
   - Text: `#dbe7f3`, muted `#9aa4b2`
   - Accent: `#7dd3fc`, strong `#3b82f6`
3. For panels/cards use glass with blur + inset contour:
   - Box-shadow: `0 18px 30px -12px rgba(2,6,23,0.7)` plus `inset 0 1px 0 rgba(255,255,255,0.22)` and `inset 0 -10px 22px rgba(2,6,23,0.32)`
4. For active list items:
   - Use the "Active Item" style in `style_palette.html` (glass + inner sheen via ::before/::after).
5. Keep rounding modest:
   - Panels/cards: `16px`
   - List items/buttons: `10px-12px`

If unsure, open `style_palette.html` and match the closest component.
