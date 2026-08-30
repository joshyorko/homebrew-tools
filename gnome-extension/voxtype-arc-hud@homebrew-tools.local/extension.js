import Clutter from "gi://Clutter"
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

      this._halo = new St.Widget({
        style_class: "voxtype-arc-halo",
        layout_manager: new Clutter.BinLayout(),
      })
      this._orbit = new St.Widget({
        style_class: "voxtype-arc-orbit",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._arc = new St.Widget({
        style_class: "voxtype-arc-ring",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._inner = new St.Widget({
        style_class: "voxtype-arc-inner",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._coreOuter = new St.Widget({
        style_class: "voxtype-arc-core-outer",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._coreInner = new St.Widget({
        style_class: "voxtype-arc-core-inner",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._coreDot = new St.Widget({
        style_class: "voxtype-arc-core-dot",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
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

      this._halo.add_child(this._orbit)
      this._halo.add_child(this._arc)
      this._halo.add_child(this._inner)
      this._halo.add_child(this._coreOuter)
      this._halo.add_child(this._coreInner)
      this._halo.add_child(this._coreDot)
      this._status.add_child(this._pip)
      this._status.add_child(this._label)
      this.add_child(this._halo)
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
        this._arc.rotation_angle_z = this._rotation
        this._orbit.rotation_angle_z = -this._rotation * 0.7
        this._coreOuter.opacity = this._state === TRANSCRIBING
          ? 150 + Math.floor(105 * Math.abs(Math.sin(this._rotation * Math.PI / 45)))
          : 255
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
