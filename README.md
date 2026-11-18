# Picture Elements Plus

Home Assistant's picture elements card, with a better way to add things to
your floor plan and nicer dragging when you position them.

It's the built-in card underneath, so it looks and behaves exactly the same
on your dashboard. All the changes are in the card editor:

- **Entity picker.** Search by name, entity id or room, filter by domain or
  room (grouped by floor), and see each entity's icon. Click one to add it.
  Entities already on the plan are hidden by default.
- **Sensible defaults.** With "Auto" selected, lights, switches and fans get a
  state icon that toggles on tap, sensors get a state label, people get a
  badge, and everything else gets a state icon that opens more-info. Hold
  always opens more-info. You can force a type with the "Add as" chips.
- **Drag to position.** New elements are dropped in the middle and opened
  straight away, so you can drag them into place in the preview.
- **Snapping.** Dropped elements snap to a grid (off, 0.5%, 1%, 2% or 5%, 1%
  by default) and line up with other elements when they're close to the same
  row or column. Guide lines show while dragging and turn orange when lined
  up, with the final position shown in the corner.
- **Arrow keys.** With an element selected, the arrow keys nudge it by one
  snap step. Hold Shift for five steps, or Alt for 0.1%.

Dragging itself comes from Home Assistant, which added it to the picture
elements editor in 2026.11. On older versions the picker still works, but
there's no dragging, snapping or nudging.

## Install

### From the Marketplace (recommended)

Home Assistant 2026.11 replaced HACS with the built-in Marketplace. This card
isn't in the Marketplace catalog, so add it as a custom repository:

1. Go to **Settings > Marketplace**.
2. Select **Add from link** in the upper-right corner.
3. Enter `MithUK1/picture-elements-plus` and select **Add**. If it asks for
   a type, choose **Dashboard**. You'll need to connect GitHub the first time.
4. Open **Picture Elements Plus** in the list and select **Install**.
5. Reload your browser.

The Marketplace adds the dashboard resource for you and offers new versions
under **Settings > Updates**.

### By hand

1. Copy `picture-elements-plus.js` to `/config/www/picture-elements-plus/`.
2. Go to **Settings > Dashboards**, open the three dot menu, choose
   **Resources** and add `/local/picture-elements-plus/picture-elements-plus.js`
   as a **JavaScript module**.
3. Reload your browser.

If you update the file by hand later, add `?v=2` (and so on) to the end of
the resource URL so browsers pick up the new version.

## Moving an existing card over

Open the card in the code editor and change the first line:

```yaml
type: picture-elements
```

to

```yaml
type: custom:picture-elements-plus
```

Nothing else changes. To go back, change it back.

## Options

None. The card takes exactly the same options as the built-in
[picture elements card](https://www.home-assistant.io/dashboards/picture-elements/).
The snap setting is remembered in your browser rather than saved in the card.

## Notes

- Only elements positioned with `left`/`top` percentages can be dragged
  (that's a Home Assistant rule). Ones placed with `right`, `bottom` or pixel
  values are left alone.
- Elements inside a conditional element are positioned by editing them in the
  conditional's own editor.
- The built-in "Add new element" dropdown is hidden because the picker
  replaces it. If a future Home Assistant update changes its markup, the old
  button may reappear next to the picker. Harmless, just a bit untidy.

## Releasing a new version

Bump `VERSION` at the top of `picture-elements-plus.js`, then publish a
GitHub release with a matching tag (for example `v0.2.0`). The Marketplace
picks up releases, and it checks for new ones every 48 hours on custom
repositories.
