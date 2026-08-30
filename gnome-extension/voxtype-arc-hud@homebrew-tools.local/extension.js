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
        vertical: false,
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
      this._outerRing = new St.Widget({
        style_class: "voxtype-arc-ring voxtype-arc-ring-outer",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._innerRing = new St.Widget({
        style_class: "voxtype-arc-ring voxtype-arc-ring-inner",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._core = new St.Widget({
        style_class: "voxtype-arc-core",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._pip = new St.Widget({
        style_class: "voxtype-arc-pip",
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
      })
      this._label = new St.Label({ style_class: "voxtype-arc-label", text: "READY" })
      this._timer = new St.Label({ style_class: "voxtype-arc-timer", text: "" })
      this._info = new St.BoxLayout({ style_class: "voxtype-arc-info", vertical: true })

      this._halo.add_child(this._outerRing)
      this._halo.add_child(this._innerRing)
      this._halo.add_child(this._core)
      this._halo.add_child(this._pip)
      this._info.add_child(this._label)
      this._info.add_child(this._timer)
      this.add_child(this._halo)
      this.add_child(this._info)

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
      this.set_size(260, 104)
      this.set_position(
        Math.floor(monitor.x + (monitor.width - 260) / 2),
        Math.floor(monitor.y + monitor.height - 144),
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
        this._timer.text = ""
        this._stopTicker()
      } else {
        this._recordingStartedAt = 0
        this._label.text = "SIGNAL LOST"
        this._timer.text = ""
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
        if (this._state !== RECORDING) {
          this._ticker = 0
          return GLib.SOURCE_REMOVE
        }
        this._rotation = (this._rotation + 2.5) % 360
        this._outerRing.rotation_angle_z = this._rotation
        this._innerRing.rotation_angle_z = -this._rotation * 1.7
        const elapsed = Math.max(0, Math.floor((Date.now() - this._recordingStartedAt) / 1000))
        this._timer.text = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
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
