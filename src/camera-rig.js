import { clamp, damp, easeInOutCubic } from './utils.js';

/**
 * A tiny orbit rig: drag to orbit, wheel / pinch to zoom, with a slow
 * idle drift so the scene never feels frozen.
 */
export class CameraRig {
  constructor(camera, canvas, { onTap } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.onTap = onTap;

    this.theta = 0.22;
    this.phi = 1.26;
    this.radius = 9.8;

    this.targetTheta = this.theta;
    this.targetPhi = this.phi;
    this.targetRadius = this.radius;

    this.minRadius = 5.4;
    this.maxRadius = 14;
    this.minPhi = 0.52;
    this.maxPhi = 1.92;

    this.focus = { x: 0, y: 0.06, z: 0 };
    this.targetFocus = { x: 0, y: 0.06, z: 0 };
    this.idle = 0;
    this.enabled = false;
    this.dragging = false;
    this.shakeAmount = 0;
    this.introTween = null;

    this.pointers = new Map();
    this.dragDistance = 0;
    this.pressTime = 0;
    this.pinch = null;
    this.usedPinch = false;

    this._bind();
  }

  _bind() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      canvas.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 1) this.usedPinch = false;
      this.idle = 0;
      this.dragDistance = 0;
      this.pressTime = performance.now();
      this.dragging = true;
      canvas.classList.add('is-dragging');
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this._startPinchIfNeeded();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!this.enabled) return;
      const tracked = this.pointers.get(event.pointerId);
      if (!tracked) return;
      const prevX = tracked.x;
      const prevY = tracked.y;
      tracked.x = event.clientX;
      tracked.y = event.clientY;

      if (this.pointers.size >= 2) {
        this._updatePinch();
        return;
      }

      const dx = event.clientX - prevX;
      const dy = event.clientY - prevY;
      if (!this.dragging) {
        this.dragging = true;
        canvas.classList.add('is-dragging');
      }
      this.dragDistance += Math.hypot(dx, dy);
      this.targetTheta -= dx * 0.0055;
      this.targetPhi = clamp(this.targetPhi - dy * 0.0055, this.minPhi, this.maxPhi);
      this.idle = 0;
    });

    const finish = (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinch = null;

      if (this.pointers.size === 1) {
        // Keep dragging with the remaining finger without a jump.
        const remaining = this.pointers.values().next().value;
        this.lastPointer = { x: remaining.x, y: remaining.y };
        return;
      }
      if (this.pointers.size > 1) return;

      const elapsed = performance.now() - this.pressTime;
      const isTap =
        this.dragDistance < 8 && elapsed < 400 && !this.usedPinch && event.type !== 'pointercancel';
      this.dragging = false;
      canvas.classList.remove('is-dragging');
      if (isTap && this.onTap) this.onTap(event.clientX, event.clientY);
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('pointerleave', (event) => {
      if (this.pointers.size === 0) canvas.classList.remove('is-dragging');
      if (event.pointerType === 'mouse') this.hoverX = null;
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.pointers.size === 0) {
        this.hoverX = event.clientX;
        this.hoverY = event.clientY;
      }
    });

    canvas.addEventListener(
      'wheel',
      (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        const scale = Math.exp(event.deltaY * 0.0011);
        this.targetRadius = clamp(this.targetRadius * scale, this.minRadius, this.maxRadius);
        this.idle = 0;
      },
      { passive: false }
    );

    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  _startPinchIfNeeded() {
    if (this.pointers.size !== 2) return;
    const [a, b] = [...this.pointers.values()];
    this.usedPinch = true;
    this.pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      radius: this.targetRadius,
    };
    this.dragging = true;
  }

  _updatePinch() {
    if (!this.pinch) {
      this._startPinchIfNeeded();
      return;
    }
    const [a, b] = [...this.pointers.values()];
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const ratio = this.pinch.distance / distance;
    this.targetRadius = clamp(this.pinch.radius * ratio, this.minRadius, this.maxRadius);
    this.idle = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  nudge(dTheta, dPhi) {
    if (!this.enabled) return;
    this.targetTheta += dTheta;
    this.targetPhi = clamp(this.targetPhi + dPhi, this.minPhi, this.maxPhi);
    this.idle = 0;
  }

  resetView() {
    this.targetTheta = 0.22;
    this.targetPhi = 1.26;
    this.targetRadius = 9.8;
    this.targetFocus.x = 0;
    this.targetFocus.y = 0.06;
  }

  /** Frame the scene off-centre, e.g. to leave room for the intro card. */
  setComposition(x, y) {
    this.focus.x = x;
    this.focus.y = y;
    this.targetFocus.x = x;
    this.targetFocus.y = y;
  }

  playIntro() {
    this.introTween = {
      t: 0,
      duration: 1.8,
      radiusFrom: this.radius,
      radiusTo: 9.8,
      phiFrom: this.phi,
      phiTo: 1.26,
      thetaFrom: this.theta,
      thetaTo: 0.22,
      focusFrom: { ...this.focus },
      focusTo: { x: 0, y: 0.06, z: 0 },
    };
  }

  finishIntro() {
    if (!this.introTween) return;
    this.introTween = null;
    this.radius = 9.8;
    this.phi = 1.26;
    this.theta = 0.22;
    this.targetRadius = 9.8;
    this.targetPhi = 1.26;
    this.targetTheta = 0.22;
    this.focus.x = 0;
    this.focus.y = 0.06;
    this.targetFocus.x = 0;
    this.targetFocus.y = 0.06;
  }

  shake(amount = 0.1) {
    this.shakeAmount = Math.min(0.4, this.shakeAmount + amount);
  }

  update(dt) {
    this.idle += dt;

    if (this.introTween) {
      const tween = this.introTween;
      tween.t = Math.min(1, tween.t + dt / tween.duration);
      const e = easeInOutCubic(tween.t);
      this.radius = tween.radiusFrom + (tween.radiusTo - tween.radiusFrom) * e;
      this.phi = tween.phiFrom + (tween.phiTo - tween.phiFrom) * e;
      this.theta = tween.thetaFrom + (tween.thetaTo - tween.thetaFrom) * e;
      this.targetRadius = this.radius;
      this.targetPhi = this.phi;
      this.targetTheta = this.theta;
      this.focus.x = tween.focusFrom.x + (tween.focusTo.x - tween.focusFrom.x) * e;
      this.focus.y = tween.focusFrom.y + (tween.focusTo.y - tween.focusFrom.y) * e;
      this.focus.z = 0;
      this.targetFocus.x = this.focus.x;
      this.targetFocus.y = this.focus.y;
      if (tween.t >= 1) this.introTween = null;
    } else {
      if (this.idle > 7 && !this.dragging) {
        this.targetTheta += 0.022 * dt;
      }
      this.theta = damp(this.theta, this.targetTheta, 9, dt);
      this.phi = damp(this.phi, this.targetPhi, 9, dt);
      this.radius = damp(this.radius, this.targetRadius, 7, dt);
      this.focus.x = damp(this.focus.x, this.targetFocus.x, 3.2, dt);
      this.focus.y = damp(this.focus.y, this.targetFocus.y, 3.2, dt);
    }

    const sinPhi = Math.sin(this.phi);
    let x = this.radius * sinPhi * Math.sin(this.theta);
    let y = this.radius * Math.cos(this.phi);
    let z = this.radius * sinPhi * Math.cos(this.theta);

    if (this.shakeAmount > 0.0005) {
      x += (Math.random() - 0.5) * this.shakeAmount;
      y += (Math.random() - 0.5) * this.shakeAmount;
      z += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount = damp(this.shakeAmount, 0, 7, dt);
    }

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.focus.x, this.focus.y, this.focus.z);
  }
}

