# Picture Elements Plus

Home Assistant's picture elements card, with a better way to put things on
your floor plan and a few extras the built-in card doesn't have.

It's the built-in card underneath, so on your dashboard it looks and behaves
the same, and any picture elements YAML you already have keeps working.

- [What it adds](#what-it-adds)
- [Install](#install)
- [Moving an existing card over](#moving-an-existing-card-over)
- [Using the editor](#using-the-editor)
- [Options](#options)
- [Text on the plan](#text-on-the-plan)
- [Showing elements only sometimes](#showing-elements-only-sometimes)
- [Full example](#full-example)
- [Troubleshooting](#troubleshooting)
- [Releasing a new version](#releasing-a-new-version)

## What it adds

**On the card**

- **Plan size.** Show the plan bigger or smaller than the card while the
  icons stay the same size. That's how you fix icons that are too big or too
  small for your plan.
- **Icon colours.** One colour for every icon on the plan, and another for
  when they're on.
- **Visibility per element.** Hide any element unless some conditions are
  met, for example only show someone's PC when they're home.
- **Text.** Put labels like "Loft" anywhere on the plan and drag them about.
  Text can also be a template, like the current temperature.

**In the editor**

- **Entity picker.** Search by name, entity id or room. You can also filter
  by type (with a Helpers filter that groups all your helpers) or by room,
  grouped by floor. Click an entity to add it.
- **Sensible defaults.** Lights, switches and fans toggle when tapped.
  Sensors show their value and people show as badges.
- **Drag to position**, with snapping and guide lines:
  - an orange line when you're level with another element
  - a purple line when you're on a quarter or half-way line of the plan
  - the position you'll drop at, and the plan's size in pixels
- **Arrow keys** to nudge the selected element.

Dragging comes from Home Assistant itself, which added it to the picture
elements editor in 2026.11. On older versions everything else works, but
there's no dragging, snapping or nudging.

## Install

### From the Marketplace (recommended)

Home Assistant 2026.11 replaced HACS with the built-in Marketplace. This card
isn't in the Marketplace catalogue, so add it from a link:

1. Go to **Settings > Marketplace**.
2. Select **Add from link** in the upper-right corner.
3. Enter `MithUK1/picture-elements-plus` and select **Add**. If it asks for
   a type, choose **Dashboard**. You'll need to connect GitHub the first time.
4. Open **Picture Elements Plus** in the list and select **Install**.
5. Reload your browser.

The Marketplace adds the dashboard resource for you. New versions appear
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

Edit the card, select **Show code editor**, and change the first line from

```yaml
type: picture-elements
```

to

```yaml
type: custom:picture-elements-plus
```

Then switch back to the visual editor. Nothing else needs to change, and you
can switch back the same way. If you used any of the extra options below,
take those out when switching back.

## Using the editor

### Picking a floor plan

A new card starts with a placeholder plan, and **Card options** is opened
for you. Under **Image** you can upload a picture or pick one from your
media. You can also use a camera there instead.

### Adding things

The **Add to plan** panel sits under the list of elements.

1. Type in the search box, or filter by type or room. Entities already on
   the plan are hidden unless you untick **Hide ones already on the plan**.
   Hidden and diagnostic entities are left out unless you tick
   **Include hidden & diagnostic**.
2. Pick how it should be added with **Add as**. **Auto** chooses for you:
   - **State badge** for people, device trackers and zones
   - **State label** for sensors, so you see the value
   - **State icon** for everything else

   Lights, switches, fans, input booleans, sirens and humidifiers toggle on
   tap. Everything else opens more-info on tap. Holding always opens
   more-info.
3. Click the entity, or press Enter to add the top result.

**Other** adds things that aren't tied to an entity: text, an icon, an
image, an action button or a conditional group.

Helpers and template entities are ordinary entities, so they show up like
anything else. **Helpers** filters to just your helpers (input booleans,
numbers, selects, texts, date/times, buttons, counters, timers and
schedules).

### Moving things

- **Drag** an element in the preview. A new element is opened as soon as
  it's added, so you can drag it straight into place.
- **Click** an element to open it. With one open, clicking on the plan moves
  it there.
- **Arrow keys** nudge the open element by one snap step. Hold **Shift** for
  five steps, or **Alt** for 0.1%.

While dragging, guide lines show where you'll land:

| Line | Meaning |
| --- | --- |
| Grey dashed | Where the element will drop |
| Orange | Level with another element |
| Purple | On a quarter or half-way line of the plan |

The chip in the top-left corner shows the position, and the one in the
bottom-left shows the plan's size in pixels.

**Snap** (at the bottom of the picker) sets the grid: off, 0.5%, 1%, 2% or
5%. Lining up with another element or a quarter line wins over the grid.
The setting is remembered in your browser and isn't saved in the card.

Only elements positioned with `left` and `top` in percent can be dragged.
That's a Home Assistant rule. Ones placed with `right`, `bottom` or pixels are
left alone. Elements inside a conditional group are moved in the group's own
editor.

### Plan style

The **Plan style** panel holds the card-wide options described below. **Back
to HA's normal size and colours** clears them all.

## Options

Everything the built-in
[picture elements card](https://www.home-assistant.io/dashboards/picture-elements/)
takes, plus:

| Option | What it does | Example |
| --- | --- | --- |
| `plan_size` | Width of the plan as a percentage of the card. Below 100 the plan is centred and the icons look bigger on it. Above 100 it's bigger than the card, the icons look smaller on it, and the card scrolls sideways. | `plan_size: 150` |
| `icon_color` | Colour of every icon on the plan. A theme colour name or any CSS colour. | `icon_color: blue-grey` |
| `active_color` | Colour of icons when their entity is on, open, home and so on. This replaces HA's own colours, including the light's colour. | `active_color: amber` |

Theme colour names are the ones in HA's colour picker: `primary`, `accent`,
`red`, `pink`, `purple`, `deep-purple`, `indigo`, `blue`, `light-blue`,
`cyan`, `teal`, `green`, `light-green`, `lime`, `yellow`, `amber`, `orange`,
`deep-orange`, `brown`, `light-grey`, `grey`, `dark-grey`, `blue-grey`,
`black` and `white`.

An element can still have its own colour in its `style`, which wins. State
icons also have `state_color: false` to turn colouring off.

## Text on the plan

Add text with **Other > Text**, then drag it into place. Its editor has the
text, size, colour and bold. In YAML it looks like this:

```yaml
- type: custom:picture-elements-plus-text
  text: Loft
  size: 3          # percent of the plan's width, so it scales with the plan
  color: amber     # optional, theme colour name or CSS colour
  bold: true       # optional
  style:
    left: 22%
    top: 48%
```

Text containing `{{ }}` or `{% %}` is treated as a template and updates by
itself:

```yaml
- type: custom:picture-elements-plus-text
  text: "{{ states('sensor.loft_temperature') }}°C"
  size: 2.5
  style:
    left: 22%
    top: 53%
```

Text does nothing when tapped on the dashboard.

## Showing elements only sometimes

Open an element in the editor and use the **Visibility** panel under its
settings. The conditions are the same ones the Visibility tab uses for
cards: entity state, numeric state, screen size, user, and "and"/"or"
groups. The element only shows when all of them are true.

If the panel says the condition editor isn't loaded, open the
**Visibility** tab at the top of the dialog once and come back.

In YAML, add a `visibility` list to the element:

```yaml
- type: state-icon
  entity: binary_sensor.donna_pc
  icon: mdi:desktop-classic
  visibility:
    - condition: state
      entity: person.donna
      state: home
  style:
    left: 62%
    top: 87%
```

While you're editing, every element stays on the plan so you can still move
it. Ones with visibility conditions are shown faded.

## Full example

```yaml
type: custom:picture-elements-plus
image: /local/jpg/Newton_G.png
plan_size: 120
icon_color: blue-grey
active_color: amber
elements:
  - type: custom:picture-elements-plus-text
    text: Kitchen
    size: 3
    bold: true
    style: { left: 18%, top: 22% }
  - type: state-icon
    entity: light.kitchen_light_1
    icon: mdi:lightbulb-spot
    tap_action: { action: toggle }
    hold_action: { action: more-info }
    style: { left: 20%, top: 35% }
  - type: state-label
    entity: sensor.fridge_freezer_fridge_temp
    style: { left: 38%, top: 90% }
  - type: state-icon
    entity: binary_sensor.mith_pc
    icon: mdi:desktop-classic
    visibility:
      - condition: state
        entity: person.chris
        state: home
    style: { left: 90%, top: 87% }
```

## Troubleshooting

**The card isn't in the card picker.** Check it's installed under
**Settings > Marketplace** (Filters > Installed), then reload your browser.
On a phone app, pull down to refresh or clear the app's cache.

**Custom element doesn't exist: picture-elements-plus.** The dashboard
resource isn't loading. Check **Settings > Dashboards > Resources** has an
entry ending in `picture-elements-plus.js`. If you manage resources in YAML,
add `/local/community/picture-elements-plus/picture-elements-plus.js` as a
module yourself.

**Dragging doesn't work.** You need Home Assistant 2026.11 or later, and the
element has to be positioned with `left`/`top` percentages.

**The old "Add new element" button is back.** A Home Assistant update has
changed how its editor is built. It still works, it's just untidy. Please
open an issue.

**The visual editor says it isn't supported.** Usually a typo or an option
the built-in card doesn't know. Check the YAML against the examples above.

## Releasing a new version

Bump `VERSION` at the top of `picture-elements-plus.js`, merge to `main`,
then publish a GitHub release with a matching tag (for example `v0.2.0`).
The Marketplace checks custom repositories for new releases every 48 hours.
