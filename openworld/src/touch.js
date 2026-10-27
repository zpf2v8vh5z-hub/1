/* Touch / gamepad-style on-screen controls.
   Writes into a small state object instead of synthesising key events, so the
   rest of the game reads one input surface for keyboard and touch alike.

   Layout:
     left  - virtual joystick: on foot = movement, in a car = steer (x) and
             throttle/brake (y)
     right - action buttons: fire, enter/exit, handbrake|jump, reload
     drag  - anywhere on the right half of the canvas looks around
*/

const DEADZONE = 0.12;

export function prefersTouch() {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced === "1") return true;
  if (forced === "0") return false;
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

export class TouchControls {
  constructor({ root, stick, knob, buttons, onAction }) {
    this.root = root;
    this.stick = stick;
    this.knob = knob;
    this.onAction = onAction;
    this.enabled = false;

    this.axis = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.buttons = new Map();

    this._stickId = null;
    this._lookId = null;
    this._lookPos = { x: 0, y: 0 };

    this._bindStick();
    this._bindButtons(buttons);
    this._bindLook();
  }

  get active() {
    return this.enabled;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.root) this.root.classList.toggle("hidden", !on);
    document.body.classList.toggle("touch-mode", on);
    if (!on) {
      this.axis.x = this.axis.y = 0;
      this._setKnob(0, 0);
      this.resetButtons();
    }
  }

  /** Held state of a virtual button. */
  held(name) {
    return !!this.buttons.get(name);
  }

  resetButtons() {
    for (const key of this.buttons.keys()) this.buttons.set(key, false);
    if (!this.root || !this.root.querySelectorAll) return;
    for (const el of this.root.querySelectorAll("[data-btn]")) el.classList.remove("active");
  }

  /** Consume accumulated look delta for this frame. */
  takeLook() {
    const out = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0;
    this.look.dy = 0;
    return out;
  }

  _setKnob(dx, dy) {
    if (this.knob) this.knob.style.transform = `translate(${dx * 42}px, ${dy * 42}px)`;
  }

  _bindStick() {
    if (!this.stick) return;
    const move = (e) => {
      const r = this.stick.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this._setKnob(dx, dy);
      // deadzone keeps the character from creeping while the thumb rests
      this.axis.x = Math.abs(dx) < DEADZONE ? 0 : dx;
      this.axis.y = Math.abs(dy) < DEADZONE ? 0 : dy;
    };
    const end = (e) => {
      if (e && e.pointerId !== this._stickId) return;
      this._stickId = null;
      this.axis.x = this.axis.y = 0;
      this._setKnob(0, 0);
    };

    this.stick.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this._stickId = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      move(e);
    });
    this.stick.addEventListener("pointermove", (e) => {
      if (!this.enabled || e.pointerId !== this._stickId) return;
      e.preventDefault();
      move(e);
    });
    this.stick.addEventListener("pointerup", end);
    this.stick.addEventListener("pointercancel", end);
    this.stick.addEventListener("lostpointercapture", end);
  }

  _bindButtons(buttons) {
    for (const el of buttons) {
      const name = el.dataset.btn;
      const down = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        el.classList.add("active");
        this.buttons.set(name, true);
        if (this.onAction) this.onAction(name, "press");
      };
      const up = (e) => {
        if (e) e.preventDefault();
        el.classList.remove("active");
        this.buttons.set(name, false);
        if (this.onAction) this.onAction(name, "release");
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
    }
  }

  _bindLook() {
    const surface = document.getElementById("touch-look");
    if (!surface) return;

    surface.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      const target = e.target;
      if (target && target.closest && (target.closest("[data-btn]") || target.closest("#stick"))) return;
      e.preventDefault();
      this._lookId = e.pointerId;
      this._lookPos.x = e.clientX;
      this._lookPos.y = e.clientY;
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener("pointermove", (e) => {
      if (!this.enabled || e.pointerId !== this._lookId) return;
      e.preventDefault();
      this.look.dx += e.clientX - this._lookPos.x;
      this.look.dy += e.clientY - this._lookPos.y;
      this._lookPos.x = e.clientX;
      this._lookPos.y = e.clientY;
    });
    const end = (e) => {
      if (e && e.pointerId !== this._lookId) return;
      this._lookId = null;
    };
    surface.addEventListener("pointerup", end);
    surface.addEventListener("pointercancel", end);
    surface.addEventListener("lostpointercapture", end);
  }
}
