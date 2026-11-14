// npm run build, then this script: a local installer and ZIP, never installed or published.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const folder = resolve('.cache/dictation-package')
mkdirSync(folder, { recursive: true })
const config = {
  extends: resolve('electron-builder.yml'),
  directories: { output: 'release/dictation-test' },
  extraMetadata: { version },
  extraFiles: [{ from: 'build/dictation-test', to: '.', filter: ['**/*'] }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
    artifactName: 'Kryakl-${version}.${ext}',
  },
  nsis: { runAfterFinish: false },
}
const file = resolve(folder, 'builder.json')
writeFileSync(file, JSON.stringify(config, null, 2))
const result = spawnSync(process.execPath, ['node_modules/electron-builder/cli.js', '--config', file, '--win', '--x64', '--publish', 'never'], { stdio: 'inherit', windowsHide: true })
process.exit(result.status ?? 1)
