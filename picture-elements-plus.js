/*
 * Picture Elements Plus
 *
 * Home Assistant's picture-elements card with a nicer editor. The card on
 * the dashboard *is* the built-in card, wrapped, so existing YAML keeps
 * working after changing the type to `custom:picture-elements-plus`.
 *
 * On top of the built-in card it adds:
 *   - a plan size, so the plan can be shown bigger or smaller than the card
 *     while icons stay the same size
 *   - an icon colour and an "on" colour for every icon on the plan
 *   - a size and visibility conditions on any element
 *   - a text element you can drag around (it also renders templates)
 *   - a room glow element that lights up with the room's lights and turns
 *     red on motion or an open door
 *   - several images in one card (floors, rooms, anything), with tabs to
 *     switch between them
 *
 * And in the editor:
 *   - a searchable entity picker in place of the "Add new element" dropdown:
 *     click an entity to add it, drag it onto the preview, or fill a room
 *     with all of its entities at once
 *   - a simpler Picture panel in place of HA's "Card options"
 *   - snapping and guide lines when dragging elements in the preview
 *   - shift-click to select several elements, then align, move or resize
 *     them together
 *   - arrow keys to nudge, and Ctrl+Z / Ctrl+Y to undo and redo
 *
 * Dragging itself comes from Home Assistant (2026.11 and later). HA hands the
 * preview card a "bridge" object hidden on the config under a Symbol; we pass
 * it straight through and hook into it for snapping, nudging and group moves.
 *
 * The file is split into: shared helpers, the text element, the room glow
 * element, the card, the card editor, the sample plan and registration.
 */

const VERSION = "0.5.0";

const CARD_TYPE = "picture-elements-plus";
const TEXT_TYPE = "picture-elements-plus-text";
const ROOM_TYPE = "picture-elements-plus-room";

const BRIDGE_DESCRIPTION = "pictureElementsEditorBridge";
const SNAP_STORAGE_KEY = "picture-elements-plus:snap";

// New cards start with this instead of an image URL. It's swapped for the
// sample floor plan at the bottom of this file, so the plan doesn't end up
// pasted into your dashboard's YAML.
const SAMPLE_IMAGE = "sample-floor-plan";

// Card options we handle ourselves. They're taken off the config before it
// reaches HA's card and editor, which reject keys they don't know.
const OWN_OPTIONS = ["plan_size", "icon_color", "active_color", "pictures", "floors"];

// The same for element options.
const OWN_ELEMENT_OPTIONS = ["visibility", "scale"];

// Card options that belong to a picture rather than the whole card, when the
// card has several pictures.
const PICTURE_KEYS = [
  "image",
  "dark_mode_image",
  "image_entity",
  "camera_image",
  "camera_view",
  "state_image",
  "state_filter",
  "dark_mode_filter",
  "entity",
  "elements",
];

// How close (in percent) a dragged element has to get to a line before it
// snaps onto it.
const ALIGN_DISTANCE = 0.8;

// The quarter and half-way lines drawn while dragging.
const PLAN_GUIDES = [25, 50, 75];

const MAX_RESULTS = 60;

// More than this and "fill a room" asks you to narrow it down first.
const MAX_FILL = 40;

const UNDO_LIMIT = 50;

// Tapping these on a floor plan should toggle them. Everything else opens
// more-info.
const TOGGLE_DOMAINS = new Set([
  "light",
  "switch",
  "fan",
  "input_boolean",
  "siren",
  "humidifier",
]);

const BADGE_DOMAINS = new Set(["person", "device_tracker", "zone"]);

const HELPER_DOMAINS = new Set([
  "input_boolean",
  "input_number",
  "input_select",
  "input_text",
  "input_datetime",
  "input_button",
  "counter",
  "timer",
  "schedule",
]);

// Binary sensors that turn a room glow red when they're on, unless the room
// lists its own.
const ALERT_DEVICE_CLASSES = new Set([
  "motion",
  "occupancy",
  "presence",
  "door",
  "garage_door",
  "opening",
  "window",
]);

// Theme colour names that HA's colour picker hands back, which map onto
// theme variables rather than plain CSS colours.
const THEME_COLORS = new Set([
  "primary", "accent", "disabled", "red", "pink", "purple", "deep-purple",
  "indigo", "blue", "light-blue", "cyan", "teal", "green", "light-green",
  "lime", "yellow", "amber", "orange", "deep-orange", "brown", "light-grey",
  "grey", "dark-grey", "blue-grey", "black", "white",
]);

const ELEMENT_TYPES = [
  { type: "auto", label: "Auto", icon: "mdi:auto-fix" },
  { type: "state-icon", label: "State icon", icon: "mdi:lightbulb-outline" },
  { type: "state-badge", label: "State badge", icon: "mdi:circle-outline" },
  { type: "state-label", label: "State label", icon: "mdi:format-text" },
];

const OTHER_ELEMENTS = [
  { type: "room", label: "Room glow", icon: "mdi:floor-plan" },
  { type: "text", label: "Text", icon: "mdi:format-letter-case" },
  { type: "icon", label: "Icon", icon: "mdi:emoticon-outline" },
  { type: "image", label: "Image", icon: "mdi:image-outline" },
  { type: "action-button", label: "Action button", icon: "mdi:gesture-tap-button" },
  { type: "conditional", label: "Conditional", icon: "mdi:call-split" },
];

const DOMAIN_ICONS = {
  helpers: "mdi:tools",
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch",
  sensor: "mdi:eye",
  binary_sensor: "mdi:radiobox-marked",
  media_player: "mdi:cast",
  camera: "mdi:video",
  climate: "mdi:thermostat",
  cover: "mdi:window-shutter",
  person: "mdi:account",
  device_tracker: "mdi:map-marker",
  fan: "mdi:fan",
  lock: "mdi:lock",
  update: "mdi:package-up",
  automation: "mdi:robot",
  script: "mdi:script-text",
};

const SIZE_CHOICES = [50, 75, 100, 125, 150, 200];

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

// HA only loads its picture-elements card when something asks for it.
// Getting the card helpers to build a throwaway one makes sure it exists.
let cardClassPromise;
function loadPictureElementsCard() {
  if (!cardClassPromise) {
    cardClassPromise = (async () => {
      if (!customElements.get("hui-picture-elements-card")) {
        const helpers = await window.loadCardHelpers();
        helpers.createCardElement({
          type: "picture-elements",
          image: SAMPLE_PLAN,
          elements: [],
        });
        await customElements.whenDefined("hui-picture-elements-card");
      }
      return customElements.get("hui-picture-elements-card");
    })();
  }
  return cardClassPromise;
}

// The editor bridge sits under a Symbol we can't import, so find it by its
// description.
function findBridgeKey(config) {
  if (!config) return undefined;
  return Object.getOwnPropertySymbols(config).find(
    (key) => key.description === BRIDGE_DESCRIPTION
  );
}

function findBridge(config) {
  const key = findBridgeKey(config);
  return key ? config[key] : undefined;
}

// The card and the editor share a little state while editing: which
// elements are selected, which picture is being edited, and the plan's shape.
// It's keyed by HA's bridge, which both of them already have.
const editorLinks = new WeakMap();
function editorLink(bridge) {
  if (!bridge) return undefined;
  let link = editorLinks.get(bridge);
  if (!link) {
    link = { selection: new Set(), picture: 0, planAspect: 1.5, events: new EventTarget() };
    editorLinks.set(bridge, link);
  }
  return link;
}

function domainOf(entityId) {
  return entityId.split(".")[0];
}

// "42%" -> 42. Anything else (px, calc, missing) -> undefined.
function parsePercent(value) {
  if (value === undefined || value === null) return undefined;
  const match = /^\s*(-?\d+(\.\d+)?)%\s*$/.exec(String(value));
  return match ? parseFloat(match[1]) : undefined;
}

function roundTo(value, step) {
  const rounded = Math.round(value / step) * step;
  // Get rid of float noise like 42.00000000001
  return Math.round(rounded * 100) / 100;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function cssColor(color) {
  if (!color) return undefined;
  return THEME_COLORS.has(color) ? `var(--${color}-color)` : color;
}

// Images are either a URL or, from HA's picker, a media object.
function imageId(image) {
  return typeof image === "object" ? image?.media_content_id : image;
}

function isPlaceholder(image) {
  const id = imageId(image);
  return !id || id === SAMPLE_IMAGE || id === SAMPLE_PLAN;
}

// Version 0.4 could save the sample plan as a long media object, and an
// upload meant for the picture could end up as the dark mode image. Put
// both right: the sample is stored by name, and a lone dark mode image on
// top of the sample becomes the picture.
function tidyImage(settings) {
  if (!settings || settings.image === undefined || !isPlaceholder(settings.image)) return settings;
  const tidy = { ...settings, image: SAMPLE_IMAGE };
  if (tidy.dark_mode_image && !isPlaceholder(tidy.dark_mode_image)) {
    tidy.image = tidy.dark_mode_image;
    delete tidy.dark_mode_image;
  }
  return tidy;
}

function tidyImages(config) {
  let tidy = tidyImage(config);
  const pictures = picturesOf(config);
  if (pictures) {
    const tidyPictures = pictures.map(tidyImage);
    if (tidyPictures.some((picture, i) => picture !== pictures[i])) {
      tidy = { ...tidy, [config.pictures ? "pictures" : "floors"]: tidyPictures };
    }
  }
  return tidy;
}

// Where an element sits, if it's placed with left/top percentages.
function positionOf(element) {
  const left = parsePercent(element?.style?.left);
  const top = parsePercent(element?.style?.top);
  return left === undefined || top === undefined ? undefined : { left, top };
}

function withPosition(element, left, top) {
  return {
    ...element,
    style: { ...element.style, left: `${roundTo(clamp(left), 0.1)}%`, top: `${roundTo(clamp(top), 0.1)}%` },
  };
}

// Text and room glows have their own size settings, and conditional
// elements aren't drawn themselves.
function canScale(element) {
  return ![`custom:${TEXT_TYPE}`, `custom:${ROOM_TYPE}`, "conditional"].includes(element?.type);
}

/* ---- pictures ---- */

// Version 0.3 called them floors. Those cards still work, and the editor
// renames the key the next time it saves.
function picturesOf(config) {
  const list = config?.pictures ?? config?.floors;
  return Array.isArray(list) && list.length ? list : undefined;
}

function pictureCount(config) {
  return picturesOf(config)?.length || 1;
}

// One picture of the card as a plain picture-elements config: the card-wide
// options with that picture's image and elements on top. Our own options are
// left out. Spreading keeps the bridge symbol.
function pictureView(config, index) {
  const view = { ...config };
  for (const key of OWN_OPTIONS) delete view[key];
  const pictures = picturesOf(config);
  if (pictures) {
    const { name, ...picture } = pictures[clamp(index, 0, pictures.length - 1)];
    Object.assign(view, picture);
  }
  if (!Array.isArray(view.elements)) view.elements = [];
  return view;
}

function elementsOf(config, index) {
  const pictures = picturesOf(config);
  const elements = pictures ? pictures[clamp(index, 0, pictures.length - 1)].elements : config?.elements;
  return elements || [];
}

function withElements(config, index, elements) {
  const pictures = picturesOf(config);
  if (!pictures) return { ...config, elements };
  return {
    ...config,
    pictures: pictures.map((picture, i) => (i === index ? { ...picture, elements } : picture)),
  };
}

function allElements(config) {
  const pictures = picturesOf(config);
  return pictures ? pictures.flatMap((picture) => picture.elements || []) : config?.elements || [];
}

/* ---- snapping ---- */

function loadSnapSetting() {
  try {
    const stored = localStorage.getItem(SNAP_STORAGE_KEY);
    if (stored !== null) return parseFloat(stored) || 0;
  } catch (err) {
    // Private mode or storage blocked, use the default.
  }
  return 1;
}

function saveSnapSetting(value) {
  try {
    localStorage.setItem(SNAP_STORAGE_KEY, String(value));
  } catch (err) {
    // Not the end of the world.
  }
}

// Where things can snap to on one axis: the other elements' lines, then the
// quarter and half-way lines of the plan. `skip` is the set of elements
// being moved, which shouldn't snap to themselves.
function snapTargets(elements, skip, axis) {
  const lines = [];
  (elements || []).forEach((element, index) => {
    if (skip.has(index) || !element.style) return;
    const value = parsePercent(element.style[axis]);
    if (value !== undefined) lines.push({ value, kind: "element" });
  });
  for (const value of PLAN_GUIDES) lines.push({ value, kind: "guide" });
  return lines;
}

function nearestLine(value, lines) {
  let best;
  for (const line of lines) {
    const distance = Math.abs(line.value - value);
    if (distance > ALIGN_DISTANCE) continue;
    // Lining up with another element beats a plan guide at the same spot.
    const better =
      !best ||
      distance < best.distance ||
      (distance === best.distance && line.kind === "element");
    if (better) best = { ...line, distance };
  }
  return best;
}

// Returns the snapped position, plus what each axis snapped to (if
// anything) so the preview can colour the guide lines.
function snapPosition(left, top, elements, skip, step) {
  const result = { left, top, leftKind: undefined, topKind: undefined };
  for (const axis of ["left", "top"]) {
    const value = axis === "left" ? left : top;
    const line = nearestLine(value, snapTargets(elements, skip, axis));
    result[axis] = line ? line.value : step ? roundTo(value, step) : value;
    result[`${axis}Kind`] = line?.kind;
  }
  return result;
}

// Positions for `count` things in a neat grid filling `box` (centre and size
// in percent). `aspect` is the plan's width over its height, so the gaps
// come out even on screen.
function gridPositions(count, box, aspect) {
  const widthOnScreen = box.width * aspect;
  let columns = Math.max(1, Math.round(Math.sqrt((count * widthOnScreen) / box.height)));
  columns = Math.min(columns, count);
  const rows = Math.ceil(count / columns);
  const positions = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns);
    const column = i % columns;
    // Centre a short last row.
    const inRow = row === rows - 1 ? count - row * columns : columns;
    const offset = (columns - inRow) / 2;
    positions.push({
      left: roundTo(box.left - box.width / 2 + (box.width * (column + offset + 0.5)) / columns, 0.1),
      top: roundTo(box.top - box.height / 2 + (box.height * (row + 0.5)) / rows, 0.1),
    });
  }
  return positions;
}

/* ---- dragging from the picker onto the preview ---- */

// Our own type, so the preview only reacts to drags that came from the picker.
const DRAG_TYPE = "application/x-picture-elements-plus";

function startDrag(ev, data) {
  ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify(data));
  ev.dataTransfer.setData("text/plain", data.entity || data.other);
  ev.dataTransfer.effectAllowed = "copy";
}

function isOurDrag(ev) {
  return [...(ev.dataTransfer?.types || [])].includes(DRAG_TYPE);
}

/* ---- misc ---- */

function fireEvent(node, type, detail) {
  node.dispatchEvent(
    new CustomEvent(type, { detail, bubbles: true, composed: true })
  );
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isTypingTarget(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName)) return true;
  // Lists, menus and sliders use the arrow keys themselves.
  const role = node.getAttribute("role");
  return ["listbox", "option", "menu", "menuitem", "combobox", "slider", "textbox"].includes(role);
}

function prettyDomain(domain) {
  const words = domain.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function areaOf(hass, entityId) {
  const entry = hass.entities?.[entityId];
  if (!entry) return undefined;
  const areaId = entry.area_id || hass.devices?.[entry.device_id]?.area_id;
  return areaId ? hass.areas?.[areaId] : undefined;
}

// The lights and alert sensors a room glow watches: the ones it lists, or
// failing that, the ones in its area.
function roomEntities(hass, config) {
  const lights = config.lights?.length ? [...config.lights] : [];
  const alerts = config.alerts?.length ? [...config.alerts] : [];
  if (config.area && hass && (!lights.length || !alerts.length)) {
    const findLights = !lights.length;
    const findAlerts = !alerts.length;
    for (const [entityId, stateObj] of Object.entries(hass.states)) {
      const entry = hass.entities?.[entityId];
      if (entry?.hidden) continue;
      if (areaOf(hass, entityId)?.area_id !== config.area) continue;
      const domain = domainOf(entityId);
      if (findLights && domain === "light") lights.push(entityId);
      if (
        findAlerts &&
        domain === "binary_sensor" &&
        ALERT_DEVICE_CLASSES.has(stateObj.attributes.device_class)
      ) {
        alerts.push(entityId);
      }
    }
  }
  return { lights, alerts };
}

// "alert", "lit" or "" for a room glow right now.
function roomState(hass, config, entities = roomEntities(hass, config)) {
  const isOn = (id) => hass?.states[id]?.state === "on";
  if (entities.alerts.some(isOn)) return "alert";
  if (entities.lights.some(isOn)) return "lit";
  return "";
}

/* ------------------------------------------------------------------ */
/* Text element                                                        */
/* ------------------------------------------------------------------ */

// A bit of text on the plan, like a room name. Used as an element:
//
//   - type: custom:picture-elements-plus-text
//     text: Loft
//     size: 3          # percent of the plan's width
//     color: amber     # optional
//     bold: true       # optional
//     style: { left: 30%, top: 40% }
//
// Text containing {{ }} or {% %} is rendered as a template and kept up to
// date, e.g. text: "{{ states('sensor.loft_temperature') }}°C".
class PictureElementsPlusText extends HTMLElement {
  static getStubConfig() {
    return { type: `custom:${TEXT_TYPE}`, text: "Room name", size: 3 };
  }

  static getConfigElement() {
    return document.createElement(`${TEXT_TYPE}-editor`);
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { white-space: nowrap; cursor: default; }
        span { line-height: 1.2; }
      </style>
      <span></span>
    `;
    this._span = this.shadowRoot.querySelector("span");
  }

  setConfig(config) {
    if (config.text === undefined || config.text === null) {
      throw new Error("Text required");
    }
    const templateChanged = config.text !== this._config?.text;
    this._config = config;
    if (templateChanged) this._unsubscribe();
    this._render();
    this._subscribe();
  }

  set hass(hass) {
    this._hass = hass;
    this._subscribe();
  }

  connectedCallback() {
    this._subscribe();
  }

  disconnectedCallback() {
    this._unsubscribe();
  }

  get _isTemplate() {
    return /\{\{|\{%/.test(String(this._config?.text ?? ""));
  }

  _render() {
    const config = this._config;
    const size = Number(config.size) || 3;
    // --pep-unit is 1% of the plan's width, set by the card.
    this._span.style.fontSize = `calc(var(--pep-unit, 6px) * ${size})`;
    this._span.style.color = cssColor(config.color) || "var(--primary-text-color)";
    this._span.style.fontWeight = config.bold ? "700" : "400";
    if (!this._isTemplate) {
      this._span.textContent = config.text;
    } else if (this._rendered === undefined) {
      this._span.textContent = "";
    } else {
      this._span.textContent = this._rendered;
    }
  }

  _subscribe() {
    if (!this._isTemplate || this._unsubscribePromise || !this._hass || !this.isConnected) {
      return;
    }
    this._unsubscribePromise = this._hass.connection
      .subscribeMessage(
        (message) => {
          this._rendered = message.result ?? "";
          this._render();
        },
        { type: "render_template", template: String(this._config.text), strict: false }
      )
      .catch((err) => {
        // A broken template shows as-is, which is usually enough of a hint.
        this._rendered = String(this._config.text);
        this._render();
        this._unsubscribePromise = undefined;
        console.warn("picture-elements-plus: template failed", err);
      });
  }

  _unsubscribe() {
    const pending = this._unsubscribePromise;
    this._unsubscribePromise = undefined;
    this._rendered = undefined;
    pending?.then((unsubscribe) => unsubscribe && unsubscribe()).catch(() => {});
  }
}

// A small ha-form based editor, shared by the text and room glow elements.
// `toData` turns the element config into form data and `fromData` turns it
// back; `afterRender` can add extra bits under the form.
class SimpleElementEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    this._afterRender();
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  get schema() { return []; }
  get labels() { return {}; }
  toData(config) { return config; }
  fromData(data, config) { return { ...config, ...data }; }
  _afterRender() {}

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (field) => this.labels[field.name] || field.name;
      this._form.schema = this.schema;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const config = this.fromData(ev.detail.value, this._config);
        this._config = config;
        fireEvent(this, "config-changed", { config });
      });
      this.append(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this.toData(this._config);
    this._afterRender();
  }
}

// The form shown when you edit a text element in the card editor.
class PictureElementsPlusTextEditor extends SimpleElementEditor {
  get schema() {
    return [
      { name: "text", required: true, selector: { template: {} } },
      { name: "size", selector: { number: { min: 1, max: 15, step: 0.5, mode: "slider" } } },
      { name: "color", selector: { ui_color: {} } },
      { name: "bold", selector: { boolean: {} } },
    ];
  }

  get labels() {
    return { text: "Text or template", size: "Size (% of plan width)", color: "Colour", bold: "Bold" };
  }

  toData(config) {
    return { size: 3, ...config };
  }
}

/* ------------------------------------------------------------------ */
/* Room glow element                                                   */
/* ------------------------------------------------------------------ */

// A shape over a room that glows when the room's lights are on, and turns
// red when there's motion or a door or window is open:
//
//   - type: custom:picture-elements-plus-room
//     area: kitchen            # picks up the room's lights and sensors
//     lights: [light.kitchen]  # optional, instead of the area's lights
//     alerts: [binary_sensor.back_door]  # optional, instead of the area's sensors
//     color: amber             # optional, otherwise the lights' own colour
//     alert_color: red         # optional
//     style: { left: 30%, top: 40%, width: 25%, height: 20% }
//
// It ignores taps on the dashboard, so icons underneath still work.
class PictureElementsPlusRoom extends HTMLElement {
  static getStubConfig() {
    return {
      type: `custom:${ROOM_TYPE}`,
      style: { left: "50%", top: "50%", width: "20%", height: "20%" },
    };
  }

  static getConfigElement() {
    return document.createElement(`${ROOM_TYPE}-editor`);
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 20%;
          height: 20%;
          pointer-events: none;
        }
        :host([editing]) { pointer-events: auto; cursor: move; }
        .glow, .outline {
          position: absolute;
          inset: 0;
          border-radius: 6px;
          box-sizing: border-box;
        }
        .glow {
          opacity: 0;
          transition: opacity 0.5s, background-color 0.5s, box-shadow 0.5s;
        }
        .glow.lit, .glow.alert { opacity: 0.35; }
        .glow.alert { animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: 0.55; } }
        @media (prefers-reduced-motion: reduce) { .glow.alert { animation: none; } }
        .outline {
          display: none;
          border: 2px dashed var(--primary-color);
          background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.06);
        }
        .name {
          display: none;
          position: absolute;
          inset: 0;
          align-items: center;
          justify-content: center;
          font: 500 12px/1.2 var(--ha-font-family-body, Roboto, sans-serif);
          color: var(--primary-color);
          text-align: center;
          overflow: hidden;
        }
        :host([editing]) .outline, :host([editing]) .name { display: flex; }
      </style>
      <div class="glow"></div>
      <div class="outline"></div>
      <div class="name"></div>
    `;
    this._glow = this.shadowRoot.querySelector(".glow");
    this._name = this.shadowRoot.querySelector(".name");
  }

  setConfig(config) {
    this._config = config;
    this._entities = undefined;
    this._render();
  }

  set hass(hass) {
    // Working out the area's entities means a walk over everything, so only
    // redo it when the entity or device registry changes.
    if (!this._hass || hass.entities !== this._hass.entities || hass.devices !== this._hass.devices) {
      this._entities = undefined;
    }
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._config) return;
    const hass = this._hass;
    if (!this._entities && hass) this._entities = roomEntities(hass, this._config);
    const entities = this._entities || { lights: [], alerts: [] };
    const state = roomState(hass, this._config, entities);

    let color = "transparent";
    if (state === "alert") {
      color = cssColor(this._config.alert_color) || "var(--red-color, #f44336)";
    } else if (state === "lit") {
      color = cssColor(this._config.color) || this._lightColor(entities.lights) || "var(--amber-color, #ffc107)";
    }
    this._glow.className = `glow ${state}`;
    this._glow.style.backgroundColor = color;
    this._glow.style.boxShadow = state ? `0 0 calc(var(--pep-unit, 6px) * 3) ${color}` : "";

    const area = this._config.area && hass?.areas?.[this._config.area];
    this._name.textContent = area?.name || this._config.area || "Room glow";
  }

  // The average colour of the lights that are on, if they have one.
  _lightColor(lights) {
    const colors = lights
      .map((id) => this._hass?.states[id])
      .filter((stateObj) => stateObj?.state === "on" && Array.isArray(stateObj.attributes.rgb_color))
      .map((stateObj) => stateObj.attributes.rgb_color);
    if (!colors.length) return undefined;
    const average = [0, 1, 2].map((i) => Math.round(colors.reduce((sum, c) => sum + c[i], 0) / colors.length));
    return `rgb(${average.join(", ")})`;
  }
}

class PictureElementsPlusRoomEditor extends SimpleElementEditor {
  get schema() {
    return [
      { name: "area", selector: { area: {} } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "width", selector: { number: { min: 1, max: 100, step: 0.5, mode: "box", unit_of_measurement: "%" } } },
          { name: "height", selector: { number: { min: 1, max: 100, step: 0.5, mode: "box", unit_of_measurement: "%" } } },
        ],
      },
      { name: "color", selector: { ui_color: {} } },
      { name: "alert_color", selector: { ui_color: {} } },
      { name: "lights", selector: { entity: { multiple: true, filter: { domain: ["light", "switch"] } } } },
      { name: "alerts", selector: { entity: { multiple: true, filter: { domain: "binary_sensor" } } } },
    ];
  }

  get labels() {
    return {
      area: "Room",
      width: "Width",
      height: "Height",
      color: "Glow colour (empty uses the lights' own colour)",
      alert_color: "Alert colour (empty is red)",
      lights: "Lights (empty uses the room's lights)",
      alerts: "Sensors that turn it red (empty uses the room's motion, door and window sensors)",
    };
  }

  toData(config) {
    const { style, type, ...rest } = config;
    return {
      ...rest,
      width: parsePercent(style?.width) ?? 20,
      height: parsePercent(style?.height) ?? 20,
    };
  }

  fromData(data, config) {
    const { width, height, ...rest } = data;
    const next = { type: config.type };
    for (const [key, value] of Object.entries(rest)) {
      const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length);
      if (!empty) next[key] = value;
    }
    // Keep anything else on the element, like visibility, that the form
    // doesn't show.
    for (const key of Object.keys(config)) {
      if (!(key in next) && !["area", "color", "alert_color", "lights", "alerts", "style"].includes(key)) {
        next[key] = config[key];
      }
    }
    next.style = { ...config.style, width: `${width ?? 20}%`, height: `${height ?? 20}%` };
    return next;
  }

  // Under the form, say what it found, so an empty room makes sense.
  _afterRender() {
    if (!this._config || !this._hass) return;
    if (!this._summary) {
      this._summary = document.createElement("p");
      this._summary.style.cssText = "font-size:12px;color:var(--secondary-text-color);margin:8px 0 0";
      this.append(this._summary);
    }
    const { lights, alerts } = roomEntities(this._hass, this._config);
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    this._summary.textContent =
      !this._config.area && !lights.length && !alerts.length
        ? "Pick a room, or some lights and sensors, for it to follow. Resize it with the handle on its corner in the preview."
        : `Following ${count(lights.length, "light")} and ${count(alerts.length, "sensor")}. ` +
          "Resize it with the handle on its corner in the preview.";
  }
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

const CARD_STYLES = `
  :host { display: block; height: 100%; }
  /* Scrolls sideways when the plan is set bigger than the card. */
  .wrapper { position: relative; height: 100%; overflow-x: auto; }
  hui-picture-elements-card { display: block; margin: 0 auto; }

  .pictures {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 18px;
    background: var(--card-background-color, #fff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }
  .pictures[hidden] { display: none; }
  .pictures button {
    position: relative;
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 14px;
    background: none;
    color: var(--primary-text-color);
    font: 500 13px var(--ha-font-family-body, Roboto, sans-serif);
    cursor: pointer;
  }
  .pictures button[aria-selected="true"] {
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  /* A dot when something on another picture is lit up or alerting. */
  .pictures button.lit::after, .pictures button.alert::after {
    content: "";
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--amber-color, #ffc107);
  }
  .pictures button.alert::after { background: var(--red-color, #f44336); }

  .overlay {
    position: absolute;
    pointer-events: none;
    display: none;
  }
  .overlay.visible { display: block; }

  .line { position: absolute; display: none; }
  .line.vertical { top: 0; bottom: 0; border-left: 1px dashed; }
  .line.horizontal { left: 0; right: 0; border-top: 1px dashed; }
  .line.shown { display: block; }

  /* The cross through the element being moved */
  .cross { border-color: var(--secondary-text-color); opacity: 0.6; }
  .cross.element { border-color: var(--accent-color, #ff9800); border-style: solid; opacity: 1; }
  .cross.guide { border-color: var(--pep-guide-color, #ab47bc); border-style: solid; opacity: 1; }

  /* Quarter and half-way lines, only while dragging */
  .quarter { border-color: var(--pep-guide-color, #ab47bc); opacity: 0.6; }

  /* Boxes round the elements picked with shift-click */
  .picked {
    position: absolute;
    border: 2px solid var(--primary-color);
    border-radius: 6px;
    box-shadow: 0 0 0 2px rgba(var(--rgb-primary-color, 3, 169, 244), 0.3);
  }

  /* Corner handle for resizing a room glow */
  .handle {
    position: absolute;
    display: none;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: var(--primary-color);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    cursor: nwse-resize;
    touch-action: none;
  }
  .handle.shown { display: block; }

  .chip {
    position: absolute;
    padding: 2px 8px;
    border-radius: 10px;
    font: 12px/18px var(--ha-font-family-body, Roboto, sans-serif);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .position {
    top: 6px;
    left: 6px;
    color: var(--text-primary-color, #fff);
    background: var(--primary-color);
  }
  .size {
    bottom: 6px;
    left: 6px;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
  }

  .error { padding: 16px; color: var(--error-color, #db4437); }
`;

// Added inside HA's card: room glows sit underneath everything else, so they
// never cover an icon.
const INNER_CARD_STYLES = `
  .element { z-index: 1; }
  ${ROOM_TYPE}.element { z-index: 0; }
`;

class PictureElementsPlusCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(`${CARD_TYPE}-editor`);
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass?.states || {}).find((id) => domainOf(id) === "light");
    return {
      type: `custom:${CARD_TYPE}`,
      image: SAMPLE_IMAGE,
      elements: entity
        ? [{
            type: "state-icon",
            entity,
            tap_action: { action: "toggle" },
            hold_action: { action: "more-info" },
            style: { left: "18%", top: "28%" },
          }]
        : [],
    };
  }

  constructor() {
    super();
    this._preview = false;
    this._pictureIndex = 0;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${CARD_STYLES}</style>
      <div class="wrapper">
        <div class="pictures" role="tablist" hidden></div>
        <div class="overlay">
          ${PLAN_GUIDES.map((p) => `<div class="line vertical quarter" style="left:${p}%"></div>`).join("")}
          ${PLAN_GUIDES.map((p) => `<div class="line horizontal quarter" style="top:${p}%"></div>`).join("")}
          <div class="line vertical cross"></div>
          <div class="line horizontal cross"></div>
          <div class="picked-boxes"></div>
          <div class="handle" title="Drag to resize"></div>
          <div class="chip position"></div>
          <div class="chip size"></div>
        </div>
      </div>
    `;
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    this._wrapper = $(".wrapper");
    this._pictureTabs = $(".pictures");
    this._overlay = $(".overlay");
    this._crossV = $(".cross.vertical");
    this._crossH = $(".cross.horizontal");
    this._quarters = this.shadowRoot.querySelectorAll(".quarter");
    this._pickedBoxes = $(".picked-boxes");
    this._handle = $(".handle");
    this._positionChip = $(".position");
    this._sizeChip = $(".size");

    this._onBridgeChanged = () => this._scheduleOverlay();
    this._onSelection = () => this._scheduleOverlay();
    this._onPicture = () => this._applyConfig();

    // Capture phase, so we see which element was pressed before HA's drag
    // handler takes the pointer, and can keep shift-clicks away from it.
    this._wrapper.addEventListener("pointerdown", (ev) => this._onPointerDown(ev), true);
    this._wrapper.addEventListener("click", (ev) => {
      if (this._swallowClick) {
        this._swallowClick = false;
        ev.stopPropagation();
        ev.preventDefault();
      }
    }, true);
    this._wrapper.addEventListener("pointermove", () => this._scheduleOverlay());
    this._wrapper.addEventListener("pointerup", () => {
      this._dragIndex = undefined;
      this._scheduleOverlay();
    });

    this._setUpDropping();

    this._pictureTabs.addEventListener("click", (ev) => {
      const button = ev.target.closest("button");
      if (button) this._showPicture(Number(button.dataset.picture));
    });

    this._setUpHandle();

    // The size readout and text size depend on the plan's width.
    this._resizeObserver = new ResizeObserver(() => this._scheduleStyling());
    // Elements get replaced when HA rebuilds them.
    this._mutationObserver = new MutationObserver(() => this._scheduleStyling());
  }

  setConfig(config) {
    // Same checks the built-in card makes, so errors show straight away even
    // before HA's card has loaded.
    if (!config) throw new Error("Invalid configuration");
    const hasImage = (c) =>
      (c.image || c.image_entity || c.camera_image || c.state_image) &&
      !(c.state_image && !c.entity);
    const pictures = config.pictures ?? config.floors;
    if (pictures !== undefined) {
      if (!Array.isArray(pictures) || !pictures.length) {
        throw new Error("pictures needs to be a list of pictures");
      }
      pictures.forEach((picture, i) => {
        if (!hasImage({ ...config, ...picture })) throw new Error(`Image required on picture ${i + 1}`);
        if (!Array.isArray(picture.elements)) throw new Error(`Elements required on picture ${i + 1}`);
      });
    } else {
      if (!hasImage(config)) throw new Error("Image required");
      if (!Array.isArray(config.elements)) throw new Error("Elements required");
    }

    this._config = config;
    this._setBridge(findBridge(config));

    if (this._card) {
      this._applyConfig();
    } else if (customElements.get("hui-picture-elements-card")) {
      // Already loaded: build it now so the editor preview doesn't flicker.
      this._createCard();
    } else {
      loadPictureElementsCard().then(() => this._createCard());
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._card) this._card.hass = hass;
    this._updatePictureDots();
    // State badges render after the first hass, so colour them then.
    if (first) this._scheduleStyling();
  }

  get hass() {
    return this._hass;
  }

  set preview(value) {
    const changed = value !== this._preview;
    this._preview = value;
    if (this._card) {
      this._card.preview = value;
      // Hidden elements are shown while editing, so the config differs.
      if (changed) this._applyConfig();
    }
  }

  get preview() {
    return this._preview;
  }

  getCardSize() {
    return this._card?.getCardSize ? this._card.getCardSize() : 4;
  }

  connectedCallback() {
    this._listen(this._bridge, true);
    this._observe();
    this._scheduleOverlay();
  }

  disconnectedCallback() {
    this._listen(this._bridge, false);
    this._resizeObserver.disconnect();
    this._mutationObserver.disconnect();
    this._observedRoot = undefined;
  }

  _createCard() {
    if (this._card || !this._config) return;
    this._card = document.createElement("hui-picture-elements-card");
    this._card.preview = this._preview;
    this._applyConfig();
    if (this._hass) this._card.hass = this._hass;
    this._wrapper.prepend(this._card);
  }

  get _link() {
    return editorLink(this._bridge);
  }

  // While editing, the picture comes from the editor. On the dashboard it's
  // whichever tab was picked last.
  get _picture() {
    const index = this._preview && this._link ? this._link.picture : this._pictureIndex;
    return clamp(index, 0, pictureCount(this._config) - 1);
  }

  get _elements() {
    return elementsOf(this._config, this._picture);
  }

  _showPicture(index) {
    if (this._preview && this._link) {
      // Let the editor switch, so the element list follows.
      this._link.events.dispatchEvent(new CustomEvent("picture-request", { detail: index }));
      return;
    }
    this._pictureIndex = index;
    this._applyConfig();
  }

  // What HA's card gets: the current picture, our own options removed, and
  // elements with visibility conditions wrapped in a conditional element.
  _innerConfig() {
    const config = tidyImage(pictureView(this._config, this._picture));
    config.type = "picture-elements";
    if (config.image === SAMPLE_IMAGE) config.image = SAMPLE_PLAN;
    config.elements = config.elements.map((element) => {
      if (!OWN_ELEMENT_OPTIONS.some((key) => key in element)) return element;
      const { visibility, scale, ...rest } = element;
      // While editing everything stays on the plan, or you couldn't move it.
      if (!visibility || this._preview) return rest;
      return { type: "conditional", conditions: visibility, elements: [rest] };
    });
    return config;
  }

  _applyConfig() {
    if (!this._card) return;
    try {
      this._card.setConfig(this._innerConfig());
      this._error?.remove();
      this._error = undefined;
    } catch (err) {
      if (!this._error) {
        this._error = document.createElement("div");
        this._error.className = "error";
        this._wrapper.append(this._error);
      }
      this._error.textContent = err.message;
    }
    this._renderPictureTabs();
    this._observe();
    this._scheduleStyling();
    this._scheduleOverlay();
  }

  _setBridge(bridge) {
    if (bridge === this._bridge) return;
    if (this.isConnected) {
      this._listen(this._bridge, false);
      this._listen(bridge, true);
    }
    this._bridge = bridge;
  }

  _listen(bridge, on) {
    if (!bridge) return;
    const method = on ? "addEventListener" : "removeEventListener";
    const link = editorLink(bridge);
    bridge[method]("changed", this._onBridgeChanged);
    link.events[method]("selection", this._onSelection);
    link.events[method]("picture", this._onPicture);
  }

  // The positioned box inside HA's card that left/top percentages refer to.
  get _root() {
    return this._card?.shadowRoot?.getElementById("root");
  }

  // Top-level elements in the same order as the picture's elements. HA renders
  // the background image first, then one node per element.
  get _renderedElements() {
    const root = this._root;
    if (!root) return [];
    return [...root.children].filter((node) => node.tagName !== "HUI-IMAGE");
  }

  // The node that's actually drawn for an element. Wrapped ones (with
  // visibility conditions, on the dashboard) sit inside a conditional.
  _drawnNode(node) {
    if (!node || node.classList.contains("element")) return node;
    return node.querySelector(".element") || node;
  }

  _observe() {
    const root = this._root;
    if (!root || root === this._observedRoot) {
      // HA's card renders asynchronously; try again once it has.
      if (!root && this._card) requestAnimationFrame(() => this._observe());
      return;
    }
    this._observedRoot = root;
    this._resizeObserver.disconnect();
    this._mutationObserver.disconnect();
    this._resizeObserver.observe(root);
    this._mutationObserver.observe(root, { childList: true, subtree: true });
    this._addInnerStyles();
  }

  _addInnerStyles() {
    const shadow = this._card?.shadowRoot;
    if (!shadow || shadow.__pepStyled) return;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(INNER_CARD_STYLES);
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      shadow.__pepStyled = true;
    } catch (err) {
      // Older browser: room glows just stack in list order.
    }
  }

  _indexFromEvent(ev) {
    const elements = this._renderedElements;
    for (const node of ev.composedPath()) {
      const index = elements.indexOf(node);
      if (index !== -1) return index;
      if (node === this._root) break;
    }
    return undefined;
  }

  /* ---- picking several elements ---- */

  _onPointerDown(ev) {
    if (ev.composedPath().includes(this._handle)) return;
    const index = this._indexFromEvent(ev);
    this._dragIndex = index;
    const link = this._link;
    if (!this._preview || !this._bridge?.active || !link) return;

    const picking = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    if (picking && index !== undefined) {
      // Keep it from HA, which would open the element instead.
      ev.stopPropagation();
      ev.preventDefault();
      this._swallowClick = true;
      if (link.selection.has(index)) link.selection.delete(index);
      else link.selection.add(index);
      link.events.dispatchEvent(new CustomEvent("selection"));
    } else if (!picking && link.selection.size && !link.selection.has(index)) {
      // A plain press anywhere else starts afresh.
      link.selection.clear();
      link.events.dispatchEvent(new CustomEvent("selection"));
    }
  }

  /* ---- dropping things from the picker ---- */

  _setUpDropping() {
    const accepts = (ev) => this._preview && this._bridge?.active && this._link && isOurDrag(ev);
    const pointFrom = (ev) => {
      const root = this._root;
      if (!root) return undefined;
      const rect = root.getBoundingClientRect();
      const left = ((ev.clientX - rect.left) / rect.width) * 100;
      const top = ((ev.clientY - rect.top) / rect.height) * 100;
      if (left < 0 || left > 100 || top < 0 || top > 100) return undefined;
      return snapPosition(left, top, this._elements, new Set(), loadSnapSetting());
    };

    this._wrapper.addEventListener("dragover", (ev) => {
      if (!accepts(ev)) return;
      const point = pointFrom(ev);
      this._dropPoint = point;
      if (point) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      }
      this._scheduleOverlay();
    }, true);
    this._wrapper.addEventListener("dragleave", (ev) => {
      if (this._wrapper.contains(ev.relatedTarget)) return;
      this._dropPoint = undefined;
      this._scheduleOverlay();
    }, true);
    this._wrapper.addEventListener("drop", (ev) => {
      const point = accepts(ev) && pointFrom(ev);
      this._dropPoint = undefined;
      this._scheduleOverlay();
      if (!point) return;
      ev.preventDefault();
      ev.stopPropagation();
      let data;
      try {
        data = JSON.parse(ev.dataTransfer.getData(DRAG_TYPE));
      } catch (err) {
        return;
      }
      this._link.events.dispatchEvent(new CustomEvent("drop", {
        detail: { data, left: roundTo(point.left, 0.1), top: roundTo(point.top, 0.1) },
      }));
    }, true);
  }

  /* ---- resizing room glows ---- */

  _setUpHandle() {
    let resize;
    this._handle.addEventListener("pointerdown", (ev) => {
      const index = this._bridge?.selectedIndex;
      const node = this._renderedElements[index];
      const position = positionOf(this._elements[index]);
      const root = this._root;
      if (!node || !position || !root) return;
      ev.stopPropagation();
      ev.preventDefault();
      this._handle.setPointerCapture(ev.pointerId);
      resize = { index, node, position, rect: root.getBoundingClientRect() };
    });
    this._handle.addEventListener("pointermove", (ev) => {
      if (!resize) return;
      const { node, position, rect } = resize;
      // The room is centred on its position, so it grows both ways.
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - rect.top) / rect.height) * 100;
      resize.width = roundTo(clamp(2 * Math.abs(x - position.left), 1, 100), 0.5);
      resize.height = roundTo(clamp(2 * Math.abs(y - position.top), 1, 100), 0.5);
      node.style.width = `${resize.width}%`;
      node.style.height = `${resize.height}%`;
      this._scheduleOverlay();
    });
    const finish = () => {
      if (resize?.width) {
        this._link?.events.dispatchEvent(new CustomEvent("resize", {
          detail: { index: resize.index, width: resize.width, height: resize.height },
        }));
      }
      resize = undefined;
    };
    this._handle.addEventListener("pointerup", finish);
    this._handle.addEventListener("pointercancel", finish);
  }

  /* ---- picture tabs ---- */

  _renderPictureTabs() {
    const pictures = picturesOf(this._config);
    this._pictureTabs.hidden = !pictures || pictures.length < 2;
    if (this._pictureTabs.hidden) return;
    const current = this._picture;
    this._pictureTabs.innerHTML = pictures
      .map((picture, i) => `
        <button role="tab" data-picture="${i}" aria-selected="${i === current}">
          ${escapeHtml(picture.name || `Image ${i + 1}`)}
        </button>`)
      .join("");
    this._updatePictureDots();
  }

  _updatePictureDots() {
    const pictures = picturesOf(this._config);
    if (!pictures || !this._hass || this._pictureTabs.hidden) return;
    const buttons = this._pictureTabs.querySelectorAll("button");
    pictures.forEach((picture, i) => {
      let state = "";
      if (i !== this._picture) {
        for (const element of picture.elements || []) {
          if (element.type !== `custom:${ROOM_TYPE}`) continue;
          const roomNow = roomState(this._hass, element);
          if (roomNow === "alert") { state = "alert"; break; }
          if (roomNow === "lit") state = "lit";
        }
      }
      buttons[i]?.classList.toggle("lit", state === "lit");
      buttons[i]?.classList.toggle("alert", state === "alert");
    });
  }

  /* ---- plan size, colours and element sizes ---- */

  _scheduleStyling() {
    if (this._stylingQueued) return;
    this._stylingQueued = true;
    requestAnimationFrame(() => {
      this._stylingQueued = false;
      this._applyStyling();
    });
  }

  _applyStyling() {
    const root = this._root;
    if (!root || !this._config) return;

    // Plan size is a share of the card's width. Above 100% the card scrolls.
    const planSize = Number(this._config.plan_size) || 100;
    this._card.style.width = planSize === 100 ? "" : `${planSize}%`;

    const width = root.offsetWidth;
    const height = root.offsetHeight;
    // 1% of the plan's width, used by text and room glows.
    this._card.style.setProperty("--pep-unit", `${width / 100}px`);
    if (this._link && width && height) this._link.planAspect = width / height;

    const iconColor = cssColor(this._config.icon_color);
    const activeColor = cssColor(this._config.active_color);
    if (iconColor) this._card.style.setProperty("--state-icon-color", iconColor);
    else this._card.style.removeProperty("--state-icon-color");

    // querySelectorAll also finds elements inside conditional elements.
    for (const node of root.querySelectorAll(".element")) {
      if (node.tagName === "HUI-ICON-ELEMENT" && !node.style.color) {
        node.dataset.pepColored = "";
      }
      if (node.dataset.pepColored !== undefined) {
        node.style.color = iconColor || "";
      }
      const badge = node.shadowRoot?.querySelector("state-badge");
      if (badge) {
        // state-badge only uses a custom colour when the entity is "on".
        badge.color = activeColor || undefined;
      }
      if (node.tagName === ROOM_TYPE.toUpperCase()) {
        node.toggleAttribute("editing", this._preview);
      }
    }

    // Per-element size and, while editing, fading the ones with conditions.
    const elements = this._elements;
    this._renderedElements.forEach((node, index) => {
      const element = elements[index];
      const drawn = this._drawnNode(node);
      const scale = Number(element?.scale);
      drawn.style.scale = scale && scale !== 100 && canScale(element) ? String(scale / 100) : "";
      node.style.opacity = this._preview && element?.visibility?.length ? "0.5" : "";
    });

    this._sizeText = width
      ? `Plan ${Math.round(width)} × ${Math.round(height)} px` +
        (planSize !== 100 ? ` (${planSize}%)` : "")
      : "";
    this._scheduleOverlay();
  }

  /* ---- editing overlay ---- */

  _scheduleOverlay() {
    if (this._overlayQueued) return;
    this._overlayQueued = true;
    requestAnimationFrame(() => {
      this._overlayQueued = false;
      this._drawOverlay();
    });
  }

  // While editing: the plan's size in the corner, boxes round picked
  // elements, and when an element is selected or dragged, a cross through it
  // with its position. During a drag the cross and position show where it
  // will land after snapping, and the other picked elements move with it.
  _drawOverlay() {
    const bridge = this._bridge;
    const root = this._root;
    const editing = this._preview && bridge?.active;
    if (!editing || !root || !root.offsetWidth) {
      this._overlay.classList.remove("visible");
      return;
    }

    const wrapperRect = this._wrapper.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    Object.assign(this._overlay.style, {
      left: `${rootRect.left - wrapperRect.left + this._wrapper.scrollLeft}px`,
      top: `${rootRect.top - wrapperRect.top + this._wrapper.scrollTop}px`,
      width: `${rootRect.width}px`,
      height: `${rootRect.height}px`,
    });
    this._overlay.classList.add("visible");
    this._sizeChip.textContent = this._sizeText || "";

    const elements = this._elements;
    const rendered = this._renderedElements;
    const selection = this._link?.selection || new Set();

    // Something from the picker is being dragged over the plan.
    const drop = this._dropPoint;
    if (drop) {
      for (const line of this._quarters) line.classList.add("shown");
      this._crossV.style.left = `${drop.left}%`;
      this._crossH.style.top = `${drop.top}%`;
      this._crossV.className = `line vertical cross shown ${drop.leftKind || ""}`;
      this._crossH.className = `line horizontal cross shown ${drop.topKind || ""}`;
      this._positionChip.style.display = "";
      this._positionChip.textContent =
        `drop at left ${roundTo(drop.left, 0.1)}%  \u00b7  top ${roundTo(drop.top, 0.1)}%`;
      this._handle.classList.remove("shown");
      return;
    }

    const dragging = root.classList.contains("dragging");
    const index = dragging ? this._dragIndex : bridge.selectedIndex;
    const node = index !== undefined ? rendered[index] : undefined;
    let left = node && parsePercent(node.style.left);
    let top = node && parsePercent(node.style.top);

    for (const line of this._quarters) line.classList.toggle("shown", dragging);

    // Moving one of the picked elements moves them all.
    const groupDrag = dragging && selection.size > 1 && selection.has(index);
    if (groupDrag && left !== undefined) {
      const start = positionOf(elements[index]);
      if (start) {
        const dx = left - start.left;
        const dy = top - start.top;
        for (const other of selection) {
          const from = positionOf(elements[other]);
          if (other === index || !from || !rendered[other]) continue;
          rendered[other].style.left = `${clamp(from.left + dx)}%`;
          rendered[other].style.top = `${clamp(from.top + dy)}%`;
        }
      }
    }

    this._drawPickedBoxes(selection, rendered, rootRect);
    this._drawHandle(dragging ? undefined : bridge.selectedIndex);

    if (left === undefined || top === undefined) {
      this._crossV.classList.remove("shown");
      this._crossH.classList.remove("shown");
      this._positionChip.style.display = "none";
      return;
    }

    let leftKind;
    let topKind;
    if (dragging) {
      // HA moves the element by setting its style directly during a drag.
      const skip = groupDrag ? selection : new Set([index]);
      ({ left, top, leftKind, topKind } = snapPosition(left, top, elements, skip, loadSnapSetting()));
    }

    this._crossV.style.left = `${left}%`;
    this._crossH.style.top = `${top}%`;
    this._crossV.className = `line vertical cross shown ${leftKind || ""}`;
    this._crossH.className = `line horizontal cross shown ${topKind || ""}`;
    this._positionChip.style.display = "";
    this._positionChip.textContent =
      `left ${roundTo(left, 0.1)}%  ·  top ${roundTo(top, 0.1)}%` +
      (groupDrag ? `  ·  ${selection.size} together` : "");
  }

  _drawPickedBoxes(selection, rendered, rootRect) {
    const boxes = [];
    for (const index of selection) {
      const node = this._drawnNode(rendered[index]);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      boxes.push(
        `<div class="picked" style="left:${rect.left - rootRect.left - 3}px;top:${rect.top - rootRect.top - 3}px;` +
        `width:${rect.width + 2}px;height:${rect.height + 2}px"></div>`
      );
    }
    this._pickedBoxes.innerHTML = boxes.join("");
  }

  // The resize handle sits on the bottom-right corner of a selected room glow.
  _drawHandle(index) {
    const element = this._elements[index];
    const node = this._renderedElements[index];
    const position = positionOf(element);
    if (element?.type !== `custom:${ROOM_TYPE}` || !node || !position) {
      this._handle.classList.remove("shown");
      return;
    }
    const width = parsePercent(node.style.width) ?? parsePercent(element.style?.width) ?? 20;
    const height = parsePercent(node.style.height) ?? parsePercent(element.style?.height) ?? 20;
    this._handle.style.left = `${position.left + width / 2}%`;
    this._handle.style.top = `${position.top + height / 2}%`;
    this._handle.classList.add("shown");
  }
}

/* ------------------------------------------------------------------ */
/* The card editor                                                     */
/* ------------------------------------------------------------------ */

const EDITOR_STYLES = `
  :host { display: block; }

  .panel {
    margin-top: 16px;
    border: 1px solid var(--divider-color);
    border-radius: var(--ha-card-border-radius, 12px);
    overflow: hidden;
  }
  .panel[hidden], [hidden] { display: none !important; }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 4px;
    font-weight: 500;
  }
  .panel-header ha-icon { color: var(--primary-color); }
  summary.panel-header { padding-bottom: 12px; cursor: pointer; list-style: none; }
  summary.panel-header::-webkit-details-marker { display: none; }
  summary .summary {
    font-weight: 400;
    font-size: 13px;
    color: var(--secondary-text-color);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  summary .chevron { color: var(--secondary-text-color); transition: transform 0.2s; }
  details[open] > summary .chevron { transform: rotate(180deg); }
  details[open] > summary.panel-header { padding-bottom: 4px; }
  .dark-form:empty, .dark-form[hidden] { display: none; }
  .panel-header .spacer { flex: 1; }
  .panel-body { padding: 8px 16px 12px; }
  .hint { font-size: 12px; color: var(--secondary-text-color); margin: 4px 0 0; }
  .hint + .chips { margin-top: 10px; }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
  }
  .panel-body .row { padding: 6px 0; }

  .search {
    flex: 1 1 200px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    height: 40px;
    border-radius: 20px;
    background: var(--secondary-background-color);
    color: var(--secondary-text-color);
  }
  .search input, .text-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    font: inherit;
    color: var(--primary-text-color);
  }
  .text-input {
    height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    background: var(--secondary-background-color);
  }

  select {
    height: 40px;
    padding: 0 12px;
    border-radius: 20px;
    border: none;
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
    font: inherit;
  }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 12px;
    border-radius: 15px;
    border: 1px solid var(--divider-color);
    background: none;
    color: var(--primary-text-color);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .chip:disabled { opacity: 0.4; cursor: default; }
  .chip.icon-only { padding: 0 7px; }
  .chip ha-icon { --mdc-icon-size: 16px; }
  .chip .count { color: var(--secondary-text-color); }
  .chip[aria-pressed="true"] {
    border-color: var(--primary-color);
    background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.15);
  }
  .chip.primary {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }
  .chip.danger { color: var(--error-color, #db4437); }

  .label {
    font-size: 12px;
    color: var(--secondary-text-color);
    min-width: 52px;
  }

  .fill { border-top: 1px solid var(--divider-color); }

  .results {
    max-height: 340px;
    overflow-y: auto;
    border-top: 1px solid var(--divider-color);
  }
  .result {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 16px;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .result:hover, .result:focus-visible {
    background: var(--secondary-background-color);
    outline: none;
  }
  .result .icon {
    flex: none;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--secondary-background-color);
    color: var(--state-icon-color, var(--paper-item-icon-color));
  }
  .result .text { flex: 1; min-width: 0; }
  .result .name, .result .id {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .result .id, .result .area {
    font-size: 12px;
    color: var(--secondary-text-color);
  }
  .result .area { flex: none; max-width: 30%; text-align: right; }
  .result .add { flex: none; color: var(--primary-color); }
  .result[draggable="true"] { cursor: grab; }
  .result .on-plan {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--secondary-background-color);
    color: var(--secondary-text-color);
  }

  .empty, .more {
    padding: 16px;
    text-align: center;
    color: var(--secondary-text-color);
    font-size: 13px;
  }

  .footer { border-top: 1px solid var(--divider-color); }

  .tips {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--secondary-text-color);
  }
  kbd {
    padding: 0 4px;
    border: 1px solid var(--divider-color);
    border-radius: 3px;
    font: inherit;
  }
`;

const HIDE_ADD_BUTTON = `ha-dropdown, ha-button-menu, ha-md-button-menu { display: none !important; }`;

// Only the top-level form in HA's editor: the one for a single element sits
// inside another shadow root and isn't touched.
const HIDE_CARD_OPTIONS = `ha-form { display: none !important; }`;

const PLAN_SIZE_SCHEMA = [
  {
    name: "plan_size",
    selector: { number: { min: 25, max: 300, step: 5, mode: "slider", unit_of_measurement: "%" } },
  },
];

const COLOR_SCHEMA = [
  { name: "icon_color", selector: { ui_color: {} } },
  { name: "active_color", selector: { ui_color: {} } },
];

const TITLE_SCHEMA = [{ name: "title", selector: { text: {} } }];

const MEDIA_SELECTOR = { media: { accept: ["image/*"], image_upload: true, hide_content_type: true } };

const IMAGE_SCHEMA = [{ name: "image", selector: MEDIA_SELECTOR }];

const DARK_IMAGE_SCHEMA = [{ name: "dark_mode_image", selector: MEDIA_SELECTOR }];

const CAMERA_SCHEMA = [
  { name: "camera_image", selector: { entity: { domain: "camera" } } },
  {
    name: "camera_view",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto", label: "Snapshot, refreshed every few seconds" },
          { value: "live", label: "Live stream" },
        ],
      },
    },
  },
];

const SOURCE_LABELS = {
  image: "Image",
  dark_mode_image: "Image in dark mode",
  camera_image: "Camera",
  camera_view: "Show",
};

const ELEMENT_SIZE_SCHEMA = [
  {
    name: "scale",
    selector: { number: { min: 25, max: 400, step: 5, mode: "slider", unit_of_measurement: "%" } },
  },
];

const FORM_LABELS = {
  title: "Title (optional)",
  plan_size: "Plan size (% of card width)",
  icon_color: "Icon colour",
  active_color: "Icon colour when on",
  scale: "Size",
};

// Values that mean "not set", so the option is left out of the YAML.
const FORM_DEFAULTS = { plan_size: 100, scale: 100 };

const ALIGN_ACTIONS = [
  { action: "left", icon: "mdi:align-horizontal-left", title: "Line up left edges" },
  { action: "centre", icon: "mdi:align-horizontal-center", title: "Line up centres" },
  { action: "right", icon: "mdi:align-horizontal-right", title: "Line up right edges" },
  { action: "top", icon: "mdi:align-vertical-top", title: "Line up tops" },
  { action: "middle", icon: "mdi:align-vertical-center", title: "Line up middles" },
  { action: "bottom", icon: "mdi:align-vertical-bottom", title: "Line up bottoms" },
  { action: "spread-x", icon: "mdi:distribute-horizontal-center", title: "Space evenly across", needs: 3 },
  { action: "spread-y", icon: "mdi:distribute-vertical-center", title: "Space evenly down", needs: 3 },
];

class PictureElementsPlusEditor extends HTMLElement {
  constructor() {
    super();
    this._search = "";
    this._domain = "";
    this._area = "";
    this._addAs = "auto";
    this._hideUsed = true;
    this._showAll = false;
    this._snap = loadSnapSetting();
    this._pictureIndex = 0;
    this._undo = [];
    this._redo = [];
    // Only used when there's no bridge (HA before 2026.11).
    this._localSelection = new Set();

    // HA's editor rejects element keys it doesn't know, so `visibility` and
    // `scale` are taken off each element on the way in and put back on the
    // way out. These remember which stripped copy belongs to which element.
    this._strippedCopy = new WeakMap();
    this._ownOptionsOf = new WeakMap();
    this._wrappedBridges = new WeakSet();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onInnerConfigChanged = this._onInnerConfigChanged.bind(this);
    this._onBridgeChanged = () => this._updatePanels();
    this._onSelection = () => this._renderSelection();
    this._onPictureRequest = (ev) => {
      if (!this._editingOne) this._setPicture(ev.detail);
    };
    this._onResize = (ev) => this._resizeElement(ev.detail);
    this._onDrop = (ev) => this._dropped(ev.detail);
  }

  set hass(hass) {
    const entitiesChanged =
      !this._hass ||
      hass.entities !== this._hass.entities ||
      Object.keys(hass.states).length !== Object.keys(this._hass.states).length;
    this._hass = hass;
    if (this._inner) this._inner.hass = hass;
    for (const form of [this._sizeForm, this._colorForm, this._scaleForm, this._conditionsEditor]) {
      if (form) form.hass = hass;
    }
    // States change all the time; only redraw the list when the set of
    // entities does, or typing gets laggy on big installs.
    if (entitiesChanged) this._renderPicker();
  }

  setConfig(config) {
    if (config.floors && !config.pictures) {
      const { floors, ...rest } = config;
      config = { ...rest, pictures: floors };
    }
    // Saved images that need putting right go back out, so Save keeps the fix.
    const tidy = tidyImages(config);
    if (tidy !== config) {
      config = tidy;
      setTimeout(() => fireEvent(this, "config-changed", { config: tidy }));
    }
    this._config = config;
    this._pictureIndex = clamp(this._pictureIndex, 0, pictureCount(config) - 1);
    this._captureBridge(config);
    this._inner?.setConfig(this._toInner(config));
    this._renderOptionForms();
    this._renderPictures();
    this._renderPicker();
    this._updatePanels();
  }

  connectedCallback() {
    if (!this.shadowRoot) this._build();
    // Capture, so Escape can clear a selection without closing the dialog.
    window.addEventListener("keydown", this._onKeyDown, true);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown, true);
  }

  /* ---- building ---- */

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${EDITOR_STYLES}</style>

      <details class="panel pictures">
        <summary class="panel-header">
          <ha-icon icon="mdi:image-outline"></ha-icon>
          Picture
          <span class="summary"></span>
          <span class="spacer"></span>
          <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
        </summary>
        <div class="panel-body">
          <div class="title-form"></div>
          <div class="chips picture-chips"></div>
          <div class="row picture-edit">
            <input class="text-input picture-name" placeholder="Name shown on its tab" aria-label="Name shown on its tab">
            <button class="chip icon-only picture-earlier" title="Move this image earlier"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
            <button class="chip icon-only picture-later" title="Move this image later"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
            <button class="chip icon-only danger picture-remove" title="Remove this image"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
          </div>
          <div class="row">
            <span class="label">Show</span>
            <div class="chips source"></div>
          </div>
          <div class="source-form"></div>
          <div class="chips">
            <button class="chip dark-mode-toggle"><ha-icon icon="mdi:weather-night"></ha-icon>Different image in dark mode</button>
          </div>
          <div class="dark-form"></div>
          <p class="hint source-hint"></p>
          <p class="hint picture-hint"></p>
        </div>
      </details>

      <div class="inner"></div>

      <div class="panel element-size" hidden>
        <div class="panel-header">
          <ha-icon icon="mdi:resize"></ha-icon>
          Size
        </div>
        <div class="panel-body">
          <div class="scale-form"></div>
          <p class="hint">How big this element is compared to normal. It
            grows from its centre, so it stays where you put it.</p>
        </div>
      </div>

      <div class="panel visibility" hidden>
        <div class="panel-header">
          <ha-icon icon="mdi:eye-outline"></ha-icon>
          Visibility
        </div>
        <div class="panel-body">
          <div class="conditions"></div>
          <p class="hint">Show this element only when all of these are true.
            It always shows (faded) while you're editing.</p>
        </div>
      </div>

      <div class="panel move-picture" hidden>
        <div class="panel-header">
          <ha-icon icon="mdi:swap-vertical"></ha-icon>
          Move to another image
        </div>
        <div class="panel-body">
          <div class="chips move-picture-chips"></div>
          <p class="hint">It keeps its position on the plan.</p>
        </div>
      </div>

      <div class="panel selection" hidden>
        <div class="panel-header">
          <ha-icon icon="mdi:select-group"></ha-icon>
          <span class="selection-title"></span>
          <span class="spacer"></span>
          <button class="chip selection-clear">Clear</button>
        </div>
        <div class="panel-body">
          <div class="row">
            <span class="label">Line up</span>
            <div class="chips align"></div>
          </div>
          <div class="row">
            <span class="label">Size</span>
            <div class="chips selection-size"></div>
          </div>
          <div class="row selection-picture-row">
            <span class="label">Move to</span>
            <div class="chips selection-picture"></div>
          </div>
          <div class="row">
            <button class="chip danger selection-remove">Remove from plan</button>
          </div>
          <p class="hint">Shift-click elements in the preview to add or remove
            them. Drag any of them, or use the arrow keys, to move them all.</p>
        </div>
      </div>

      <div class="panel picker">
        <div class="panel-header">
          <ha-icon icon="mdi:map-marker-plus-outline"></ha-icon>
          Add to plan
        </div>
        <div class="row">
          <label class="search">
            <ha-icon icon="mdi:magnify"></ha-icon>
            <input type="search" placeholder="Search entities, e.g. kitchen light" autocomplete="off">
          </label>
          <select class="area" title="Room"></select>
        </div>
        <div class="row"><div class="chips domains"></div></div>
        <div class="row">
          <span class="label">Add as</span>
          <div class="chips add-as"></div>
        </div>
        <div class="row fill" hidden>
          <button class="chip primary fill-room"></button>
          <span class="hint fill-hint"></span>
        </div>
        <div class="results"></div>
        <div class="footer">
          <div class="row">
            <span class="label">Other</span>
            <div class="chips others"></div>
          </div>
          <div class="row">
            <label class="chip">
              <input type="checkbox" class="hide-used"> Hide ones already on the plan
            </label>
            <label class="chip">
              <input type="checkbox" class="show-all"> Include hidden &amp; diagnostic
            </label>
          </div>
          <div class="row">
            <span class="label">Snap</span>
            <div class="chips snap"></div>
          </div>
        </div>
      </div>

      <div class="panel plan-style">
        <div class="panel-header">
          <ha-icon icon="mdi:arrow-expand-horizontal"></ha-icon>
          Plan style
        </div>
        <div class="panel-body">
          <div class="size-form"></div>
          <p class="hint">Make the plan bigger to make the icons look smaller
            on it, or smaller to make them look bigger. Over 100% the card
            scrolls sideways. The preview shows the plan's size in pixels.</p>
          <div class="chips">
            <button class="chip reset-size">Back to normal size</button>
          </div>
        </div>
      </div>

      <div class="panel colours">
        <div class="panel-header">
          <ha-icon icon="mdi:palette-outline"></ha-icon>
          Colour override
        </div>
        <div class="panel-body">
          <div class="color-form"></div>
          <p class="hint">The colours you pick here apply to every state icon
            on this card: one for when it's off, and one for when it's on (lights,
            open doors, people at home and so on). Leave them empty to use Home
            Assistant's own colours. An element with its own colour in its
            style keeps it.</p>
          <div class="chips">
            <button class="chip reset-colors">Use Home Assistant's colours</button>
          </div>
        </div>
      </div>

      <p class="tips">
        Click an entity to put it on the plan, or drag it to the spot you want.
        Drag elements in the preview to move them. With one selected, the
        arrow keys nudge it (<kbd>Shift</kbd> for bigger steps, <kbd>Alt</kbd>
        for 0.1%). <kbd>Shift</kbd>-click to pick several.
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes, <kbd>Ctrl</kbd>+<kbd>Y</kbd> redoes.
      </p>
    `;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    this._picker = $(".picker");
    this._picturesPanel = $(".pictures");
    this._selectionPanel = $(".selection");
    this._planStylePanel = $(".plan-style");
    this._coloursPanel = $(".colours");
    this._elementSizePanel = $(".element-size");
    this._visibilityPanel = $(".visibility");
    this._movePicturePanel = $(".move-picture");
    this._tips = $(".tips");
    this._resultsEl = $(".results");
    this._domainsEl = $(".domains");
    this._areaEl = $(".area");

    const searchInput = $(".search input");
    searchInput.addEventListener("input", () => {
      this._search = searchInput.value;
      this._renderResults();
    });
    // Enter adds the top result, handy when you know what you're after.
    searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && this._lastResults?.length) {
        ev.preventDefault();
        this._addEntity(this._lastResults[0].entityId);
      }
    });

    this._areaEl.addEventListener("change", () => {
      this._area = this._areaEl.value;
      this._renderResults();
    });

    const hideUsed = $(".hide-used");
    hideUsed.checked = this._hideUsed;
    hideUsed.addEventListener("change", () => {
      this._hideUsed = hideUsed.checked;
      this._renderResults();
    });

    const showAll = $(".show-all");
    showAll.checked = this._showAll;
    showAll.addEventListener("change", () => {
      this._showAll = showAll.checked;
      this._renderPicker();
    });

    $(".reset-size").addEventListener("click", () => this._clearOptions(["plan_size"]));
    $(".reset-colors").addEventListener("click", () => this._clearOptions(["icon_color", "active_color"]));
    $(".fill-room").addEventListener("click", () => this._fillRoom());

    this._resultsEl.addEventListener("click", (ev) => {
      const button = ev.target.closest(".result");
      if (button) this._addEntity(button.dataset.entity);
    });
    this._resultsEl.addEventListener("dragstart", (ev) => {
      const button = ev.target.closest?.(".result");
      if (button) startDrag(ev, { entity: button.dataset.entity });
    });

    // Pictures
    $(".picture-name").addEventListener("change", (ev) => this._renamePicture(ev.target.value));
    $(".picture-earlier").addEventListener("click", () => this._movePicture(-1));
    $(".picture-later").addEventListener("click", () => this._movePicture(1));
    $(".picture-remove").addEventListener("click", () => this._removePicture());
    $(".dark-mode-toggle").addEventListener("click", () => {
      this._darkModeFor = this._pictureIndex;
      this._renderSource();
    });

    // Selection
    $(".selection-clear").addEventListener("click", () => this._setSelection([]));
    $(".selection-remove").addEventListener("click", () => this._removeSelected());

    this._renderAddAs();
    this._renderOthers();
    this._renderSnap();
    this._renderAlignChips();
    this._renderOptionForms();
    this._renderPictures();
    this._loadInnerEditor();
  }

  async _loadInnerEditor() {
    const cardClass = await loadPictureElementsCard();
    const inner = await cardClass.getConfigElement();
    inner.addEventListener("config-changed", this._onInnerConfigChanged);
    if (this._hass) inner.hass = this._hass;
    if (this._config) inner.setConfig(this._toInner(this._config));
    this.shadowRoot.querySelector(".inner").append(inner);
    this._inner = inner;

    // HA's editor swaps between its element list and the form for a single
    // element. Watch for that to hide the old add button and to switch our
    // panels around.
    const watch = () => {
      this._tidyBuiltInEditor();
      this._updatePanels();
    };
    await inner.updateComplete;
    new MutationObserver(watch).observe(inner.shadowRoot, { childList: true, subtree: true });
    watch();
  }

  // Our own panels replace two parts of HA's editor: the "Add new element"
  // dropdown, and the "Card options" form (the Picture panel does that
  // job). If HA changes its markup they simply show up again.
  _tidyBuiltInEditor() {
    this._addStyles(this._inner?.shadowRoot, HIDE_CARD_OPTIONS);
    const rowEditor = this._inner?.shadowRoot?.querySelector("hui-picture-elements-card-row-editor");
    this._addStyles(rowEditor?.shadowRoot, HIDE_ADD_BUTTON);
  }

  _addStyles(shadow, css) {
    if (!shadow) return;
    shadow.__pepStyles = shadow.__pepStyles || new Set();
    if (shadow.__pepStyles.has(css)) return;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      shadow.__pepStyles.add(css);
    } catch (err) {
      // Older browser without constructable stylesheets. Leave it be.
    }
  }

  get _subEditor() {
    return this._inner?.shadowRoot?.querySelector("hui-sub-element-editor");
  }

  get _editingOne() {
    return !!this._subEditor;
  }

  // Back from a single element to the list.
  _closeElement() {
    this._subEditor?.dispatchEvent(new CustomEvent("go-back"));
  }

  // Which of our panels show depends on what HA's editor is showing.
  _updatePanels() {
    if (!this._picker) return;
    const editingOne = this._editingOne;
    for (const panel of [this._picker, this._picturesPanel, this._planStylePanel, this._coloursPanel]) {
      panel.hidden = editingOne;
    }
    this._tips.hidden = !this._bridge;
    this._renderSelection();

    const index = editingOne ? this._bridge?.selectedIndex : undefined;
    const element = index !== undefined ? this._pictureElements[index] : undefined;
    const canHaveVisibility = element && element.type !== "conditional";
    this._visibilityPanel.hidden = !canHaveVisibility;
    if (canHaveVisibility) this._renderConditions(index, element);

    this._elementSizePanel.hidden = !element || !canScale(element);
    if (!this._elementSizePanel.hidden) this._renderScaleForm(element);

    this._movePicturePanel.hidden = !element || pictureCount(this._config) < 2;
    if (!this._movePicturePanel.hidden) this._renderMovePictureChips(index);
  }

  /* ---- config plumbing ---- */

  get _pictureElements() {
    return elementsOf(this._config, this._pictureIndex);
  }

  // What HA's editor gets: the current picture, without our own options on
  // the card or its elements.
  _toInner(config) {
    const inner = tidyImage(pictureView(config, this._pictureIndex));
    if (inner.image === SAMPLE_IMAGE) inner.image = SAMPLE_PLAN;
    inner.elements = inner.elements.map((element) => {
      if (!OWN_ELEMENT_OPTIONS.some((key) => key in element)) return element;
      let copy = this._strippedCopy.get(element);
      if (!copy) {
        copy = { ...element };
        const own = {};
        for (const key of OWN_ELEMENT_OPTIONS) {
          if (key in copy) own[key] = copy[key];
          delete copy[key];
        }
        this._strippedCopy.set(element, copy);
        this._ownOptionsOf.set(copy, own);
      }
      return copy;
    });
    this._lastInnerElements = inner.elements;
    return inner;
  }

  // And back again: put our options back on, and the picture back in its place.
  _fromInner(inner) {
    const previous = this._lastInnerElements || [];
    const selected = this._bridge?.selectedIndex;
    const elements = (inner.elements || []).map((element, index) => {
      // Moved or reordered elements are the same object as before. An
      // element edited in HA's form is a new object, but it's the selected one.
      let own = this._ownOptionsOf.get(element);
      if (!own && index === selected && previous[index]) {
        own = this._ownOptionsOf.get(previous[index]);
      }
      return own ? { ...element, ...own } : element;
    });

    const config = { ...inner, elements };
    if (config.image !== undefined && isPlaceholder(config.image)) config.image = SAMPLE_IMAGE;
    for (const key of OWN_OPTIONS) {
      if (this._config?.[key] !== undefined) config[key] = this._config[key];
    }

    const pictures = picturesOf(this._config);
    if (pictures) {
      // Picture settings go back on the picture; the rest stays on the card.
      const picture = { name: pictures[this._pictureIndex].name };
      for (const key of PICTURE_KEYS) {
        if (key in config) picture[key] = config[key];
        delete config[key];
      }
      config.pictures = pictures.map((f, i) => (i === this._pictureIndex ? picture : f));
    }
    return config;
  }

  // Everything HA's editor changes passes through here on its way out.
  _onInnerConfigChanged(ev) {
    ev.stopPropagation();
    const config = this._fromInner(ev.detail.config);
    this._captureBridge(config);
    this._remember(config);
    this._config = config;
    this._lastInnerElements = ev.detail.config.elements;
    fireEvent(this, "config-changed", { config });
    this._renderResults();
  }

  _emitConfig(config) {
    this._remember(config);
    this._config = config;
    try {
      this._inner?.setConfig(this._toInner(config));
    } catch (err) {
      // HA's editor refuses some YAML-only settings. The change still goes
      // out, and HA shows the code editor for it.
      console.warn("picture-elements-plus:", err.message);
    }
    fireEvent(this, "config-changed", { config });
    this._renderPictures();
    this._renderResults();
  }

  _clearOptions(keys) {
    const config = { ...this._config };
    for (const key of keys) delete config[key];
    this._emitConfig(config);
    this._renderOptionForms();
  }

  /* ---- undo ---- */

  // Keeps the config from before a change. Changes that don't change
  // anything (like HA handing over its bridge) are skipped.
  _remember(next) {
    if (!this._config || JSON.stringify(next) === JSON.stringify(this._config)) return;
    this._undo.push(this._config);
    if (this._undo.length > UNDO_LIMIT) this._undo.shift();
    this._redo = [];
  }

  _undoRedo(from, to) {
    const config = from.pop();
    if (!config) return;
    to.push(this._config);
    // Old configs may carry an old bridge, so put the current one on.
    const restored = { ...config };
    if (this._bridgeKey) restored[this._bridgeKey] = this._bridge;
    this._config = restored;
    this._pictureIndex = clamp(this._pictureIndex, 0, pictureCount(restored) - 1);
    if (this._link) this._link.picture = this._pictureIndex;
    // The open element may not exist any more.
    if (this._editingOne && this._bridge?.selectedIndex >= this._pictureElements.length) {
      this._closeElement();
    }
    this._setSelection([]);
    this._inner?.setConfig(this._toInner(restored));
    fireEvent(this, "config-changed", { config: restored });
    this._link?.events.dispatchEvent(new CustomEvent("picture"));
    this._renderOptionForms();
    this._renderPictures();
    this._renderResults();
    this._updatePanels();
  }

  /* ---- the bridge ---- */

  get _link() {
    return editorLink(this._bridge);
  }

  _selection() {
    return this._link?.selection || this._localSelection;
  }

  _setSelection(indexes) {
    const selection = this._selection();
    selection.clear();
    for (const index of indexes) selection.add(index);
    this._link?.events.dispatchEvent(new CustomEvent("selection"));
    this._renderSelection();
  }

  // Grab HA's bridge so we can snap moves, move groups and nudge with the
  // keyboard.
  _captureBridge(config) {
    const key = findBridgeKey(config);
    const bridge = key && config[key];
    if (!bridge || bridge === this._bridge) return;

    if (this._bridge) {
      const old = editorLink(this._bridge);
      this._bridge.removeEventListener("changed", this._onBridgeChanged);
      old.events.removeEventListener("selection", this._onSelection);
      old.events.removeEventListener("picture-request", this._onPictureRequest);
      old.events.removeEventListener("resize", this._onResize);
      old.events.removeEventListener("drop", this._onDrop);
    }
    this._bridge = bridge;
    this._bridgeKey = key;
    const link = editorLink(bridge);
    link.picture = this._pictureIndex;
    bridge.addEventListener("changed", this._onBridgeChanged);
    link.events.addEventListener("selection", this._onSelection);
    link.events.addEventListener("picture-request", this._onPictureRequest);
    link.events.addEventListener("resize", this._onResize);
    link.events.addEventListener("drop", this._onDrop);
    this._updatePanels();

    // HA has no hook for adjusting a move, so wrap the handlers it calls
    // when an element is dropped, or placed by clicking the image.
    if (this._wrappedBridges.has(bridge)) return;
    this._wrappedBridges.add(bridge);
    const { handlers } = bridge;
    const originalMove = handlers.moveElement;
    const originalClick = handlers.clickImage;

    handlers.moveElement = (index, left, top) => {
      const selection = this._selection();
      const group = selection.size > 1 && selection.has(index);
      const skip = group ? selection : new Set([index]);
      const snapped = snapPosition(left, top, this._pictureElements, skip, this._snap);
      if (group) this._moveGroup(index, snapped.left, snapped.top);
      else originalMove(index, snapped.left, snapped.top);
    };
    handlers.clickImage = (left, top) => {
      const snapped = snapPosition(left, top, this._pictureElements, new Set([bridge.selectedIndex]), this._snap);
      originalClick(snapped.left, snapped.top);
    };
    // Kept for nudging, which shouldn't be pulled back onto the grid.
    this._moveWithoutSnap = originalMove;
  }

  // Moves every picked element by however far `index` moved.
  _moveGroup(index, left, top) {
    const elements = this._pictureElements;
    const start = positionOf(elements[index]);
    if (!start) return;
    this._shiftElements(this._selection(), left - start.left, top - start.top);
  }

  _shiftElements(indexes, dx, dy) {
    const elements = [...this._pictureElements];
    for (const i of indexes) {
      const from = positionOf(elements[i]);
      if (from) elements[i] = withPosition(elements[i], from.left + dx, from.top + dy);
    }
    this._emitConfig(withElements(this._config, this._pictureIndex, elements));
  }

  // The preview's corner handle resized a room glow.
  _resizeElement({ index, width, height }) {
    const elements = [...this._pictureElements];
    if (!elements[index]) return;
    elements[index] = {
      ...elements[index],
      style: { ...elements[index].style, width: `${width}%`, height: `${height}%` },
    };
    this._emitConfig(withElements(this._config, this._pictureIndex, elements));
    // HA's form for the open element keeps its own copy of the element.
    // Moving it to where it already is makes HA pick up the new size.
    const position = positionOf(elements[index]);
    if (position && this._moveWithoutSnap) this._moveWithoutSnap(index, position.left, position.top);
  }

  _onKeyDown(ev) {
    if (isTypingTarget(ev.composedPath()[0])) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();

    if (ctrl && (key === "z" || key === "y")) {
      const redo = key === "y" || ev.shiftKey;
      const stack = redo ? this._redo : this._undo;
      if (!stack.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (redo) this._undoRedo(this._redo, this._undo);
      else this._undoRedo(this._undo, this._redo);
      return;
    }

    const selection = this._selection();
    if (ev.key === "Escape" && selection.size) {
      ev.preventDefault();
      ev.stopPropagation();
      this._setSelection([]);
      return;
    }

    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[ev.key];
    const bridge = this._bridge;
    if (!move || ctrl || !bridge?.active || !this._moveWithoutSnap) return;

    let step = this._snap || 1;
    if (ev.shiftKey) step *= 5;
    if (ev.altKey) step = 0.1;
    const dx = move[0] * step;
    const dy = move[1] * step;

    // Several picked: move them all.
    if (selection.size) {
      ev.preventDefault();
      this._shiftElements(selection, dx, dy);
      return;
    }

    const index = bridge.selectedIndex;
    const position = index !== undefined ? positionOf(this._pictureElements[index]) : undefined;
    if (!position) return;
    ev.preventDefault();
    this._moveWithoutSnap(
      index,
      clamp(roundTo(position.left + dx, 0.1)),
      clamp(roundTo(position.top + dy, 0.1))
    );
  }

  /* ---- pictures ---- */

  _setPicture(index) {
    const count = pictureCount(this._config);
    if (index < 0 || index >= count || index === this._pictureIndex) return;
    this._pictureIndex = index;
    if (this._link) this._link.picture = index;
    this._setSelection([]);
    this._inner?.setConfig(this._toInner(this._config));
    this._link?.events.dispatchEvent(new CustomEvent("picture"));
    this._renderPictures();
    this._renderResults();
  }

  _renderPictures() {
    if (!this._picturesPanel || !this._config) return;
    const pictures = picturesOf(this._config);
    const $ = (selector) => this.shadowRoot.querySelector(selector);

    this._titleForm = this._optionForm(".title-form", TITLE_SCHEMA, ["title"]);

    // Closed out of the way normally; open on a new card that still has the
    // sample plan, as picking your picture is the first job.
    if (!this._picturesPanelSet) {
      this._picturesPanelSet = true;
      const view = pictureView(this._config, this._pictureIndex);
      this._picturesPanel.open = !view.camera_image && isPlaceholder(view.image);
    }

    const chips = $(".picture-chips");
    const names = pictures ? pictures.map((picture, i) => picture.name || `Image ${i + 1}`) : [];
    chips.innerHTML =
      names
        .map((name, i) => `<button class="chip" data-picture="${i}" aria-pressed="${i === this._pictureIndex}">${escapeHtml(name)}</button>`)
        .join("") +
      `<button class="chip add-picture"><ha-icon icon="mdi:plus"></ha-icon>${pictures ? "Add image" : "Add another image"}</button>`;
    for (const button of chips.querySelectorAll("[data-picture]")) {
      button.addEventListener("click", () => this._setPicture(Number(button.dataset.picture)));
    }
    chips.querySelector(".add-picture").addEventListener("click", () => this._addPicture());

    $(".picture-edit").hidden = !pictures;
    if (pictures) {
      const input = $(".picture-name");
      if (this.shadowRoot.activeElement !== input) input.value = pictures[this._pictureIndex]?.name || "";
      $(".picture-earlier").disabled = this._pictureIndex === 0;
      $(".picture-later").disabled = this._pictureIndex === pictures.length - 1;
    }
    $(".picture-hint").textContent = pictures
      ? "Each image has its own elements. The card shows the names as tabs to switch between them."
      : "Add another image to show several in one card, with tabs to switch between them: floors, rooms, the garden, anything.";

    this._renderSource();
  }

  /* ---- what the picture shows: an image or a camera ---- */

  get _sourceMode() {
    const view = pictureView(this._config, this._pictureIndex);
    if (view.camera_image) return "camera";
    return this._cameraChosenFor === this._pictureIndex ? "camera" : "image";
  }

  _renderSource() {
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    const mode = this._sourceMode;
    this._renderChoiceChips(
      ".source",
      [
        { mode: "image", label: "Image", icon: "mdi:image-outline" },
        { mode: "camera", label: "Camera", icon: "mdi:cctv" },
      ],
      (item) => item.mode === mode,
      (item) => this._setSourceMode(item.mode)
    );

    const view = pictureView(this._config, this._pictureIndex);
    const container = $(".source-form");
    if (!this._sourceForm) {
      this._sourceForm = document.createElement("ha-form");
      this._sourceForm.computeLabel = (field) => SOURCE_LABELS[field.name];
      this._sourceForm.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._sourceChanged(ev.detail.value);
      });
      container.append(this._sourceForm);
    }
    this._sourceForm.hass = this._hass;
    this._sourceForm.schema = mode === "camera" ? CAMERA_SCHEMA : IMAGE_SCHEMA;
    // HA's image picker works with media objects; plain URLs are wrapped.
    // The sample plan shows as an empty picker, inviting you to upload yours,
    // rather than as a screenful of image code.
    const asMedia = (image) => {
      if (isPlaceholder(image)) return undefined;
      return typeof image === "string" ? { media_content_id: image } : image;
    };
    this._sourceForm.data = mode === "camera"
      ? { camera_image: view.camera_image, camera_view: view.camera_view || "auto" }
      : { image: asMedia(view.image) };

    // The dark mode image is tucked away until it's wanted.
    const showDark = mode === "image" && (view.dark_mode_image || this._darkModeFor === this._pictureIndex);
    $(".dark-mode-toggle").hidden = mode !== "image" || !!showDark;
    const darkContainer = $(".dark-form");
    darkContainer.hidden = !showDark;
    if (showDark) {
      if (!this._darkForm) {
        this._darkForm = document.createElement("ha-form");
        this._darkForm.schema = DARK_IMAGE_SCHEMA;
        this._darkForm.computeLabel = (field) => SOURCE_LABELS[field.name];
        this._darkForm.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const media = ev.detail.value.dark_mode_image;
          const id = typeof media === "object" ? media?.media_content_id : media;
          if (!id) this._darkModeFor = undefined;
          this._setPictureSettings({ dark_mode_image: id ? media : undefined });
        });
        darkContainer.append(this._darkForm);
      }
      this._darkForm.hass = this._hass;
      this._darkForm.data = { dark_mode_image: asMedia(view.dark_mode_image) };
    }

    // A one-line summary for when the panel is closed.
    const pictures = picturesOf(this._config);
    const imageName = (image) => {
      if (isPlaceholder(image)) return "sample plan";
      const id = typeof image === "object" ? image.media_content_id : image;
      return String(id || "").split("/").pop();
    };
    $(".pictures .summary").textContent = pictures
      ? pictures.map((picture, i) => picture.name || `Image ${i + 1}`).join(", ")
      : view.camera_image || imageName(view.image);

    // Settings this panel doesn't show still work, so say they're there.
    const hidden = ["state_image", "image_entity", "state_filter", "dark_mode_filter", "theme"]
      .filter((key) => view[key] !== undefined);
    const hints = [];
    if (mode === "image" && isPlaceholder(view.image)) {
      hints.push("Showing the sample plan. Upload your own picture (PNG, JPG or SVG), or pick one from your media, above.");
    }
    if (mode === "camera" && !view.camera_image) {
      hints.push("Pick a camera. The image stays on until you do.");
    }
    if (hidden.length) {
      hints.push(`Also set in the code editor: ${hidden.join(", ")}.`);
    }
    $(".source-hint").textContent = hints.join(" ");
  }

  _setSourceMode(mode) {
    if (mode === this._sourceMode) return;
    if (mode === "camera") {
      // Keep the image until a camera is picked, or the card has nothing to show.
      this._cameraChosenFor = this._pictureIndex;
      this._renderSource();
      return;
    }
    this._cameraChosenFor = undefined;
    const view = pictureView(this._config, this._pictureIndex);
    this._setPictureSettings({
      camera_image: undefined,
      camera_view: undefined,
      image: view.image ||
        (this._imageBeforeCamera?.index === this._pictureIndex && this._imageBeforeCamera.image) ||
        SAMPLE_IMAGE,
    });
  }

  _sourceChanged(value) {
    if (this._sourceMode === "camera") {
      if (!value.camera_image) return;
      // Remembered in case you switch back to an image.
      const view = pictureView(this._config, this._pictureIndex);
      if (view.image) this._imageBeforeCamera = { index: this._pictureIndex, image: view.image };
      this._setPictureSettings({
        camera_image: value.camera_image,
        camera_view: value.camera_view && value.camera_view !== "auto" ? value.camera_view : undefined,
        image: undefined,
        dark_mode_image: undefined,
      });
      return;
    }
    const fromMedia = (media) => {
      const id = typeof media === "object" ? media?.media_content_id : media;
      if (!id) return undefined;
      return isPlaceholder(media) ? SAMPLE_IMAGE : media;
    };
    // Clearing the picture goes back to the sample plan, so the card always
    // has something to show.
    this._setPictureSettings({ image: fromMedia(value.image) || SAMPLE_IMAGE });
  }

  // Changes settings of the image being edited: on the card itself when
  // there's only one, otherwise on its entry in `pictures`.
  _setPictureSettings(changes) {
    const apply = (target) => {
      const next = { ...target };
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      return next;
    };
    const pictures = picturesOf(this._config);
    const config = pictures
      ? { ...this._config, pictures: pictures.map((p, i) => (i === this._pictureIndex ? apply(p) : p)) }
      : apply(this._config);
    this._emitConfig(config);
  }

  _addPicture() {
    let config = { ...this._config };
    let pictures = picturesOf(config);
    if (!pictures) {
      // The card's own image and elements become the first picture.
      const first = { name: "Image 1" };
      for (const key of PICTURE_KEYS) {
        if (key in config) first[key] = config[key];
        delete config[key];
      }
      pictures = [first];
    }
    const name = `Image ${pictures.length + 1}`;
    config.pictures = [...pictures, { name, image: SAMPLE_IMAGE, elements: [] }];
    this._emitConfig(config);
    this._setPicture(config.pictures.length - 1);
    // Straight into naming it.
    const input = this.shadowRoot.querySelector(".picture-name");
    input.focus();
    input.select();
  }

  _renamePicture(name) {
    const pictures = picturesOf(this._config);
    if (!pictures) return;
    const trimmed = name.trim() || `Image ${this._pictureIndex + 1}`;
    this._emitConfig({
      ...this._config,
      pictures: pictures.map((picture, i) => (i === this._pictureIndex ? { ...picture, name: trimmed } : picture)),
    });
    this._link?.events.dispatchEvent(new CustomEvent("picture"));
  }

  _movePicture(direction) {
    const pictures = [...(picturesOf(this._config) || [])];
    const from = this._pictureIndex;
    const to = from + direction;
    if (to < 0 || to >= pictures.length) return;
    [pictures[from], pictures[to]] = [pictures[to], pictures[from]];
    this._pictureIndex = to;
    if (this._link) this._link.picture = to;
    this._emitConfig({ ...this._config, pictures });
    this._link?.events.dispatchEvent(new CustomEvent("picture"));
  }

  _removePicture() {
    const pictures = picturesOf(this._config);
    if (!pictures) return;
    const remaining = pictures.filter((_, i) => i !== this._pictureIndex);
    let config = { ...this._config };
    if (remaining.length === 1) {
      // Back to a plain single-picture card.
      delete config.pictures;
      const { name, ...picture } = remaining[0];
      Object.assign(config, picture);
    } else {
      config.pictures = remaining;
    }
    this._pictureIndex = Math.max(0, this._pictureIndex - 1);
    if (this._link) this._link.picture = this._pictureIndex;
    this._setSelection([]);
    this._emitConfig(config);
    this._link?.events.dispatchEvent(new CustomEvent("picture"));
  }

  _moveToPicture(indexes, target) {
    const pictures = picturesOf(this._config);
    if (!pictures || target === this._pictureIndex) return;
    const moving = new Set(indexes);
    const elements = this._pictureElements;
    const moved = elements.filter((_, i) => moving.has(i));
    const staying = elements.filter((_, i) => !moving.has(i));
    this._closeElement();
    this._setSelection([]);
    this._emitConfig({
      ...this._config,
      pictures: pictures.map((picture, i) => {
        if (i === this._pictureIndex) return { ...picture, elements: staying };
        if (i === target) return { ...picture, elements: [...(picture.elements || []), ...moved] };
        return picture;
      }),
    });
  }

  _renderMovePictureChips(index) {
    const pictures = picturesOf(this._config) || [];
    this._renderChoiceChips(
      ".move-picture-chips",
      pictures.map((picture, i) => ({ i, label: escapeHtml(picture.name || `Image ${i + 1}`) })).filter((f) => f.i !== this._pictureIndex),
      () => false,
      (item) => this._moveToPicture([index], item.i)
    );
  }

  /* ---- several picked ---- */

  _renderAlignChips() {
    const container = this.shadowRoot.querySelector(".align");
    container.innerHTML = ALIGN_ACTIONS.map((item) => `
      <button class="chip icon-only" data-action="${item.action}" title="${item.title}" aria-label="${item.title}">
        <ha-icon icon="${item.icon}"></ha-icon>
      </button>`).join("");
    for (const button of container.querySelectorAll(".chip")) {
      button.addEventListener("click", () => this._align(button.dataset.action));
    }
  }

  _renderSelection() {
    const panel = this._selectionPanel;
    if (!panel || !this._config) return;
    const elements = this._pictureElements;
    const selection = this._selection();
    // Drop anything that's gone, e.g. after an element was deleted.
    for (const index of [...selection]) {
      if (!elements[index]) selection.delete(index);
    }
    panel.hidden = !selection.size || this._editingOne;
    if (panel.hidden) return;

    const count = selection.size;
    this.shadowRoot.querySelector(".selection-title").textContent =
      `${count} element${count === 1 ? "" : "s"} picked`;
    for (const button of panel.querySelectorAll(".align .chip")) {
      const needs = ALIGN_ACTIONS.find((a) => a.action === button.dataset.action).needs || 2;
      button.disabled = count < needs;
    }

    const scales = [...selection].map((i) => elements[i]).filter(canScale).map((e) => Number(e.scale) || 100);
    const same = scales.length && scales.every((s) => s === scales[0]) ? scales[0] : undefined;
    this._renderChoiceChips(
      ".selection-size",
      SIZE_CHOICES.map((size) => ({ size, label: `${size}%` })),
      (item) => item.size === same,
      (item) => this._setScale([...selection], item.size)
    );

    const pictures = picturesOf(this._config);
    this.shadowRoot.querySelector(".selection-picture-row").hidden = !pictures;
    if (pictures) {
      this._renderChoiceChips(
        ".selection-picture",
        pictures.map((picture, i) => ({ i, label: escapeHtml(picture.name || `Image ${i + 1}`) })).filter((f) => f.i !== this._pictureIndex),
        () => false,
        (item) => this._moveToPicture([...selection], item.i)
      );
    }
  }

  // Lines up or spreads out the picked elements. Works on their positions,
  // which are their centres, so "left" lines up the left-most centre.
  _align(action) {
    const elements = [...this._pictureElements];
    const picked = [...this._selection()]
      .map((index) => ({ index, position: positionOf(elements[index]) }))
      .filter((item) => item.position);
    if (picked.length < 2) return;

    const lefts = picked.map((p) => p.position.left);
    const tops = picked.map((p) => p.position.top);
    const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;
    const target = {
      left: Math.min(...lefts),
      centre: average(lefts),
      right: Math.max(...lefts),
      top: Math.min(...tops),
      middle: average(tops),
      bottom: Math.max(...tops),
    }[action];

    if (action === "spread-x" || action === "spread-y") {
      const axis = action === "spread-x" ? "left" : "top";
      picked.sort((a, b) => a.position[axis] - b.position[axis]);
      const first = picked[0].position[axis];
      const gap = (picked[picked.length - 1].position[axis] - first) / (picked.length - 1);
      picked.forEach((item, i) => { item.position[axis] = first + gap * i; });
    } else {
      const axis = ["left", "centre", "right"].includes(action) ? "left" : "top";
      for (const item of picked) item.position[axis] = target;
    }

    for (const { index, position } of picked) {
      elements[index] = withPosition(elements[index], position.left, position.top);
    }
    this._emitConfig(withElements(this._config, this._pictureIndex, elements));
  }

  _setScale(indexes, size) {
    const elements = [...this._pictureElements];
    for (const index of indexes) {
      if (!canScale(elements[index])) continue;
      const { scale, ...rest } = elements[index];
      elements[index] = size === 100 ? rest : { ...rest, scale: size };
    }
    this._emitConfig(withElements(this._config, this._pictureIndex, elements));
    this._renderSelection();
  }

  _removeSelected() {
    const selection = this._selection();
    const elements = this._pictureElements.filter((_, i) => !selection.has(i));
    this._setSelection([]);
    this._emitConfig(withElements(this._config, this._pictureIndex, elements));
  }

  /* ---- option forms ---- */

  // A small ha-form for some of our own card options.
  _optionForm(selector, schema, keys) {
    const container = this.shadowRoot?.querySelector(selector);
    if (!container || !this._config) return undefined;
    let form = container.querySelector("ha-form");
    if (!form) {
      form = document.createElement("ha-form");
      form.schema = schema;
      form.computeLabel = (field) => FORM_LABELS[field.name];
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const config = { ...this._config };
        for (const key of keys) {
          const value = ev.detail.value[key];
          if (value === undefined || value === "" || value === FORM_DEFAULTS[key]) delete config[key];
          else config[key] = value;
        }
        this._emitConfig(config);
      });
      container.append(form);
    }
    form.hass = this._hass;
    const data = {};
    for (const key of keys) {
      const value = this._config[key] ?? FORM_DEFAULTS[key];
      if (value !== undefined) data[key] = value;
    }
    form.data = data;
    return form;
  }

  _renderOptionForms() {
    this._sizeForm = this._optionForm(".size-form", PLAN_SIZE_SCHEMA, ["plan_size"]);
    this._colorForm = this._optionForm(".color-form", COLOR_SCHEMA, ["icon_color", "active_color"]);
  }

  _renderScaleForm(element) {
    const container = this.shadowRoot.querySelector(".scale-form");
    if (!this._scaleForm) {
      this._scaleForm = document.createElement("ha-form");
      this._scaleForm.schema = ELEMENT_SIZE_SCHEMA;
      this._scaleForm.computeLabel = (field) => FORM_LABELS[field.name];
      this._scaleForm.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const index = this._bridge?.selectedIndex;
        if (index !== undefined) this._setScale([index], Number(ev.detail.value.scale) || 100);
      });
      container.append(this._scaleForm);
    }
    this._scaleForm.hass = this._hass;
    this._scaleForm.data = { scale: Number(element.scale) || 100 };
  }

  _renderConditions(index, element) {
    const container = this.shadowRoot.querySelector(".conditions");
    if (!customElements.get("ha-card-conditions-editor")) {
      // Only there once the dialog's Visibility tab has loaded it.
      container.innerHTML = `<p class="hint">Open the <b>Visibility</b> tab at the
        top once to load the condition editor, or add a <code>visibility:</code>
        list to this element in the code editor.</p>`;
      this._conditionsEditor = undefined;
      customElements.whenDefined("ha-card-conditions-editor").then(() => this._updatePanels());
      return;
    }
    if (!this._conditionsEditor) {
      container.innerHTML = "";
      this._conditionsEditor = document.createElement("ha-card-conditions-editor");
      this._conditionsEditor.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._setVisibility(this._conditionsIndex, ev.detail.value);
      });
      container.append(this._conditionsEditor);
    }
    this._conditionsIndex = index;
    this._conditionsEditor.hass = this._hass;
    this._conditionsEditor.conditions = element.visibility || [];
  }

  _setVisibility(index, conditions) {
    const elements = [...this._pictureElements];
    const { visibility, ...rest } = elements[index];
    elements[index] = conditions?.length ? { ...rest, visibility: conditions } : rest;
    this._emitConfig(withElements(this._config, this._pictureIndex, elements));
  }

  /* ---- picker ---- */

  _renderPicker() {
    if (!this.shadowRoot || !this._hass) return;
    this._entityList = this._buildEntityList();
    this._renderAreas();
    this._renderDomains();
    this._renderResults();
  }

  _buildEntityList() {
    const hass = this._hass;
    const list = [];
    for (const [entityId, stateObj] of Object.entries(hass.states)) {
      const entry = hass.entities?.[entityId];
      if (!this._showAll && entry && (entry.hidden || entry.entity_category)) continue;
      const area = areaOf(hass, entityId);
      const name = stateObj.attributes.friendly_name || entityId;
      list.push({
        entityId,
        name,
        domain: domainOf(entityId),
        areaId: area?.area_id || "",
        areaName: area?.name || "",
        haystack: `${name} ${entityId} ${area?.name || ""}`.toLowerCase(),
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  _renderAreas() {
    const hass = this._hass;
    const areas = Object.values(hass.areas || {});
    const floors = Object.values(hass.floors || {}).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    const option = (area) => `<option value="${escapeHtml(area.area_id)}">${escapeHtml(area.name)}</option>`;
    const byName = (a, b) => a.name.localeCompare(b.name);

    let options = `<option value="">Any room</option>`;
    const listed = new Set();
    for (const floor of floors) {
      const onFloor = areas.filter((area) => area.floor_id === floor.floor_id).sort(byName);
      if (!onFloor.length) continue;
      options += `<optgroup label="${escapeHtml(floor.name)}">`;
      for (const area of onFloor) {
        listed.add(area.area_id);
        options += option(area);
      }
      options += `</optgroup>`;
    }
    for (const area of areas.filter((a) => !listed.has(a.area_id)).sort(byName)) {
      options += option(area);
    }
    options += `<option value="__none__">No room</option>`;

    this._areaEl.innerHTML = options;
    this._areaEl.value = this._area;
  }

  _renderDomains() {
    const counts = {};
    let helpers = 0;
    for (const item of this._entityList) {
      counts[item.domain] = (counts[item.domain] || 0) + 1;
      if (HELPER_DOMAINS.has(item.domain)) helpers++;
    }
    // Most common domains first; the long tail is still reachable by search.
    const domains = Object.keys(counts)
      .filter((domain) => !HELPER_DOMAINS.has(domain))
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, 9);
    if (this._domain && this._domain !== "helpers" && !domains.includes(this._domain)) {
      domains.push(this._domain);
    }

    const chip = (value, label, count) => `
      <button class="chip" data-domain="${value}" aria-pressed="${this._domain === value}">
        ${DOMAIN_ICONS[value] ? `<ha-icon icon="${DOMAIN_ICONS[value]}"></ha-icon>` : ""}
        ${escapeHtml(label)}
        ${count !== undefined ? `<span class="count">${count}</span>` : ""}
      </button>`;

    this._domainsEl.innerHTML =
      chip("", "All") +
      (helpers ? chip("helpers", "Helpers", helpers) : "") +
      domains.map((domain) => chip(domain, prettyDomain(domain), counts[domain] || 0)).join("");

    for (const button of this._domainsEl.querySelectorAll(".chip")) {
      button.addEventListener("click", () => {
        this._domain = button.dataset.domain;
        this._renderDomains();
        this._renderResults();
      });
    }
  }

  // `label` is inserted as HTML, so callers escape anything that came from
  // the user.
  _renderChoiceChips(selector, items, isPressed, onClick) {
    const container = this.shadowRoot.querySelector(selector);
    container.innerHTML = items
      .map(
        (item, i) => `
        <button class="chip" data-i="${i}" aria-pressed="${isPressed(item)}">
          ${item.icon ? `<ha-icon icon="${item.icon}"></ha-icon>` : ""}${item.label}
        </button>`
      )
      .join("");
    for (const button of container.querySelectorAll(".chip")) {
      button.addEventListener("click", () => onClick(items[button.dataset.i]));
    }
  }

  _renderAddAs() {
    this._renderChoiceChips(".add-as", ELEMENT_TYPES, (item) => item.type === this._addAs, (item) => {
      this._addAs = item.type;
      this._renderAddAs();
    });
  }

  _renderOthers() {
    this._renderChoiceChips(".others", OTHER_ELEMENTS, () => false, (item) => this._addOther(item.type));
    this.shadowRoot.querySelectorAll(".others .chip").forEach((chip, i) => {
      const { type } = OTHER_ELEMENTS[i];
      // Conditional elements aren't placed anywhere, so there's no point dragging them.
      if (type === "conditional") return;
      chip.draggable = true;
      chip.addEventListener("dragstart", (ev) => startDrag(ev, { other: type }));
    });
  }

  _renderSnap() {
    const steps = [0, 0.5, 1, 2, 5].map((step) => ({ step, label: step ? `${step}%` : "Off" }));
    this._renderChoiceChips(".snap", steps, (item) => item.step === this._snap, (item) => {
      this._snap = item.step;
      saveSnapSetting(item.step);
      this._renderSnap();
    });
  }

  // Entities on any picture count as "on the plan".
  _entitiesOnPlan() {
    const ids = new Set();
    const walk = (elements) => {
      for (const element of elements || []) {
        if (element.entity) ids.add(element.entity);
        if (element.elements) walk(element.elements);
      }
    };
    walk(allElements(this._config));
    return ids;
  }

  _filteredEntities() {
    const words = this._search.toLowerCase().split(/\s+/).filter(Boolean);
    const onPlan = this._entitiesOnPlan();

    const matches = this._entityList.filter((item) => {
      if (this._domain === "helpers" && !HELPER_DOMAINS.has(item.domain)) return false;
      if (this._domain && this._domain !== "helpers" && item.domain !== this._domain) return false;
      if (this._area === "__none__" && item.areaId) return false;
      if (this._area && this._area !== "__none__" && item.areaId !== this._area) return false;
      if (this._hideUsed && onPlan.has(item.entityId)) return false;
      return words.every((word) => item.haystack.includes(word));
    });

    // Names that start with what you typed go to the top.
    if (words.length) {
      const first = words[0];
      const score = (item) =>
        item.name.toLowerCase().startsWith(first) ? 0 :
        item.entityId.split(".")[1].startsWith(first) ? 1 : 2;
      matches.sort((a, b) => score(a) - score(b));
    }
    return { matches, onPlan };
  }

  _renderResults() {
    if (!this._resultsEl || !this._entityList) return;
    const { matches, onPlan } = this._filteredEntities();
    this._lastResults = matches;
    this._renderFillButton(matches);

    if (!matches.length) {
      this._resultsEl.innerHTML = `<div class="empty">Nothing matches. Try another search or room.</div>`;
      return;
    }

    const shown = matches.slice(0, MAX_RESULTS);
    let html = shown
      .map(
        (item) => `
        <button class="result" draggable="true" data-entity="${escapeHtml(item.entityId)}"
          title="Click to add ${escapeHtml(item.name)}, or drag it onto the plan">
          <span class="icon"><ha-state-icon></ha-state-icon></span>
          <span class="text">
            <div class="name">${escapeHtml(item.name)}
              ${onPlan.has(item.entityId) ? `<span class="on-plan">on plan</span>` : ""}
            </div>
            <div class="id">${escapeHtml(item.entityId)}</div>
          </span>
          <span class="area">${escapeHtml(item.areaName)}</span>
          <ha-icon class="add" icon="mdi:plus-circle-outline"></ha-icon>
        </button>`
      )
      .join("");
    if (matches.length > shown.length) {
      html += `<div class="more">${matches.length - shown.length} more, keep typing to narrow it down</div>`;
    }
    this._resultsEl.innerHTML = html;

    // ha-state-icon works out the right icon (custom and state-based ones
    // included) from the state object. It's normally loaded by the time the
    // editor opens; if not, fall back to a plain icon.
    const haveStateIcon = !!customElements.get("ha-state-icon");
    const icons = this._resultsEl.querySelectorAll("ha-state-icon");
    shown.forEach((item, i) => {
      const stateObj = this._hass.states[item.entityId];
      if (haveStateIcon) {
        icons[i].hass = this._hass;
        icons[i].stateObj = stateObj;
      } else {
        const icon = document.createElement("ha-icon");
        icon.icon = stateObj.attributes.icon || DOMAIN_ICONS[item.domain] || "mdi:bookmark";
        icons[i].replaceWith(icon);
      }
    });
  }

  /* ---- filling a room ---- */

  // The room glow for the chosen room on this picture, if there is one.
  _roomGlowFor(areaId) {
    return this._pictureElements.find(
      (element) => element.type === `custom:${ROOM_TYPE}` && element.area === areaId && positionOf(element)
    );
  }

  // With a room chosen, offer to add everything listed in one go.
  _renderFillButton(matches) {
    const row = this.shadowRoot.querySelector(".fill");
    const areaId = this._area && this._area !== "__none__" ? this._area : undefined;
    row.hidden = !areaId || !matches.length;
    if (row.hidden) return;
    const areaName = this._hass.areas?.[areaId]?.name || "this room";
    const button = row.querySelector(".fill-room");
    const hint = row.querySelector(".fill-hint");
    if (matches.length > MAX_FILL) {
      button.disabled = true;
      button.textContent = `Fill ${areaName}`;
      hint.textContent = `${matches.length} listed, narrow it down to ${MAX_FILL} or fewer first.`;
      return;
    }
    button.disabled = false;
    button.innerHTML = `<ha-icon icon="mdi:view-grid-plus-outline"></ha-icon>Add all ${matches.length} to ${escapeHtml(areaName)}`;
    hint.textContent = this._roomGlowFor(areaId)
      ? "Laid out in a grid inside its room glow."
      : "Laid out in a grid and picked, so you can drag them into the room together.";
  }

  _fillRoom() {
    const matches = this._lastResults || [];
    if (!matches.length || matches.length > MAX_FILL) return;
    const glow = this._roomGlowFor(this._area);
    const aspect = this._link?.planAspect || 1.5;
    let box;
    if (glow) {
      const position = positionOf(glow);
      const width = parsePercent(glow.style.width) ?? 20;
      const height = parsePercent(glow.style.height) ?? 20;
      // Keep clear of the edges of the room.
      box = { left: position.left, top: position.top, width: width * 0.8, height: height * 0.8 };
    } else {
      // Roughly 6% of the plan's width between each one.
      const columns = Math.ceil(Math.sqrt(matches.length));
      const rows = Math.ceil(matches.length / columns);
      box = { left: 50, top: 50, width: columns * 6, height: rows * 6 * aspect };
    }

    const positions = gridPositions(matches.length, box, aspect);
    const added = matches.map((item, i) => {
      const element = this._elementForEntity(item.entityId);
      element.style = { left: `${positions[i].left}%`, top: `${positions[i].top}%` };
      return element;
    });
    const before = this._pictureElements;
    this._emitConfig(withElements(this._config, this._pictureIndex, [...before, ...added]));
    this._setSelection(added.map((_, i) => before.length + i));
  }

  /* ---- adding ---- */

  // Somewhere to drop a new element: the middle, unless something is
  // already there, in which case step down and to the right.
  _freeSpot() {
    const taken = new Set(
      this._pictureElements.map((el) => `${parsePercent(el.style?.left)},${parsePercent(el.style?.top)}`)
    );
    let left = 50;
    let top = 50;
    while (taken.has(`${left},${top}`) && left < 90) {
      left += 4;
      top += 4;
    }
    return { left: `${left}%`, top: `${top}%` };
  }

  _elementForEntity(entityId) {
    const domain = domainOf(entityId);
    let type = this._addAs;
    if (type === "auto") {
      if (BADGE_DOMAINS.has(domain)) type = "state-badge";
      else if (domain === "sensor") type = "state-label";
      else type = "state-icon";
    }

    const element = { type, entity: entityId, style: this._freeSpot() };
    // Badges already open more-info on tap, so only set actions on the rest.
    if (type !== "state-badge") {
      element.tap_action = { action: TOGGLE_DOMAINS.has(domain) ? "toggle" : "more-info" };
      element.hold_action = { action: "more-info" };
    }
    return element;
  }

  // Entities go straight onto the plan without opening their editor, so
  // you can add several in a row. The new one is picked, so it shows up
  // with a box round it and the arrow keys move it.
  _addEntity(entityId, position) {
    if (!entityId || !this._config) return;
    const element = this._elementForEntity(entityId);
    if (position) element.style = { left: `${position.left}%`, top: `${position.top}%` };
    this._addElement(element, false);
  }

  // Everything else needs setting up (text to type, a room to pick), so its
  // editor opens.
  _addOther(type, position) {
    const style = position ? { left: `${position.left}%`, top: `${position.top}%` } : this._freeSpot();
    const background = pictureView(this._config, this._pictureIndex).image;
    const backgroundUrl = typeof background === "object" ? background.media_content_id : background;
    const areaId = this._area && this._area !== "__none__" ? this._area : undefined;
    const room = PictureElementsPlusRoom.getStubConfig();
    const elements = {
      room: { ...room, ...(areaId ? { area: areaId } : {}), style: { ...room.style, ...style } },
      text: { ...PictureElementsPlusText.getStubConfig(), style },
      icon: { type, icon: "mdi:information-outline", tap_action: { action: "none" }, style },
      // A small copy of the background, just so there's something to see.
      image: {
        type,
        image: !backgroundUrl || backgroundUrl === SAMPLE_IMAGE ? SAMPLE_PLAN : backgroundUrl,
        style: { ...style, width: "10%" },
      },
      "action-button": { type, title: "Button", action: "homeassistant.update_entity", style },
      // Conditional elements only wrap others and aren't positioned themselves.
      conditional: { type, conditions: [], elements: [] },
    };
    this._addElement(elements[type], true);
  }

  _addElement(element, open) {
    // Adding while one element is open would leave its form showing.
    if (this._editingOne) this._closeElement();
    const elements = [...this._pictureElements, element];
    // Spread the old config so the bridge symbol comes along.
    this._emitConfig(withElements(this._config, this._pictureIndex, elements));
    if (open) this._bridge?.handlers.selectElement(elements.length - 1);
    else this._setSelection([elements.length - 1]);
  }

  // Something from the list was dropped on the preview.
  _dropped({ data, left, top }) {
    if (data.entity) this._addEntity(data.entity, { left, top });
    else if (data.other) this._addOther(data.other, { left, top });
  }
}

/* ------------------------------------------------------------------ */
/* Sample floor plan                                                   */
/* ------------------------------------------------------------------ */

// New cards start with this plan until you pick your own. A 4-colour PNG,
// about 9 KB.
const SAMPLE_PLAN = "data:image/png;base64,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";

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

customElements.define(TEXT_TYPE, PictureElementsPlusText);
customElements.define(`${TEXT_TYPE}-editor`, PictureElementsPlusTextEditor);
customElements.define(ROOM_TYPE, PictureElementsPlusRoom);
customElements.define(`${ROOM_TYPE}-editor`, PictureElementsPlusRoomEditor);
customElements.define(CARD_TYPE, PictureElementsPlusCard);
customElements.define(`${CARD_TYPE}-editor`, PictureElementsPlusEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "Picture Elements Plus",
  description: "A floor plan card with an entity picker, drag and snap, room glows and several images in one card.",
  preview: true,
  documentationURL: "https://github.com/MithUK1/picture-elements-plus",
});

console.info(
  `%c PICTURE-ELEMENTS-PLUS %c ${VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);
