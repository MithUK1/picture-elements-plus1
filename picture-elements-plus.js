/*
 * Picture Elements Plus
 *
 * A thin wrapper around Home Assistant's own picture-elements card. The card
 * itself renders exactly like the built-in one (it *is* the built-in one,
 * inside), so any existing picture-elements YAML works after changing the
 * type to `custom:picture-elements-plus`.
 *
 * What it adds, all in the card editor:
 *   - a searchable entity picker with icons, room filter and sensible
 *     defaults per domain, instead of the plain "Add new element" dropdown
 *   - snapping when you drag elements in the preview (to a grid, and to line
 *     up with other elements), with guide lines and a position readout
 *   - arrow keys to nudge the selected element
 *
 * Dragging itself is done by Home Assistant (2026.11 and later). HA hands the
 * preview card a small "bridge" object hidden on the config under a Symbol;
 * we pass it straight through and hook into it for the snapping.
 */

const VERSION = "0.1.0";

const CARD_TYPE = "picture-elements-plus";
const BRIDGE_DESCRIPTION = "pictureElementsEditorBridge";
const SNAP_STORAGE_KEY = "picture-elements-plus:snap";

// How close (in percent) an element has to get to another element's line
// before it snaps onto it.
const ALIGN_DISTANCE = 0.8;

// Number of search results to show before asking the user to type more.
const MAX_RESULTS = 60;

// Domains where tapping the icon should toggle the thing, which is what
// you'd expect on a floor plan. Everything else opens more-info.
const TOGGLE_DOMAINS = new Set([
  "light",
  "switch",
  "fan",
  "input_boolean",
  "siren",
  "humidifier",
]);

const BADGE_DOMAINS = new Set(["person", "device_tracker", "zone"]);

const ELEMENT_TYPES = [
  { type: "auto", label: "Auto", icon: "mdi:auto-fix" },
  { type: "state-icon", label: "State icon", icon: "mdi:lightbulb-outline" },
  { type: "state-badge", label: "State badge", icon: "mdi:circle-outline" },
  { type: "state-label", label: "State label", icon: "mdi:format-text" },
];

const OTHER_ELEMENTS = [
  { type: "icon", label: "Icon", icon: "mdi:emoticon-outline" },
  { type: "image", label: "Image", icon: "mdi:image-outline" },
  { type: "action-button", label: "Action button", icon: "mdi:gesture-tap-button" },
  { type: "conditional", label: "Conditional", icon: "mdi:call-split" },
];

const DOMAIN_ICONS = {
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

/* ------------------------------------------------------------------ */
/* Helpers shared by the card and the editor                           */
/* ------------------------------------------------------------------ */

// HA only loads its picture-elements card when something asks for it. Asking
// the card helpers to build a throwaway one makes sure the class exists.
let cardClassPromise;
function loadPictureElementsCard() {
  if (!cardClassPromise) {
    cardClassPromise = (async () => {
      if (!customElements.get("hui-picture-elements-card")) {
        const helpers = await window.loadCardHelpers();
        helpers.createCardElement({
          type: "picture-elements",
          image: "about:blank",
          elements: [],
        });
        await customElements.whenDefined("hui-picture-elements-card");
      }
      return customElements.get("hui-picture-elements-card");
    })();
  }
  return cardClassPromise;
}

// The editor bridge is stored under a Symbol we can't import, so find it by
// its description.
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

// "42%" -> 42, anything else (px, calc, missing) -> undefined.
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

function loadSnapSetting() {
  try {
    const stored = localStorage.getItem(SNAP_STORAGE_KEY);
    if (stored !== null) return parseFloat(stored) || 0;
  } catch (err) {
    // Private mode or storage blocked, just use the default.
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

// Positions of every element we could line up with, except the one moving.
function otherPositions(elements, skipIndex) {
  const lefts = [];
  const tops = [];
  (elements || []).forEach((element, index) => {
    if (index === skipIndex || !element.style) return;
    const left = parsePercent(element.style.left);
    const top = parsePercent(element.style.top);
    if (left !== undefined) lefts.push(left);
    if (top !== undefined) tops.push(top);
  });
  return { lefts, tops };
}

function nearest(value, candidates) {
  let best;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= ALIGN_DISTANCE && (!best || distance < best.distance)) {
      best = { value: candidate, distance };
    }
  }
  return best ? best.value : undefined;
}

// Lining up with another element wins over the grid, since that's usually
// what you're after on a floor plan (a column of icons along a wall).
function snapPosition(left, top, elements, index, step) {
  const others = otherPositions(elements, index);
  const alignedLeft = nearest(left, others.lefts);
  const alignedTop = nearest(top, others.tops);
  return {
    left: alignedLeft ?? (step ? roundTo(left, step) : left),
    top: alignedTop ?? (step ? roundTo(top, step) : top),
    alignedLeft: alignedLeft !== undefined,
    alignedTop: alignedTop !== undefined,
  };
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

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

class PictureElementsPlusCard extends HTMLElement {
  constructor() {
    super();
    this._preview = false;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        .wrapper { position: relative; height: 100%; }
        .overlay {
          position: absolute;
          pointer-events: none;
          display: none;
        }
        .overlay.visible { display: block; }
        .guide {
          position: absolute;
          border: 0 dashed var(--secondary-text-color);
          opacity: 0.6;
        }
        .guide.vertical { top: 0; bottom: 0; border-left-width: 1px; }
        .guide.horizontal { left: 0; right: 0; border-top-width: 1px; }
        .guide.aligned {
          border-color: var(--accent-color, #ff9800);
          border-style: solid;
          opacity: 1;
        }
        .readout {
          position: absolute;
          top: 6px;
          left: 6px;
          padding: 2px 8px;
          border-radius: 10px;
          font: 12px/18px var(--ha-font-family-body, Roboto, sans-serif);
          font-variant-numeric: tabular-nums;
          color: var(--text-primary-color, #fff);
          background: var(--primary-color);
        }
        .error {
          padding: 16px;
          color: var(--error-color, #db4437);
        }
      </style>
      <div class="wrapper">
        <div class="overlay">
          <div class="guide vertical"></div>
          <div class="guide horizontal"></div>
          <div class="readout"></div>
        </div>
      </div>
    `;
    this._wrapper = this.shadowRoot.querySelector(".wrapper");
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._vGuide = this.shadowRoot.querySelector(".guide.vertical");
    this._hGuide = this.shadowRoot.querySelector(".guide.horizontal");
    this._readout = this.shadowRoot.querySelector(".readout");

    this._onBridgeChanged = () => this._drawGuides();

    // Capture phase so we see the press before HA's own handler grabs it.
    this._wrapper.addEventListener(
      "pointerdown",
      (ev) => {
        this._dragIndex = this._indexFromEvent(ev);
      },
      true
    );
    this._wrapper.addEventListener("pointermove", () => this._scheduleDraw());
    this._wrapper.addEventListener("pointerup", () => {
      this._dragIndex = undefined;
      this._scheduleDraw();
    });
  }

  static getConfigElement() {
    return document.createElement("picture-elements-plus-editor");
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((id) =>
      ["light", "sensor", "binary_sensor"].includes(domainOf(id))
    );
    return {
      type: `custom:${CARD_TYPE}`,
      image: "https://demo.home-assistant.io/stub_config/floorplan.png",
      elements: entity
        ? [{ type: "state-icon", entity, style: { left: "40%", top: "32%" } }]
        : [],
    };
  }

  setConfig(config) {
    // Same checks the built-in card makes, so errors show up straight away
    // even before HA's card has finished loading.
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
      // Already loaded: build it right away so the preview doesn't flicker.
      this._createCard();
    } else {
      loadPictureElementsCard().then(() => this._createCard());
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (this._card) this._card.hass = hass;
  }

  get hass() {
    return this._hass;
  }

  set preview(value) {
    this._preview = value;
    if (this._card) this._card.preview = value;
    this._drawGuides();
  }

  get preview() {
    return this._preview;
  }

  getCardSize() {
    return this._card?.getCardSize ? this._card.getCardSize() : 4;
  }

  connectedCallback() {
    this._bridge?.addEventListener("changed", this._onBridgeChanged);
    this._drawGuides();
  }

  disconnectedCallback() {
    this._bridge?.removeEventListener("changed", this._onBridgeChanged);
  }

  _createCard() {
    if (this._card || !this._config) return;
    this._card = document.createElement("hui-picture-elements-card");
    this._card.preview = this._preview;
    this._applyConfig();
    if (this._hass) this._card.hass = this._hass;
    this._wrapper.prepend(this._card);
  }

  _applyConfig() {
    // Spreading keeps the bridge symbol, which is what makes dragging work.
    const config = { ...this._config, type: "picture-elements" };
    try {
      this._card.setConfig(config);
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
    this._drawGuides();
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
  // background image first and then one node per element.
  get _renderedElements() {
    const root = this._root;
    if (!root) return [];
    return [...root.children].filter((node) => node.tagName !== "HUI-IMAGE");
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

  _scheduleDraw() {
    if (this._drawQueued) return;
    this._drawQueued = true;
    requestAnimationFrame(() => {
      this._drawQueued = false;
      this._drawGuides();
    });
  }

  // While editing, draw a cross through the selected (or dragged) element
  // and show where it will end up once snapping is applied.
  _drawGuides() {
    const bridge = this._bridge;
    const root = this._root;
    const editing = this._preview && bridge?.active;
    const dragging = !!root?.classList.contains("dragging");
    const index = dragging ? this._dragIndex : bridge?.selectedIndex;
    const node = index !== undefined ? this._renderedElements[index] : undefined;

    if (!editing || !root || !node || !root.offsetWidth) {
      this._overlay.classList.remove("visible");
      return;
    }

    // During a drag HA moves the element by setting its style directly, so
    // reading the style gives the live position.
    let left = parsePercent(node.style.left);
    let top = parsePercent(node.style.top);
    if (left === undefined || top === undefined) {
      this._overlay.classList.remove("visible");
      return;
    }

    let alignedLeft = false;
    let alignedTop = false;
    if (dragging) {
      const snapped = snapPosition(
        left,
        top,
        this._config.elements,
        index,
        loadSnapSetting()
      );
      ({ left, top, alignedLeft, alignedTop } = snapped);
    }

    const wrapperRect = this._wrapper.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    Object.assign(this._overlay.style, {
      left: `${rootRect.left - wrapperRect.left}px`,
      top: `${rootRect.top - wrapperRect.top}px`,
      width: `${rootRect.width}px`,
      height: `${rootRect.height}px`,
    });
    this._vGuide.style.left = `${left}%`;
    this._hGuide.style.top = `${top}%`;
    this._vGuide.classList.toggle("aligned", alignedLeft);
    this._hGuide.classList.toggle("aligned", alignedTop);
    this._readout.textContent = `left ${left}%  \u00b7  top ${top}%`;
    this._overlay.classList.add("visible");
  }
}

/* ------------------------------------------------------------------ */
/* The editor                                                          */
/* ------------------------------------------------------------------ */

const EDITOR_STYLES = `
  :host { display: block; }

  .picker {
    margin-top: 16px;
    border: 1px solid var(--divider-color);
    border-radius: var(--ha-card-border-radius, 12px);
    overflow: hidden;
  }
  .picker[hidden] { display: none; }

  .picker-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 4px;
    font-weight: 500;
  }
  .picker-header ha-icon { color: var(--primary-color); }

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

  .footer {
    border-top: 1px solid var(--divider-color);
  }

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
    this._wrappedBridges = new WeakSet();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onInnerConfigChanged = this._onInnerConfigChanged.bind(this);
    this._onBridgeChanged = () => this._updatePickerVisibility();
  }

  set hass(hass) {
    const entitiesChanged =
      !this._hass ||
      hass.entities !== this._hass.entities ||
      Object.keys(hass.states).length !== Object.keys(this._hass.states).length;
    this._hass = hass;
    if (this._inner) this._inner.hass = hass;
    // States change all the time; only redraw the list when the set of
    // entities does, otherwise typing gets laggy on big installs.
    if (entitiesChanged) this._renderPicker();
  }

  setConfig(config) {
    this._config = config;
    this._captureBridge(config);
    if (this._inner) this._inner.setConfig(config);
    this._renderPicker();
  }

  connectedCallback() {
    if (!this.shadowRoot) this._build();
    window.addEventListener("keydown", this._onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown);
  }

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${EDITOR_STYLES}</style>
      <div class="inner"></div>
      <div class="picker">
        <div class="picker-header">
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
        <div class="row">
          <div class="chips domains"></div>
        </div>
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
        Drag elements in the preview to move them. With one selected, use the
        arrow keys to nudge it (<kbd>Shift</kbd> for bigger steps,
        <kbd>Alt</kbd> for 0.1%).
      </p>
    `;

    const root = this.shadowRoot;
    this._picker = root.querySelector(".picker");
    this._tips = root.querySelector(".tips");
    this._resultsEl = root.querySelector(".results");
    this._domainsEl = root.querySelector(".domains");
    this._areaEl = root.querySelector(".area");

    const searchInput = root.querySelector(".search input");
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

    const hideUsed = root.querySelector(".hide-used");
    hideUsed.checked = this._hideUsed;
    hideUsed.addEventListener("change", () => {
      this._hideUsed = hideUsed.checked;
      this._renderResults();
    });

    const showAll = root.querySelector(".show-all");
    showAll.checked = this._showAll;
    showAll.addEventListener("change", () => {
      this._showAll = showAll.checked;
      this._renderPicker();
    });

    this._renderAddAs();
    this._renderOthers();
    this._renderSnap();
    this._resultsEl.addEventListener("click", (ev) => {
      const button = ev.target.closest(".result");
      if (button) this._addEntity(button.dataset.entity);
    });

    this._loadInnerEditor();
  }

  async _loadInnerEditor() {
    const cardClass = await loadPictureElementsCard();
    const inner = await cardClass.getConfigElement();
    inner.addEventListener("config-changed", this._onInnerConfigChanged);
    if (this._hass) inner.hass = this._hass;
    if (this._config) inner.setConfig(this._config);
    this.shadowRoot.querySelector(".inner").append(inner);
    this._inner = inner;

    // The inner editor swaps between its element list and the editor for a
    // single element. Watch for that to hide the old add button and to only
    // show the picker on the list.
    const watch = () => {
      this._hideBuiltInAddButton();
      this._updatePickerVisibility();
    };
    await inner.updateComplete;
    new MutationObserver(watch).observe(inner.shadowRoot, {
      childList: true,
      subtree: true,
    });
    watch();
  }

  _hideBuiltInAddButton() {
    const rowEditor = this._inner?.shadowRoot?.querySelector(
      "hui-picture-elements-card-row-editor"
    );
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

  _updatePickerVisibility() {
    if (!this._picker) return;
    const editingOne = !!this._inner?.shadowRoot?.querySelector(
      "hui-sub-element-editor"
    );
    this._picker.hidden = editingOne;
    this._tips.hidden = !this._bridge;
  }

  // Everything the inner editor changes goes through here on its way out.
  _onInnerConfigChanged(ev) {
    ev.stopPropagation();
    const config = ev.detail.config;
    this._captureBridge(config);
    this._config = config;
    fireEvent(this, "config-changed", { config });
    this._renderResults();
  }

  _emitConfig(config) {
    this._config = config;
    if (this._inner) this._inner.setConfig(config);
    fireEvent(this, "config-changed", { config });
  }

  // Grab HA's bridge so we can snap moves and nudge with the keyboard.
  _captureBridge(config) {
    const bridge = findBridge(config);
    if (!bridge || bridge === this._bridge) return;

    this._bridge?.removeEventListener("changed", this._onBridgeChanged);
    this._bridge = bridge;
    bridge.addEventListener("changed", this._onBridgeChanged);
    this._updatePickerVisibility();

    // HA has no hook for adjusting a move, so wrap the handlers it calls
    // when an element is dropped (or placed by clicking the image).
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
      const index = bridge.selectedIndex;
      const snapped = snapPosition(left, top, this._config?.elements, index, this._snap);
      originalClick(snapped.left, snapped.top);
    };
    // Kept for nudging, which shouldn't be pulled back onto the grid.
    this._moveWithoutSnap = originalMove;
  }

  _onKeyDown(ev) {
    const bridge = this._bridge;
    const index = bridge?.selectedIndex;
    if (!bridge?.active || index === undefined || !this.isConnected) return;

    const moves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[ev.key];
    if (!move || ev.ctrlKey || ev.metaKey) return;

    // Leave arrow keys alone when they're being used to type or pick.
    const target = ev.composedPath()[0];
    if (isTypingTarget(target)) return;

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

  /* -------------------------- picker ------------------------------ */

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
      if (!this._showAll && entry && (entry.hidden || entry.entity_category)) {
        continue;
      }
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
    const floors = Object.values(hass.floors || {}).sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0)
    );

    let options = `<option value="">Any room</option>`;
    const used = new Set();
    for (const floor of floors) {
      const onFloor = areas
        .filter((area) => area.floor_id === floor.floor_id)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!onFloor.length) continue;
      options += `<optgroup label="${escapeHtml(floor.name)}">`;
      for (const area of onFloor) {
        used.add(area.area_id);
        options += `<option value="${escapeHtml(area.area_id)}">${escapeHtml(area.name)}</option>`;
      }
      options += `</optgroup>`;
    }
    const rest = areas
      .filter((area) => !used.has(area.area_id))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const area of rest) {
      options += `<option value="${escapeHtml(area.area_id)}">${escapeHtml(area.name)}</option>`;
    }
    options += `<option value="__none__">No room</option>`;

    this._areaEl.innerHTML = options;
    this._areaEl.value = this._area;
  }

  _renderDomains() {
    const counts = {};
    for (const item of this._entityList) {
      counts[item.domain] = (counts[item.domain] || 0) + 1;
    }
    // Most common domains first; the long tail is still reachable by search.
    const domains = Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, 10);
    if (this._domain && !domains.includes(this._domain)) {
      domains.push(this._domain);
    }

    const chip = (value, label, icon, count) => `
      <button class="chip" data-domain="${value}" aria-pressed="${this._domain === value}">
        ${icon ? `<ha-icon icon="${icon}"></ha-icon>` : ""}
        ${escapeHtml(label)}
        ${count !== undefined ? `<span class="count">${count}</span>` : ""}
      </button>`;

    this._domainsEl.innerHTML =
      chip("", "All") +
      domains
        .map((domain) =>
          chip(domain, prettyDomain(domain), DOMAIN_ICONS[domain], counts[domain] || 0)
        )
        .join("");

    for (const button of this._domainsEl.querySelectorAll(".chip")) {
      button.addEventListener("click", () => {
        this._domain = button.dataset.domain;
        this._renderDomains();
        this._renderResults();
      });
    }
  }

  _renderAddAs() {
    const container = this.shadowRoot.querySelector(".add-as");
    container.innerHTML = ELEMENT_TYPES.map(
      (item) => `
        <button class="chip" data-type="${item.type}" aria-pressed="${this._addAs === item.type}">
          <ha-icon icon="${item.icon}"></ha-icon>${item.label}
        </button>`
    ).join("");
    for (const button of container.querySelectorAll(".chip")) {
      button.addEventListener("click", () => {
        this._addAs = button.dataset.type;
        this._renderAddAs();
      });
    }
  }

  _renderOthers() {
    const container = this.shadowRoot.querySelector(".others");
    container.innerHTML = OTHER_ELEMENTS.map(
      (item) => `
        <button class="chip" data-type="${item.type}">
          <ha-icon icon="${item.icon}"></ha-icon>${item.label}
        </button>`
    ).join("");
    for (const button of container.querySelectorAll(".chip")) {
      button.addEventListener("click", () => this._addOther(button.dataset.type));
    }
  }

  _renderSnap() {
    const container = this.shadowRoot.querySelector(".snap");
    const steps = [0, 0.5, 1, 2, 5];
    container.innerHTML = steps
      .map(
        (step) => `
        <button class="chip" data-step="${step}" aria-pressed="${this._snap === step}">
          ${step ? `${step}%` : "Off"}
        </button>`
      )
      .join("");
    for (const button of container.querySelectorAll(".chip")) {
      button.addEventListener("click", () => {
        this._snap = parseFloat(button.dataset.step);
        saveSnapSetting(this._snap);
        this._renderSnap();
      });
    }
  }

  _filteredEntities() {
    const words = this._search.toLowerCase().split(/\s+/).filter(Boolean);
    const onPlan = this._entitiesOnPlan();

    const matches = this._entityList.filter((item) => {
      if (this._domain && item.domain !== this._domain) return false;
      if (this._area === "__none__" && item.areaId) return false;
      if (this._area && this._area !== "__none__" && item.areaId !== this._area) {
        return false;
      }
      if (this._hideUsed && onPlan.has(item.entityId)) return false;
      return words.every((word) => item.haystack.includes(word));
    });

    // Names that start with what you typed float to the top.
    if (words.length) {
      const first = words[0];
      const score = (item) =>
        item.name.toLowerCase().startsWith(first) ? 0 :
        item.entityId.split(".")[1].startsWith(first) ? 1 : 2;
      matches.sort((a, b) => score(a) - score(b));
    }
    return { matches, onPlan };
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

    // ha-state-icon works out the right icon (including your custom icons
    // and state-based ones) from the state object. It's normally loaded by
    // the time the editor opens; if not, fall back to a plain icon.
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

  /* ------------------------- adding ------------------------------- */

  // Somewhere to drop a new element: the middle, unless something is
  // already sitting there, in which case step down and to the right.
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
      element.tap_action = {
        action: TOGGLE_DOMAINS.has(domain) ? "toggle" : "more-info",
      };
      element.hold_action = { action: "more-info" };
    }
    return element;
  }

  _addEntity(entityId) {
    if (!entityId || !this._config) return;
    this._addElement(this._elementForEntity(entityId));
  }

  async _addOther(type) {
    let element = { type, style: this._freeSpot() };
    if (type === "icon") {
      element = { ...element, icon: "mdi:information-outline", tap_action: { action: "none" } };
    } else if (type === "image") {
      // Starts off as a small copy of the background, just so there's
      // something to see. Swap the image in the element editor.
      const background = this._config?.image;
      const image = typeof background === "object" ? background.media_content_id : background;
      element = { ...element, image: image || "", style: { ...element.style, width: "10%" } };
    } else if (type === "action-button") {
      element = { ...element, title: "Button", action: "homeassistant.update_entity" };
    } else if (type === "conditional") {
      // Conditional elements only wrap others and aren't positioned themselves.
      element = { type, conditions: [], elements: [] };
    }
    this._addElement(element);
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

function isTypingTarget(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName)) return true;
  // Lists and menus use the arrow keys themselves.
  const role = node.getAttribute("role");
  return ["listbox", "option", "menu", "menuitem", "combobox", "slider", "textbox"].includes(role);
}

function prettyDomain(domain) {
  const words = domain.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

customElements.define(CARD_TYPE, PictureElementsPlusCard);
customElements.define("picture-elements-plus-editor", PictureElementsPlusEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "Picture Elements Plus",
  description: "Picture elements with an entity picker and snapping when you drag things around.",
  preview: false,
});

console.info(`%c PICTURE-ELEMENTS-PLUS %c ${VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;");
