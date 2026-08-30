import Clutter from "gi://Clutter"
import Cairo from "gi://cairo"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import GObject from "gi://GObject"
import St from "gi://St"
import * as Main from "resource:///org/gnome/shell/ui/main.js"
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js"

const UUID = "voxtype-arc-hud@homebrew-tools.local"
const IDLE = "idle"
const RECORDING = "recording"
const TRANSCRIBING = "transcribing"
const ERROR = "error"

const ReactorCanvas = GObject.registerClass(
  class ReactorCanvas extends St.DrawingArea {
    _init() {
      super._init({
        width: 160,
        height: 160,
        reactive: false,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._angle = 0
      this._processing = false
    }

    setFrame(angle, processing) {
      this._angle = angle
      this._processing = processing
      this.queue_repaint()
    }

    _strokeGlow(cr, cx, cy, radius, red, green, blue, alpha, width = 2) {
      for (const [extra, glowAlpha] of [[10, 0.035], [6, 0.07], [3, 0.16]]) {
        cr.setLineWidth(width + extra)
        cr.setSourceRGBA(red, green, blue, glowAlpha)
        cr.arc(cx, cy, radius, 0, Math.PI * 2)
        cr.stroke()
      }
      cr.setLineWidth(width)
      cr.setSourceRGBA(red, green, blue, alpha)
      cr.arc(cx, cy, radius, 0, Math.PI * 2)
      cr.stroke()
    }

    vfunc_repaint() {
      const [width, height] = this.get_surface_size()
      const cr = this.get_context()
      const cx = width / 2
      const cy = height / 2
      const scale = Math.min(width, height) / 160
      const angle = this._angle * Math.PI / 180
      const cyan = this._processing ? [1.0, 0.82, 0.34] : [0.28, 0.87, 1.0]

      cr.setOperator(Cairo.Operator.CLEAR)
      cr.paint()
      cr.setOperator(Cairo.Operator.OVER)
      cr.setLineCap(Cairo.LineCap.ROUND)

      cr.setLineWidth(1 * scale)
      cr.setSourceRGBA(0.24, 0.86, 1.0, 0.24)
      cr.arc(cx, cy, 71 * scale, 0, Math.PI * 2)
      cr.stroke()

      cr.setLineWidth(1.6 * scale)
      cr.setSourceRGBA(...cyan, 0.92)
      for (const start of [angle, angle + Math.PI]) {
        cr.arc(cx, cy, 71 * scale, start, start + 0.72)
        cr.stroke()
      }

      this._strokeGlow(cr, cx, cy, 53 * scale, ...cyan, 0.96, 2 * scale)

      cr.save()
      cr.setDash([4 * scale, 4 * scale], this._angle * 0.12)
      cr.setLineWidth(1 * scale)
      cr.setSourceRGBA(0.25, 0.85, 1.0, 0.86)
      cr.arc(cx, cy, 42 * scale, 0, Math.PI * 2)
      cr.stroke()
      cr.restore()

      cr.setLineWidth(1 * scale)
      for (let index = 0; index < 24; index += 1) {
        const tick = angle * 0.35 + index * Math.PI / 12
        const inner = (index % 3 === 0 ? 57 : 60) * scale
        const outer = 65 * scale
        cr.setSourceRGBA(0.32, 0.89, 1.0, index % 3 === 0 ? 0.72 : 0.34)
        cr.moveTo(cx + Math.cos(tick) * inner, cy + Math.sin(tick) * inner)
        cr.lineTo(cx + Math.cos(tick) * outer, cy + Math.sin(tick) * outer)
        cr.stroke()
      }

      const outerCore = new Cairo.RadialGradient(cx, cy, 2 * scale, cx, cy, 27 * scale)
      outerCore.addColorStopRGBA(0, 0.85, 0.99, 1.0, 1.0)
      outerCore.addColorStopRGBA(0.22, 0.15, 0.82, 1.0, 0.96)
      outerCore.addColorStopRGBA(0.55, 0.05, 0.65, 0.88, 0.38)
      outerCore.addColorStopRGBA(1, 0.04, 0.35, 0.5, 0.03)
      cr.setSource(outerCore)
      cr.arc(cx, cy, 27 * scale, 0, Math.PI * 2)
      cr.fill()

      this._strokeGlow(cr, cx, cy, 26 * scale, 0.73, 0.97, 1.0, 0.94, 1 * scale)

      cr.setSourceRGBA(0.15, 0.81, 1.0, 0.95)
      cr.arc(cx, cy, 12 * scale, 0, Math.PI * 2)
      cr.fill()
      cr.setSourceRGBA(0.86, 0.99, 1.0, 1.0)
      cr.arc(cx, cy, 4.5 * scale, 0, Math.PI * 2)
      cr.fill()

      cr.$dispose()
    }
  },
)

const ArcReactor = GObject.registerClass(
  class ArcReactor extends St.BoxLayout {
    _init() {
      super._init({
        style_class: "voxtype-arc-reactor",
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        reactive: false,
        can_focus: false,
        visible: false,
      })

      this._state = IDLE
      this._recordingStartedAt = 0
      this._rotation = 0
      this._ticker = 0
      this._errorTimer = 0
      this._monitor = null

      this._canvas = new ReactorCanvas()
      this._pip = new St.Widget({
        style_class: "voxtype-arc-pip",
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._label = new St.Label({ style_class: "voxtype-arc-label", text: "READY" })
      this._status = new St.BoxLayout({
        style_class: "voxtype-arc-status",
        vertical: false,
        x_align: Clutter.ActorAlign.CENTER,
      })

      this._status.add_child(this._pip)
      this._status.add_child(this._label)
      this.add_child(this._canvas)
      this.add_child(this._status)

      const statePath = GLib.build_filenamev([GLib.get_user_runtime_dir(), "voxtype", "state"])
      this._stateFile = Gio.File.new_for_path(statePath)
      try {
        this._monitor = this._stateFile.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null)
        this._monitor.connect("changed", () => this._readState())
      } catch (error) {
        log(`${UUID}: unable to monitor Voxtype state: ${error}`)
      }

      this._monitorId = Main.layoutManager.connect("monitors-changed", () => this._position())
      Main.layoutManager.addChrome(this, { affectsStruts: false, trackFullscreen: false })
      this._position()
      this._readState()
    }

    _position() {
      const monitor = Main.layoutManager.primaryMonitor
      if (!monitor) return
      this.set_size(180, 188)
      this.set_position(
        Math.floor(monitor.x + (monitor.width - 180) / 2),
        Math.floor(monitor.y + 86),
      )
    }

    _readState() {
      try {
        const [, contents] = this._stateFile.load_contents(null)
        const state = new TextDecoder().decode(contents).trim()
        this._setState([IDLE, RECORDING, TRANSCRIBING].includes(state) ? state : ERROR)
      } catch (_error) {
        this._setState(IDLE)
      }
    }

    _setState(state) {
      if (state === this._state && state !== RECORDING) return
      this._state = state
      this.remove_style_class_name("recording")
      this.remove_style_class_name("transcribing")
      this.remove_style_class_name("error")

      if (state === IDLE) {
        this.visible = false
        this._stopTicker()
        return
      }

      this.visible = true
      this.add_style_class_name(state)
      if (state === RECORDING) {
        if (!this._recordingStartedAt) this._recordingStartedAt = Date.now()
        this._label.text = "LISTENING"
        this._startTicker()
      } else if (state === TRANSCRIBING) {
        this._recordingStartedAt = 0
        this._label.text = "PROCESSING"
        this._startTicker()
      } else {
        this._recordingStartedAt = 0
        this._label.text = "SIGNAL LOST"
        this._stopTicker()
        if (this._errorTimer) GLib.source_remove(this._errorTimer)
        this._errorTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1400, () => {
          this._errorTimer = 0
          this._setState(IDLE)
          return GLib.SOURCE_REMOVE
        })
      }
    }

    _startTicker() {
      if (this._ticker) return
      this._ticker = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 48, () => {
        if (![RECORDING, TRANSCRIBING].includes(this._state)) {
          this._ticker = 0
          return GLib.SOURCE_REMOVE
        }
        const speed = this._state === TRANSCRIBING ? 4.5 : 2.5
        this._rotation = (this._rotation + speed) % 360
        this._canvas.setFrame(this._rotation, this._state === TRANSCRIBING)
        return GLib.SOURCE_CONTINUE
      })
    }

    _stopTicker() {
      if (!this._ticker) return
      GLib.source_remove(this._ticker)
      this._ticker = 0
    }

    destroy() {
      this._stopTicker()
      if (this._errorTimer) GLib.source_remove(this._errorTimer)
      if (this._monitor) this._monitor.cancel()
      if (this._monitorId) Main.layoutManager.disconnect(this._monitorId)
      Main.layoutManager.removeChrome(this)
      super.destroy()
    }
  },
)

export default class VoxtypeArcHudExtension extends Extension {
  enable() {
    this._hud = new ArcReactor()
  }

  disable() {
    this._hud?.destroy()
    this._hud = null
  }
}
