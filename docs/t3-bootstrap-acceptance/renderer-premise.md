# Application-renderer readiness

The failed premise was that Electron's first window plus `domcontentloaded`
identified a ready application renderer. The real 4b1b43c receipt records an
unloaded URL after that wait, followed by an evaluation context destroyed during
navigation. The preceding 22953e6 receipt failed parsing that same transient URL.

Two lightweight lifecycle regressions fail with the old readiness helper and pass
with the new one: an unloaded first window must not settle readiness, and a later
application window must be selected instead of the first window.

The harness now observes existing and future windows and waits for the production
`t3code://app` URL, a mounted application root, and the required preload bridge.
One-off diagnostics run only after the existing pairing-confirmation assertion,
so recovery's reload is not mistaken for readiness. Pairing, service ownership,
connection, preservation, source, and resource assertions are unchanged.

The actual packaged run at harness 287d3143dde4e8274ab8af4ac2be4c3c15bcd6df
observed an unloaded candidate followed by `t3code://app/` readiness and pairing
confirmation. All four scenarios passed against the unchanged f5fa0cc candidate
at upstream 26e769d6c4fd955429595828ac572efeca006168. See
[the complete GUI verdict and reports](remote-gui-passed.json).
