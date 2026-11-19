# Picture Elements Plus

Home Assistant's picture elements card, with a better way to put things on
your floor plan and a few extras the built-in card doesn't have.

It's the built-in card underneath, so on your dashboard it looks and behaves
the same, and any picture elements YAML you already have keeps working.

<p>
  <img src="https://raw.githubusercontent.com/MithUK1/picture-elements-plus/main/docs/sample-floor-plan.png" alt="The sample floor plan a new card starts with" width="210">
  <img src="https://raw.githubusercontent.com/MithUK1/picture-elements-plus/main/docs/coloured-floor-plan.png" alt="A coloured floor plan" width="210">
  <img src="https://raw.githubusercontent.com/MithUK1/picture-elements-plus/main/docs/camera-example.jpg" alt="A camera view of a driveway" width="210">
</p>

*Any picture works: the sample plan new cards start with, your own floor
plan, or a live camera.*

- [What it adds](#what-it-adds)
- [Install](#install)
- [Moving an existing card over](#moving-an-existing-card-over)
- [Using the editor](#using-the-editor)
- [Options](#options)
- [Text on the plan](#text-on-the-plan)
- [Room glow](#room-glow)
- [Several images in one card](#several-images-in-one-card)
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
- **Size per element.** Make any icon, badge or label bigger or smaller.
- **Text.** Put labels like "Loft" anywhere on the plan and drag them about.
  Text can also be a template, like the current temperature.
- **Room glow.** A shape over a room that glows when its lights are on and
  turns red when there's motion or a door or window is open.
- **Several images.** Floors, rooms, the garden, anything, in one card,
  with your own names on tabs to switch between them. A dot on a tab shows
  something is lit up or alerting on that image.

**In the editor**

- **Entity picker.** Search by name, entity id or room. You can also filter
  by type (with a Helpers filter that groups all your helpers) or by room,
  grouped by floor. Click an entity to put it on the plan, or drag it to
  the exact spot.
- **Sensible defaults.** Lights, switches and fans toggle when tapped.
  Sensors show their value and people show as badges.
- **Drag to position**, with snapping and guide lines:
  - an orange line when you're level with another element
  - a purple line when you're on a quarter or half-way line of the plan
  - the position you'll drop at, and the plan's size in pixels
- **Arrow keys** to nudge the selected element.
- **Select several** with Shift-click, then line them up, space them out,
  resize them, move them together or move them to another image.
- **Fill a room.** Pick a room and add all of its entities in one go, laid
  out in a neat grid.
- **Undo and redo** with Ctrl+Z and Ctrl+Y.

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

### Card settings

The **Card settings** panel at the top holds the things you set once and
rarely touch: the pictures, the plan style and the colour override. It
replaces Home Assistant's "Card options". It's folded away, so click its
header to open it. The header shows which picture is in use. It opens by
itself on a new card that still shows the sample plan. (A separate tab next
to Config would be neater, but Home Assistant owns those tabs and cards
can't add to them.)

**Pictures** has:

- **Title**, shown above the plan (optional)
- **Show: Image or Camera**. With **Image**, upload a picture or pick one
  from your media. PNG, JPG and SVG all work. **Different image in dark
  mode** adds a second picture for when your dashboard is dark. With
  **Camera**, pick a camera and whether to show snapshots or a live stream.
  The image stays on the card until you've picked a camera.
- **Add another image**, see [Several images in one card](#several-images-in-one-card)

**SVG plans** stay sharp at any size. If the upload refuses your SVG, copy
it into `/config/www/` (for example with the File editor add-on) and open
the code editor and set `image: /local/plan.svg`.

A new card starts with the sample plan above. In YAML it shows as
`image: sample-floor-plan`. It's built into the card, so nothing gets
downloaded.

The built-in card's rarer settings (`state_image`, `image_entity`,
`state_filter`, `dark_mode_filter` and `theme`) aren't in the panel, as they
mostly confuse things. They still work if you set them in the code editor,
and the panel tells you when a card has any.

Under the pictures, **Plan style** sets how wide the plan is compared to
the card, and **Colour override** sets the colours of every state icon on
the card. Each has a button to put it back to Home Assistant's normal.

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
3. Click the entity (or its **+**), or press Enter to add the top result.
   It goes on the plan straight away, with a blue box round it, and the
   list stays open so you can add the next one. Arrow keys nudge the new one.
   Or **drag** the entity from the list and drop it on the preview where you
   want it. Guide lines show where it will land.

**Other** adds things that aren't tied to an entity: a room glow, text, an
icon, an image, an action button or a conditional group.

### Filling a room

Pick a room in the room list and an **Add all to ...** button appears. It
adds everything listed (so the type filter and search still apply) in a neat
grid:

- inside the room's [room glow](#room-glow), if you've added one for it
- otherwise in the middle of the plan, already selected, so you can drag
  them into the room together

Up to 40 at a time. Untick **Hide ones already on the plan** first if you
want ones that are already placed too.

Helpers and template entities are ordinary entities, so they show up like
anything else. **Helpers** filters to just your helpers (input booleans,
numbers, selects, texts, date/times, buttons, counters, timers and
schedules).

### Moving things

- **Drag** an element in the preview. A newly added one is picked (blue
  box), so you can drag it or nudge it straight into place.
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

### Selecting several

**Shift-click** (or Ctrl-click) elements in the preview to pick them. Each
one gets a blue box and a **Picked** panel appears under the element list:

- **Line up** left, centre, right, top, middle or bottom, and **space evenly**
  across or down (with three or more)
- **Size** them all at once
- **Move to** another image
- **Remove from plan**

Drag any picked element and the rest come with it. The arrow keys move them
all too. Press **Escape** or **Clear** to let go, or click something that
isn't picked.

### Undo

**Ctrl+Z** undoes the last change made in the editor (moves, adding,
lining up, removing, everything) and **Ctrl+Y** or **Ctrl+Shift+Z** redoes
it. It works while the card's editor is open, and not while you're typing in
a box.

### Element size

Open an element and use the **Size** panel under its settings. 100% is
normal. Text has its own size setting, and room glows are sized by their
width and height.

Only elements positioned with `left` and `top` in percent can be dragged.
That's a Home Assistant rule. Ones placed with `right`, `bottom` or pixels are
left alone. Elements inside a conditional group are moved in the group's own
editor.

## Options

Everything the built-in
[picture elements card](https://www.home-assistant.io/dashboards/picture-elements/)
takes, plus:

| Option | What it does | Example |
| --- | --- | --- |
| `plan_size` | Width of the plan as a percentage of the card. Below 100 the plan is centred and the icons look bigger on it. Above 100 it's bigger than the card, the icons look smaller on it, and the card scrolls sideways. | `plan_size: 150` |
| `icon_color` | Colour of every icon on the plan. A theme colour name or any CSS colour. | `icon_color: blue-grey` |
| `active_color` | Colour of icons when their entity is on, open, home and so on. This replaces HA's own colours, including the light's colour. | `active_color: amber` |
| `pictures` | Several images in one card. See [below](#several-images-in-one-card). | |

And on any element:

| Option | What it does | Example |
| --- | --- | --- |
| `scale` | Size as a percentage of normal. Grows from the element's centre. Not for text or room glows. | `scale: 150` |
| `visibility` | Only show it when these conditions are true. See [below](#showing-elements-only-sometimes). | |

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

## Room glow

A room glow is a shape you put over a room. It:

- glows when any of the room's lights are on, in the lights' own colour
  (or a colour you pick)
- turns red and pulses when there's motion, or a door or window is open
- does nothing when tapped, so icons on top of it still work
- always sits underneath icons and labels

Add one with **Other > Room glow** (if you've picked a room in the room list,
it's set to that room). Drag it into place, then drag the round handle on
its bottom-right corner to resize it. You can also type the width and height
in its editor.

Pick a **Room** and it follows that room's lights, and its motion,
occupancy, presence, door, window and opening sensors. To choose them
yourself, fill in **Lights** or **Sensors that turn it red**. The editor
tells you how many it's following.

```yaml
- type: custom:picture-elements-plus-room
  area: kitchen
  color: amber          # optional, otherwise the lights' own colour
  alert_color: red      # optional
  lights:               # optional, instead of the room's lights
    - light.kitchen_light_1
  alerts:               # optional, instead of the room's sensors
    - binary_sensor.back_door
  style:
    left: 20%           # the middle of the room
    top: 30%
    width: 28%
    height: 35%
```

While you're editing, room glows show a dashed outline and the room's name so
you can find them.

## Several images in one card

One card can hold several images, each with its own elements: the floors
of your house, separate rooms, the garden, a camera, whatever you like. The
card shows their names as tabs.

In **Card settings**, select **Add another image**. The card's current
image becomes the first one and a new one is added with the sample plan,
with its name box ready for you to type. Then:

- click an image's name to edit it (or click its tab in the preview)
- choose what it shows (image or camera) underneath
- rename it, move it earlier or later, or remove it
- move an element to another image from its editor, or several at once
  with [Select several](#selecting-several)

On the dashboard the tabs sit in the card's top-right corner. An image with
a room glow that's lit up gets an amber dot on its tab, and a red dot if
something's alerting there.

In YAML, the images go in a `pictures` list instead of `image` and
`elements` at the top. Everything else (title, plan size, colours) is shared
by all of them.

```yaml
type: custom:picture-elements-plus
title: House
plan_size: 120
pictures:
  - name: Ground floor
    image: /local/jpg/Newton_G.png
    elements:
      - type: state-icon
        entity: light.kitchen_light_1
        style: { left: 20%, top: 35% }
  - name: First floor
    image: /local/jpg/Newton_1.png
    elements: []
  - name: Driveway
    camera_image: camera.driveway
    elements: []
```

Removing images until only one is left turns it back into a normal card.
Cards made with version 0.3, which called the list `floors`, still work and
are switched over the next time you save them in the editor.

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
  - type: custom:picture-elements-plus-room
    area: kitchen
    style: { left: 20%, top: 30%, width: 28%, height: 35% }
  - type: state-icon
    entity: binary_sensor.mith_pc
    icon: mdi:desktop-classic
    scale: 125
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

**Ctrl+Z does nothing.** Click on an empty part of the editor first, so
you're not typing in a box. Undo only covers changes made since the editor
was opened.

**A room glow doesn't light up.** Open it and check the line under the form
says it's following some lights. If it says 0, the lights aren't assigned to
that room in Home Assistant, so pick them under **Lights** instead.

**The old "Add new element" button is back.** A Home Assistant update has
changed how its editor is built. It still works, it's just untidy. Please
open an issue.

**The visual editor says it isn't supported.** Usually a typo or an option
the built-in card doesn't know. Check the YAML against the examples above.

## Releasing a new version

Bump `VERSION` at the top of `picture-elements-plus.js`, merge to `main`,
then publish a GitHub release with a matching tag (for example `v0.7.0`).
The Marketplace checks custom repositories for new releases every 48 hours.
