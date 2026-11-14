// Real Chromium AudioWorklet/MediaStream integration, without opening a physical microphone.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import electron from 'electron'

mkdirSync('.cache/dictation-audio', { recursive: true })
await build({ entryPoints: ['scripts/dictation/audio-harness.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: '.cache/dictation-audio/harness.cjs' })
await build({ entryPoints: ['scripts/dictation/audio-renderer.ts'], bundle: true, platform: 'browser', format: 'iife', external: ['electron'], outfile: '.cache/dictation-audio/renderer.js' })
copyFileSync('media/pcm-worklet.js', '.cache/dictation-audio/pcm-worklet.js')
writeFileSync('.cache/dictation-audio/probe.html', '<!doctype html><meta charset="utf-8"><title>Dictation audio test</title><script src="renderer.js"></script>')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(String(electron), ['.cache/dictation-audio/harness.cjs'], { env, stdio: 'inherit', windowsHide: true })
process.exit(result.status ?? 1)
