import { app, BrowserWindow, ipcMain, session } from 'electron'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

app.setPath('userData', resolve('.cache/dictation-audio/home'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, answer) => answer(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, answer) => answer({ cancel: true }))
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } })
  const timeout = setTimeout(() => { console.error('audio probe timed out'); app.exit(1) }, 30000)
  ipcMain.on('audio-probe', (event, result) => {
    if (event.sender !== window.webContents) return
    clearTimeout(timeout)
    writeFileSync(resolve('.cache/dictation-audio/result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
    app.exit(result.ok ? 0 : 1)
  })
  window.webContents.on('render-process-gone', () => app.exit(1))
  await window.loadFile(resolve('.cache/dictation-audio/probe.html'))
})
