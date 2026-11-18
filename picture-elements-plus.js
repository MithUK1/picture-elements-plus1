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
 *   - visibility conditions on any element
 *   - a text element you can drag around (it also renders templates)
 *
 * And in the editor:
 *   - a searchable entity picker in place of the "Add new element" dropdown
 *   - snapping and guide lines when dragging elements in the preview
 *   - arrow keys to nudge the selected element
 *
 * Dragging itself comes from Home Assistant (2026.11 and later). HA hands the
 * preview card a "bridge" object hidden on the config under a Symbol; we pass
 * it straight through and hook into it for snapping and nudging.
 *
 * The file is split into: shared helpers, the text element, the card, the
 * card editor, and registration at the bottom.
 */

const VERSION = "0.2.0";

const CARD_TYPE = "picture-elements-plus";
const TEXT_TYPE = "picture-elements-plus-text";

const BRIDGE_DESCRIPTION = "pictureElementsEditorBridge";
const SNAP_STORAGE_KEY = "picture-elements-plus:snap";

// Card options we handle ourselves. They're taken off the config before it
// reaches HA's card and editor, which reject keys they don't know.
const OWN_OPTIONS = ["plan_size", "icon_color", "active_color"];

// How close (in percent) a dragged element has to get to a line before it
// snaps onto it.
const ALIGN_DISTANCE = 0.8;

// The quarter and half-way lines drawn while dragging.
const PLAN_GUIDES = [25, 50, 75];

const MAX_RESULTS = 60;

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

// Shown until a real floor plan is chosen. A plain outline of a few rooms
// with a hint in the middle, small enough to live in the config.
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">` +
      `<rect width="800" height="500" fill="#f4f4f4"/>` +
      `<g fill="none" stroke="#9e9e9e" stroke-width="6">` +
      `<rect x="40" y="40" width="720" height="420"/>` +
      `<path d="M330 40v170M330 290v170M40 250h200M560 40v260M560 300h200M330 250h80"/>` +
      `</g>` +
      `<text x="400" y="240" font-family="sans-serif" font-size="26" fill="#757575" text-anchor="middle">Choose your floor plan</text>` +
      `<text x="400" y="276" font-family="sans-serif" font-size="18" fill="#9e9e9e" text-anchor="middle">Card options &gt; Image</text>` +
      `</svg>`
  );

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
          image: PLACEHOLDER_IMAGE,
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
function findBridge(config) {
  if (!config) return undefined;
  for (const key of Object.getOwnPropertySymbols(config)) {
    if (key.description === BRIDGE_DESCRIPTION) return config[key];
  }
  return undefined;
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

function clamp(value) {
  return Math.min(100, Math.max(0, value));
}

function cssColor(color) {
  if (!color) return undefined;
  return THEME_COLORS.has(color) ? `var(--${color}-color)` : color;
}

function isPlaceholder(image) {
  return !image || image === PLACEHOLDER_IMAGE;
}

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
// quarter and half-way lines of the plan.
function snapTargets(elements, skipIndex, axis) {
  const lines = [];
  (elements || []).forEach((element, index) => {
    if (index === skipIndex || !element.style) return;
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
function snapPosition(left, top, elements, index, step) {
  const result = { left, top, leftKind: undefined, topKind: undefined };
  for (const axis of ["left", "top"]) {
    const value = axis === "left" ? left : top;
    const line = nearestLine(value, snapTargets(elements, index, axis));
    result[axis] = line ? line.value : step ? roundTo(value, step) : value;
    result[`${axis}Kind`] = line?.kind;
  }
  return result;
}

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

// The form shown when you edit a text element in the card editor.
class PictureElementsPlusTextEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (field) =>
        ({ text: "Text or template", size: "Size (% of plan width)", color: "Colour", bold: "Bold" })[field.name];
      this._form.schema = [
        { name: "text", required: true, selector: { template: {} } },
        { name: "size", selector: { number: { min: 1, max: 15, step: 0.5, mode: "slider" } } },
        { name: "color", selector: { ui_color: {} } },
        { name: "bold", selector: { boolean: {} } },
      ];
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        // Keep the type and position, which the form doesn't show.
        const config = { ...this._config, ...ev.detail.value };
        fireEvent(this, "config-changed", { config });
      });
      this.append(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { size: 3, ...this._config };
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

class PictureElementsPlusCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(`${CARD_TYPE}-editor`);
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((id) =>
      ["light", "sensor", "binary_sensor"].includes(domainOf(id))
    );
    return {
      type: `custom:${CARD_TYPE}`,
      image: PLACEHOLDER_IMAGE,
      elements: entity
        ? [{ type: "state-icon", entity, style: { left: "50%", top: "50%" } }]
        : [],
    };
  }

  constructor() {
    super();
    this._preview = false;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${CARD_STYLES}</style>
      <div class="wrapper">
        <div class="overlay">
          ${PLAN_GUIDES.map((p) => `<div class="line vertical quarter" style="left:${p}%"></div>`).join("")}
          ${PLAN_GUIDES.map((p) => `<div class="line horizontal quarter" style="top:${p}%"></div>`).join("")}
          <div class="line vertical cross"></div>
          <div class="line horizontal cross"></div>
          <div class="chip position"></div>
          <div class="chip size"></div>
        </div>
      </div>
    `;
    const $ = (selector) => this.shadowRoot.querySelector(selector);
    this._wrapper = $(".wrapper");
    this._overlay = $(".overlay");
    this._crossV = $(".cross.vertical");
    this._crossH = $(".cross.horizontal");
    this._quarters = this.shadowRoot.querySelectorAll(".quarter");
    this._positionChip = $(".position");
    this._sizeChip = $(".size");

    this._onBridgeChanged = () => this._scheduleOverlay();

    // Capture phase, so we see which element was pressed before HA's drag
    // handler takes the pointer.
    this._wrapper.addEventListener("pointerdown", (ev) => {
      this._dragIndex = this._indexFromEvent(ev);
    }, true);
    this._wrapper.addEventListener("pointermove", () => this._scheduleOverlay());
    this._wrapper.addEventListener("pointerup", () => {
      this._dragIndex = undefined;
      this._scheduleOverlay();
    });

    // The size readout and text size depend on the plan's width.
    this._resizeObserver = new ResizeObserver(() => this._scheduleStyling());
    // Elements get replaced when HA rebuilds them.
    this._mutationObserver = new MutationObserver(() => this._scheduleStyling());
  }

  setConfig(config) {
    // Same checks the built-in card makes, so errors show straight away even
    // before HA's card has loaded.
    if (!config) throw new Error("Invalid configuration");
    if (
      !(config.image || config.image_entity || config.camera_image || config.state_image) ||
      (config.state_image && !config.entity)
    ) {
      throw new Error("Image required");
    }
    if (!Array.isArray(config.elements)) throw new Error("Elements required");

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
    this._bridge?.addEventListener("changed", this._onBridgeChanged);
    this._observe();
    this._scheduleOverlay();
  }

  disconnectedCallback() {
    this._bridge?.removeEventListener("changed", this._onBridgeChanged);
    this._resizeObserver.disconnect();
    this._mutationObserver.disconnect();
  }

  _createCard() {
    if (this._card || !this._config) return;
    this._card = document.createElement("hui-picture-elements-card");
    this._card.preview = this._preview;
    this._applyConfig();
    if (this._hass) this._card.hass = this._hass;
    this._wrapper.prepend(this._card);
  }

  // What HA's card gets: our own options removed, and elements with
  // visibility conditions wrapped in a conditional element. Spreading keeps
  // the bridge symbol, which is what makes dragging work.
  _innerConfig() {
    const config = { ...this._config, type: "picture-elements" };
    for (const key of OWN_OPTIONS) delete config[key];
    config.elements = this._config.elements.map((element) => {
      if (!element.visibility) return element;
      const { visibility, ...rest } = element;
      // While editing everything stays on the plan, or you couldn't move it.
      if (this._preview) return rest;
      return { type: "conditional", conditions: visibility, elements: [rest] };
    });
    return config;
  }

  _applyConfig() {
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
    this._observe();
    this._scheduleStyling();
    this._scheduleOverlay();
  }

  _setBridge(bridge) {
    if (bridge === this._bridge) return;
    if (this.isConnected) {
      this._bridge?.removeEventListener("changed", this._onBridgeChanged);
      bridge?.addEventListener("changed", this._onBridgeChanged);
    }
    this._bridge = bridge;
  }

  // The positioned box inside HA's card that left/top percentages refer to.
  get _root() {
    return this._card?.shadowRoot?.getElementById("root");
  }

  // Top-level elements in the same order as config.elements. HA renders the
  // background image first, then one node per element.
  get _renderedElements() {
    const root = this._root;
    if (!root) return [];
    return [...root.children].filter((node) => node.tagName !== "HUI-IMAGE");
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

  /* ---- plan size and colours ---- */

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
    // 1% of the plan's width, used by text elements.
    this._card.style.setProperty("--pep-unit", `${width / 100}px`);

    const iconColor = cssColor(this._config.icon_color);
    const activeColor = cssColor(this._config.active_color);
    if (iconColor) this._card.style.setProperty("--state-icon-color", iconColor);
    else this._card.style.removeProperty("--state-icon-color");

    const hiddenIndexes = this._preview ? this._hiddenIndexes() : new Set();
    const topLevel = this._renderedElements;

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
      const index = topLevel.indexOf(node);
      node.style.opacity = index !== -1 && hiddenIndexes.has(index) ? "0.5" : "";
    }

    this._sizeText = width
      ? `Plan ${Math.round(width)} \u00d7 ${Math.round(root.offsetHeight)} px` +
        (planSize !== 100 ? ` (${planSize}%)` : "")
      : "";
    this._scheduleOverlay();
  }

  // Elements with visibility conditions, faded in the editor so you can tell.
  _hiddenIndexes() {
    const indexes = new Set();
    this._config.elements.forEach((element, index) => {
      if (element.visibility?.length) indexes.add(index);
    });
    return indexes;
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

  // While editing: the plan's size in the corner, and when an element
  // is selected or dragged, a cross through it with its position. During a
  // drag the cross and position show where it will land after snapping.
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

    const dragging = root.classList.contains("dragging");
    const index = dragging ? this._dragIndex : bridge.selectedIndex;
    const node = index !== undefined ? this._renderedElements[index] : undefined;
    let left = node && parsePercent(node.style.left);
    let top = node && parsePercent(node.style.top);

    for (const line of this._quarters) line.classList.toggle("shown", dragging);

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
      ({ left, top, leftKind, topKind } = snapPosition(
        left, top, this._config.elements, index, loadSnapSetting()
      ));
    }

    this._crossV.style.left = `${left}%`;
    this._crossH.style.top = `${top}%`;
    this._crossV.className = `line vertical cross shown ${leftKind || ""}`;
    this._crossH.className = `line horizontal cross shown ${topKind || ""}`;
    this._positionChip.style.display = "";
    this._positionChip.textContent = `left ${left}%  \u00b7  top ${top}%`;
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
  .panel[hidden] { display: none; }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 4px;
    font-weight: 500;
  }
  .panel-header ha-icon { color: var(--primary-color); }
  .panel-body { padding: 8px 16px 12px; }
  .hint { font-size: 12px; color: var(--secondary-text-color); margin: 4px 0 0; }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
  }

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
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: none;
    font: inherit;
    color: var(--primary-text-color);
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
  .chip ha-icon { --mdc-icon-size: 16px; }
  .chip .count { color: var(--secondary-text-color); }
  .chip[aria-pressed="true"] {
    border-color: var(--primary-color);
    background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.15);
  }

  .label {
    font-size: 12px;
    color: var(--secondary-text-color);
    min-width: 52px;
  }

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

// Hides the built-in "Add new element" dropdown, since the picker replaces
// it. If HA changes its markup the old button simply shows up again.
const HIDE_ADD_BUTTON = `ha-dropdown, ha-button-menu, ha-md-button-menu { display: none !important; }`;

const STYLE_SCHEMA = [
  {
    name: "plan_size",
    selector: { number: { min: 25, max: 300, step: 5, mode: "slider", unit_of_measurement: "%" } },
  },
  { name: "icon_color", selector: { ui_color: {} } },
  { name: "active_color", selector: { ui_color: {} } },
];

const STYLE_LABELS = {
  plan_size: "Plan size (% of card width)",
  icon_color: "Icon colour",
  active_color: "Icon colour when on",
};

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

    // HA's editor rejects element keys it doesn't know, so `visibility` is
    // taken off each element on the way in and put back on the way out.
    // These remember which stripped copy belongs to which element.
    this._strippedCopy = new WeakMap();
    this._visibilityOf = new WeakMap();
    this._wrappedBridges = new WeakSet();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onInnerConfigChanged = this._onInnerConfigChanged.bind(this);
    this._onBridgeChanged = () => this._updatePanels();
  }

  set hass(hass) {
    const entitiesChanged =
      !this._hass ||
      hass.entities !== this._hass.entities ||
      Object.keys(hass.states).length !== Object.keys(this._hass.states).length;
    this._hass = hass;
    if (this._inner) this._inner.hass = hass;
    if (this._styleForm) this._styleForm.hass = hass;
    if (this._conditionsEditor) this._conditionsEditor.hass = hass;
    // States change all the time; only redraw the list when the set of
    // entities does, or typing gets laggy on big installs.
    if (entitiesChanged) this._renderPicker();
  }

  setConfig(config) {
    this._config = config;
    this._captureBridge(config);
    this._inner?.setConfig(this._toInner(config));
    this._renderStyleForm();
    this._renderPicker();
    this._updatePanels();
  }

  connectedCallback() {
    if (!this.shadowRoot) this._build();
    window.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown);
  }

  /* ---- building ---- */

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${EDITOR_STYLES}</style>
      <div class="inner"></div>

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

      <div class="panel style">
        <div class="panel-header">
          <ha-icon icon="mdi:palette-outline"></ha-icon>
          Plan style
        </div>
        <div class="panel-body">
          <div class="style-form"></div>
          <p class="hint">Make the plan bigger to make the icons look smaller
            on it, or smaller to make them look bigger. Over 100% the card
            scrolls sideways. The preview shows the plan's size in pixels.</p>
          <div class="chips" style="margin-top:8px">
            <button class="chip reset-style">Back to HA's normal size and colours</button>
          </div>
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

      <p class="tips">
        Drag elements in the preview to move them. With one selected, the
        arrow keys nudge it (<kbd>Shift</kbd> for bigger steps, <kbd>Alt</kbd>
        for 0.1%).
      </p>
    `;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    this._picker = $(".picker");
    this._stylePanel = $(".style");
    this._visibilityPanel = $(".visibility");
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

    $(".reset-style").addEventListener("click", () => {
      const config = { ...this._config };
      for (const key of OWN_OPTIONS) delete config[key];
      this._emitConfig(config);
      this._renderStyleForm();
    });

    this._resultsEl.addEventListener("click", (ev) => {
      const button = ev.target.closest(".result");
      if (button) this._addEntity(button.dataset.entity);
    });

    this._renderAddAs();
    this._renderOthers();
    this._renderSnap();
    this._renderStyleForm();
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
      this._hideBuiltInAddButton();
      this._openCardOptionsIfNeeded();
      this._updatePanels();
    };
    await inner.updateComplete;
    new MutationObserver(watch).observe(inner.shadowRoot, { childList: true, subtree: true });
    watch();
  }

  _hideBuiltInAddButton() {
    const rowEditor = this._inner?.shadowRoot?.querySelector("hui-picture-elements-card-row-editor");
    const shadow = rowEditor?.shadowRoot;
    if (!shadow || shadow.__pepHidden) return;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(HIDE_ADD_BUTTON);
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      shadow.__pepHidden = true;
    } catch (err) {
      // Older browser without constructable stylesheets. Leave it be.
    }
  }

  // Until a floor plan is chosen, open "Card options" so the image picker is
  // the first thing you see. Only once per editor, so it doesn't fight you.
  _openCardOptionsIfNeeded() {
    if (this._openedOptions || !this._config || !isPlaceholder(this._config.image)) return;
    if (this._config.camera_image || this._config.image_entity || this._config.state_image) return;
    const form = this._inner?.shadowRoot?.querySelector("ha-form");
    const expandable = form?.shadowRoot?.querySelector("ha-form-expandable");
    const panel = expandable?.shadowRoot?.querySelector("ha-expansion-panel");
    if (!panel) return;
    panel.expanded = true;
    this._openedOptions = true;
  }

  // Which of our panels show depends on what HA's editor is showing.
  _updatePanels() {
    if (!this._picker) return;
    const editingOne = !!this._inner?.shadowRoot?.querySelector("hui-sub-element-editor");
    this._picker.hidden = editingOne;
    this._stylePanel.hidden = editingOne;
    this._tips.hidden = !this._bridge;

    const index = editingOne ? this._bridge?.selectedIndex : undefined;
    const element = index !== undefined ? this._config?.elements?.[index] : undefined;
    const canHaveVisibility = element && element.type !== "conditional";
    this._visibilityPanel.hidden = !canHaveVisibility;
    if (canHaveVisibility) this._renderConditions(index, element);
  }

  /* ---- config plumbing ---- */

  // What HA's editor gets: no card options of ours, no element visibility.
  _toInner(config) {
    const inner = { ...config };
    for (const key of OWN_OPTIONS) delete inner[key];
    inner.elements = (config.elements || []).map((element) => {
      if (!element.visibility) return element;
      let copy = this._strippedCopy.get(element);
      if (!copy) {
        const { visibility, ...rest } = element;
        copy = rest;
        this._strippedCopy.set(element, copy);
        this._visibilityOf.set(copy, visibility);
      }
      return copy;
    });
    this._lastInnerElements = inner.elements;
    return inner;
  }

  // And back again: put our options and the visibility conditions back on.
  _fromInner(inner) {
    const config = { ...inner };
    for (const key of OWN_OPTIONS) {
      if (this._config?.[key] !== undefined) config[key] = this._config[key];
    }
    const previous = this._lastInnerElements || [];
    const selected = this._bridge?.selectedIndex;
    config.elements = (inner.elements || []).map((element, index) => {
      // Moved or reordered elements are the same object as before. An
      // element edited in HA's form is a new object, but it's the selected one.
      let visibility = this._visibilityOf.get(element);
      if (!visibility && index === selected && previous[index]) {
        visibility = this._visibilityOf.get(previous[index]);
      }
      return visibility ? { ...element, visibility } : element;
    });
    return config;
  }

  // Everything HA's editor changes passes through here on its way out.
  _onInnerConfigChanged(ev) {
    ev.stopPropagation();
    const config = this._fromInner(ev.detail.config);
    this._captureBridge(config);
    this._config = config;
    this._lastInnerElements = ev.detail.config.elements;
    fireEvent(this, "config-changed", { config });
    this._renderResults();
  }

  _emitConfig(config) {
    this._config = config;
    this._inner?.setConfig(this._toInner(config));
    fireEvent(this, "config-changed", { config });
  }

  // Grab HA's bridge so we can snap moves and nudge with the keyboard.
  _captureBridge(config) {
    const bridge = findBridge(config);
    if (!bridge || bridge === this._bridge) return;

    this._bridge?.removeEventListener("changed", this._onBridgeChanged);
    this._bridge = bridge;
    bridge.addEventListener("changed", this._onBridgeChanged);
    this._updatePanels();

    // HA has no hook for adjusting a move, so wrap the handlers it calls
    // when an element is dropped, or placed by clicking the image.
    if (this._wrappedBridges.has(bridge)) return;
    this._wrappedBridges.add(bridge);
    const { handlers } = bridge;
    const originalMove = handlers.moveElement;
    const originalClick = handlers.clickImage;

    handlers.moveElement = (index, left, top) => {
      const snapped = snapPosition(left, top, this._config?.elements, index, this._snap);
      originalMove(index, snapped.left, snapped.top);
    };
    handlers.clickImage = (left, top) => {
      const snapped = snapPosition(left, top, this._config?.elements, bridge.selectedIndex, this._snap);
      originalClick(snapped.left, snapped.top);
    };
    // Kept for nudging, which shouldn't be pulled back onto the grid.
    this._moveWithoutSnap = originalMove;
  }

  _onKeyDown(ev) {
    const bridge = this._bridge;
    const index = bridge?.selectedIndex;
    if (!bridge?.active || index === undefined || !this._moveWithoutSnap) return;

    const moves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[ev.key];
    if (!move || ev.ctrlKey || ev.metaKey) return;
    // Leave arrow keys alone when they're being used to type or pick.
    if (isTypingTarget(ev.composedPath()[0])) return;

    const style = this._config?.elements?.[index]?.style || {};
    const left = parsePercent(style.left);
    const top = parsePercent(style.top);
    if (left === undefined || top === undefined) return;

    ev.preventDefault();
    let step = this._snap || 1;
    if (ev.shiftKey) step *= 5;
    if (ev.altKey) step = 0.1;
    this._moveWithoutSnap(
      index,
      clamp(roundTo(left + move[0] * step, 0.1)),
      clamp(roundTo(top + move[1] * step, 0.1))
    );
  }

  /* ---- plan style and visibility panels ---- */

  _renderStyleForm() {
    const container = this.shadowRoot?.querySelector(".style-form");
    if (!container || !this._config) return;
    if (!this._styleForm) {
      this._styleForm = document.createElement("ha-form");
      this._styleForm.schema = STYLE_SCHEMA;
      this._styleForm.computeLabel = (field) => STYLE_LABELS[field.name];
      this._styleForm.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const config = { ...this._config };
        for (const key of OWN_OPTIONS) {
          const value = ev.detail.value[key];
          if (value === undefined || value === "") delete config[key];
          else config[key] = value;
        }
        this._emitConfig(config);
      });
      container.append(this._styleForm);
    }
    this._styleForm.hass = this._hass;
    const data = {};
    for (const key of OWN_OPTIONS) {
      if (this._config[key] !== undefined) data[key] = this._config[key];
    }
    this._styleForm.data = data;
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
    const elements = [...this._config.elements];
    const { visibility, ...rest } = elements[index];
    elements[index] = conditions?.length ? { ...rest, visibility: conditions } : rest;
    this._emitConfig({ ...this._config, elements });
  }

  /* ---- picker ---- */

  _renderPicker() {
    if (!this.shadowRoot || !this._hass) return;
    this._entityList = this._buildEntityList();
    this._renderAreas();
    this._renderDomains();
    this._renderResults();
  }

  _areaFor(entityId) {
    const hass = this._hass;
    const entry = hass.entities?.[entityId];
    if (!entry) return undefined;
    const areaId = entry.area_id || hass.devices?.[entry.device_id]?.area_id;
    return areaId ? hass.areas?.[areaId] : undefined;
  }

  _buildEntityList() {
    const hass = this._hass;
    const list = [];
    for (const [entityId, stateObj] of Object.entries(hass.states)) {
      const entry = hass.entities?.[entityId];
      if (!this._showAll && entry && (entry.hidden || entry.entity_category)) continue;
      const area = this._areaFor(entityId);
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
  }

  _renderSnap() {
    const steps = [0, 0.5, 1, 2, 5].map((step) => ({ step, label: step ? `${step}%` : "Off" }));
    this._renderChoiceChips(".snap", steps, (item) => item.step === this._snap, (item) => {
      this._snap = item.step;
      saveSnapSetting(item.step);
      this._renderSnap();
    });
  }

  _entitiesOnPlan() {
    const ids = new Set();
    const walk = (elements) => {
      for (const element of elements || []) {
        if (element.entity) ids.add(element.entity);
        if (element.elements) walk(element.elements);
      }
    };
    walk(this._config?.elements);
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

    if (!matches.length) {
      this._resultsEl.innerHTML = `<div class="empty">Nothing matches. Try another search or room.</div>`;
      return;
    }

    const shown = matches.slice(0, MAX_RESULTS);
    let html = shown
      .map(
        (item) => `
        <button class="result" data-entity="${escapeHtml(item.entityId)}" title="Add ${escapeHtml(item.name)}">
          <span class="icon"><ha-state-icon></ha-state-icon></span>
          <span class="text">
            <div class="name">${escapeHtml(item.name)}
              ${onPlan.has(item.entityId) ? `<span class="on-plan">on plan</span>` : ""}
            </div>
            <div class="id">${escapeHtml(item.entityId)}</div>
          </span>
          <span class="area">${escapeHtml(item.areaName)}</span>
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

  /* ---- adding ---- */

  // Somewhere to drop a new element: the middle, unless something is
  // already there, in which case step down and to the right.
  _freeSpot() {
    const taken = new Set(
      (this._config?.elements || []).map(
        (el) => `${parsePercent(el.style?.left)},${parsePercent(el.style?.top)}`
      )
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

  _addEntity(entityId) {
    if (!entityId || !this._config) return;
    this._addElement(this._elementForEntity(entityId));
  }

  _addOther(type) {
    const style = this._freeSpot();
    const background = this._config?.image;
    const backgroundUrl = typeof background === "object" ? background.media_content_id : background;
    const elements = {
      text: { ...PictureElementsPlusText.getStubConfig(), style },
      icon: { type, icon: "mdi:information-outline", tap_action: { action: "none" }, style },
      // A small copy of the background, just so there's something to see.
      image: { type, image: backgroundUrl || PLACEHOLDER_IMAGE, style: { ...style, width: "10%" } },
      "action-button": { type, title: "Button", action: "homeassistant.update_entity", style },
      // Conditional elements only wrap others and aren't positioned themselves.
      conditional: { type, conditions: [], elements: [] },
    };
    this._addElement(elements[type]);
  }

  _addElement(element) {
    const elements = [...(this._config.elements || []), element];
    // Spread the old config so the bridge symbol comes along.
    this._emitConfig({ ...this._config, elements });
    // Open the new element straight away so it can be dragged into place.
    this._bridge?.handlers.selectElement(elements.length - 1);
    const input = this.shadowRoot.querySelector(".search input");
    input.value = "";
    this._search = "";
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

customElements.define(TEXT_TYPE, PictureElementsPlusText);
customElements.define(`${TEXT_TYPE}-editor`, PictureElementsPlusTextEditor);
customElements.define(CARD_TYPE, PictureElementsPlusCard);
customElements.define(`${CARD_TYPE}-editor`, PictureElementsPlusEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "Picture Elements Plus",
  description: "Picture elements with an entity picker, icon sizing and colours, and snapping when you drag things around.",
  preview: false,
  documentationURL: "https://github.com/MithUK1/picture-elements-plus",
});

console.info(
  `%c PICTURE-ELEMENTS-PLUS %c ${VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);
