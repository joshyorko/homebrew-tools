import { _electron as electron, chromium } from '/runner/node_modules/playwright-core/index.mjs'
import { readdir, mkdir, copyFile, chmod, writeFile, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fixture } from './fixture.mjs'
import assert from 'node:assert/strict'
const exec = promisify(execFile)
const root = '/tmp/t3-ui-test'
await mkdir(root, { recursive: true })
const bundle = '/work/' + (process.env.BUNDLE_DIR || 'bundle')
const artifacts = await readdir(bundle+'/artifacts')
const artifact = artifacts.find(name => name.endsWith('.AppImage'))
if (!artifact) throw new Error('No candidate AppImage')
await copyFile(bundle+'/artifacts/' + artifact, root + '/candidate.AppImage')
await chmod(root + '/candidate.AppImage', 0o700)
await exec(root + '/candidate.AppImage', ['--appimage-extract'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
for (const name of ['home','config','state','runtime','data']) await mkdir(root + '/' + name, { recursive: true, mode: 0o700 })
const fake = await fixture(root, root + '/squashfs-root', process.env.CASE === 'failure')
const app = await electron.launch({ executablePath: root + '/squashfs-root/AppRun', args: ['--no-sandbox'], env: {
  PATH: fake.bin + ':' + process.env.PATH, HOME: root + '/home', DISPLAY: ':99',
  XDG_CONFIG_HOME: root + '/config', XDG_STATE_HOME: root + '/state', XDG_RUNTIME_DIR: root + '/runtime', XDG_DATA_HOME: root + '/data',
  T3CODE_HOME: root + '/home/.t3', T3CODE_TELEMETRY_ENABLED: 'false',
}, timeout: 90_000 })
await writeFile(root + '/desktop.pid', String(app.process().pid))
const runtime = await app.evaluate(({app}) => ({ version: app.getVersion(), packaged: app.isPackaged }))
assert.equal(runtime.packaged, true)
try {
  const page = await app.firstWindow({ timeout: 90_000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(5000)
  await page.screenshot({ path: root + '/initial.png' })
  await writeFile(root + '/initial.txt', await page.locator('body').innerText())
  console.log('APP_READY')
  await page.getByRole('button', {name: 'Close', exact: true}).click()
  const initialState = await page.evaluate(() => window.desktopBridge.getUpdateState())
  assert.equal(initialState.currentVersion, fake.old.packageVersion)
  assert.equal(initialState.enabled, true)
  assert.equal(Object.hasOwn(initialState, 'homebrewUpdateResult'), false)
  await page.screenshot({path:root+'/closed.png'})
  await page.getByRole('button', {name: /^Check for updates/}).click({timeout:5000})
  const available = page.getByRole('button', {name: /Homebrew update available for/})
  await available.waitFor({timeout:30000})
  const label = await available.getAttribute('aria-label')
  for (const value of [fake.old.packageVersion, fake.next, 't3code-cli-main', 't3-code-linux', 'joshyorko/tools', '111122223333']) assert.ok(label.includes(value), value)
  console.log('AVAILABLE', label)
  await available.click()
  const prepared = page.getByRole('button', {name: /Homebrew packages.*are prepared/})
  await prepared.waitFor({timeout:30000})
  await prepared.click()
  await page.waitForTimeout(500)
  await page.screenshot({path:root+'/confirmation.png'})
  console.log('CONFIRMATION_SHOWN')
  assert.doesNotMatch(await readFile(root+'/commands.log','utf8'), /(?:^|\n)upgrade /)
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.doesNotMatch(await readFile(root+'/commands.log','utf8'), /(?:^|\n)upgrade /)
  await prepared.click()
  void page.getByRole('button',{name:'Confirm',exact:true}).click({noWaitAfter:true,timeout:5000}).catch(()=>{})
  for (let i=0;i<120;i++) { try { await readFile(root+'/relaunched'); break } catch {} await new Promise(resolve=>setTimeout(resolve,500)) }
  assert.equal(await readFile(root+'/relaunched','utf8'),'relaunched')
  console.log('DESKTOP_EXITED')
  let browser
  for (let i=0;i<120;i++) {
    try { browser=await chromium.connectOverCDP('http://127.0.0.1:9223',{timeout:500}); break } catch { await new Promise(resolve=>setTimeout(resolve,500)) }
  }
  assert.ok(browser,'Desktop relaunched')
  const second=browser.contexts()[0].pages()[0]
  await second.waitForLoadState('domcontentloaded')
  const outcome = process.env.CASE === 'failure' ? 'failed' : 'installed'
  await second.getByText('Homebrew update '+outcome,{exact:true}).first().waitFor({timeout:60000})
  const state=await second.evaluate(()=>window.desktopBridge.getUpdateState())
  assert.equal(state.currentVersion, outcome==='installed' ? fake.next : fake.old.packageVersion)
  assert.equal(state.homebrewUpdateResult.outcome,outcome)
  await second.screenshot({path:root+'/result.png'})
  console.log('RESULT',JSON.stringify(state.homebrewUpdateResult))
  const commands = await readFile(root+'/commands.log','utf8')
  const stopped = commands.indexOf('--user stop sh.brew.t3code-cli-main.service')
  const upgraded = commands.indexOf('upgrade --formula')
  const started = commands.indexOf('--user start sh.brew.t3code-cli-main.service')
  assert.ok(stopped >= 0 && upgraded > stopped && started > upgraded, 'Homebrew service lifecycle ordering')
  if (outcome === 'failed') { assert.ok(commands.includes('uninstall --formula')); assert.ok(commands.includes('link --overwrite')) }
  const socket = second.waitForEvent('websocket',{predicate:ws=>['127.0.0.1','localhost'].includes(new URL(ws.url()).hostname),timeout:30000})
  await second.reload()
  const ws=await socket
  await ws.waitForEvent('framereceived',{timeout:30000})
  console.log('RECONNECTED_TO_LOCAL_BACKEND')
  await writeFile(root+'/report.json',JSON.stringify({outcome,packageVersion:state.currentVersion,electronVersion:runtime.version,sourceCommit:fake.old.sourceCommit,cancelledFirst:true,confirmed:true,relaunched:true,reconnected:true,network:'none',homebrew:'fake',systemd:'fake'},null,2))
  await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,2000))])
} finally { await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,2000))]) }

process.exit(0)
