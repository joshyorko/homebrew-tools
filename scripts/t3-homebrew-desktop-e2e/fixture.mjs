import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises'
export async function fixture(root, appDir, failCask = false) {
  const old = JSON.parse(await readFile(appDir + '/resources/t3-homebrew-build.json', 'utf8'))
  const next = 'main.20261107210915.111122223333'
  const nextSha = '111122223333' + '0'.repeat(28)
  const prefix = root + '/prefix', bin = root + '/fakebin', state = root + '/brew-state'
  for (const dir of [bin,state,prefix+'/bin',prefix+'/Cellar/t3code-cli-main/'+old.packageVersion,prefix+'/Caskroom/t3-code-linux/.metadata',root+'/ruby-lib']) await mkdir(dir, {recursive:true})
  await writeFile(state+'/old',old.packageVersion)
  await writeFile(state+'/linked',old.packageVersion)
  await writeFile(state+'/installed',old.packageVersion+'\n')
  await writeFile(state+'/active','active')
  const receipt = version => JSON.stringify({source:{tap:'joshyorko/tools',version}})
  await writeFile(prefix+'/Cellar/t3code-cli-main/'+old.packageVersion+'/INSTALL_RECEIPT.json', receipt(old.packageVersion))
  await writeFile(prefix+'/Caskroom/t3-code-linux/.metadata/INSTALL_RECEIPT.json', receipt(old.packageVersion))
  await writeFile(root+'/ruby-lib/pkg_version.rb','class PkgVersion; def self.parse(value); value; end; end\n')
  const setup = `prefix='${prefix}'\nstate='${state}'\nnext='${next}'\nold='${old.packageVersion}'\nprintf '%s\\n' "$*" >> '${root}/commands.log'\n`
  const brew = `#!/bin/bash
set -euo pipefail
${setup}
case "$1" in
 --prefix) echo "$prefix" ;;
 --cellar) echo "$prefix/Cellar" ;;
 ruby) shift; RUBYLIB='${root}/ruby-lib' exec /usr/bin/ruby "$@" ;;
 update|fetch) exit 0 ;;
 info)
  if [[ " $* " == *" --installed "* ]]; then
   items=""; while read -r ver; do [[ -z "$items" ]] || items="$items,"; items="$items{\\"version\\":\\"$ver\\"}"; done < "$state/installed"
   printf '{"formulae":[{"name":"t3code-cli-main","tap":"joshyorko/tools","linked_keg":"%s","installed":[%s]}]}\\n' "$(cat "$state/linked")" "$items"
  elif [[ " $* " == *" --cask "* ]]; then printf '{"casks":[{"token":"t3-code-linux","tap":"joshyorko/tools","version":"%s"}]}\\n' "$next"
  else printf '{"formulae":[{"name":"t3code-cli-main","tap":"joshyorko/tools","versions":{"stable":"%s"},"revision":0}]}\\n' "$next"; fi ;;
 upgrade)
  if kill -0 "$(cat '${root}/desktop.pid')" 2>/dev/null; then echo 'Desktop still active' >&2; exit 99; fi
  if [[ " $* " == *" --formula "* ]]; then
   mkdir -p "$prefix/Cellar/t3code-cli-main/$next"; printf '%s' '${receipt(next)}' > "$prefix/Cellar/t3code-cli-main/$next/INSTALL_RECEIPT.json"
   echo "$next" > "$state/linked"; echo "$next" >> "$state/installed"
  else
   ${failCask ? "exit 31" : `printf '%s' '${receipt(next)}' > "$prefix/Caskroom/t3-code-linux/.metadata/INSTALL_RECEIPT.json"\n   printf '%s' '${JSON.stringify({packageVersion:next,sourceCommit:nextSha})}' > '${appDir}/resources/t3-homebrew-build.json'`}
  fi ;;
 uninstall) test "$HOMEBREW_NO_AUTOREMOVE" = 1; echo "$old" > "$state/installed" ;;
 link) echo "$old" > "$state/linked" ;;
 *) exit 2 ;;
esac
`
  const systemctl = `#!/bin/bash\nset -eu\n${setup}\nshift\ncase "$1" in is-active) [[ " $* " == *" sh.brew.t3code-cli-main.service "* ]] && test -f "$state/active" || exit 3 ;; stop) rm "$state/active" ;; start) touch "$state/active" ;; daemon-reload) exit 0 ;; *) exit 2 ;; esac\n`
  for (const [name,contents] of [['brew',brew],['systemctl',systemctl],['ss','#!/bin/sh\nexit 0\n'],['pgrep','#!/bin/sh\nexit 1\n']]) { await writeFile(bin+'/'+name,contents); await chmod(bin+'/'+name,0o700) }
  await writeFile(prefix+'/bin/t3-code-linux',`#!/bin/bash\nprintf relaunched > '${root}/relaunched'\nprintf '%s' "$T3CODE_HOME" > '${root}/relaunch-t3-home' \nexport T3CODE_TELEMETRY_ENABLED=false\nexec '${appDir}/AppRun' --no-sandbox --remote-debugging-port=9223\n`)
  await chmod(prefix+'/bin/t3-code-linux',0o700)
  return { bin, prefix, old, next }
}
