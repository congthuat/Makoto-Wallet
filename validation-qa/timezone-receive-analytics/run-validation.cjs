const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const frontend = path.join(root, 'frontend')
const mode = process.argv[2] || 'all'
const suites = mode === 'core'
  ? ['test:brain', 'test:agent', 'test:tasks', 'test:portfolio', 'test:ux', 'test:migration']
  : mode === 'finish' ? ['test:ui', 'test:polish', 'type-check', 'lint', 'build:client', 'build:server']
    : ['test:brain', 'test:agent', 'test:tasks', 'test:portfolio', 'test:ux', 'test:migration', 'test:ui', 'test:polish', 'type-check', 'lint', 'build:client', 'build:server']
const results = []
for (const suite of suites) {
  const start = Date.now()
  const result = spawnSync(process.env.ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${suite}`], { cwd: frontend, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  fs.writeFileSync(path.join(__dirname, `validation-${suite.replace(':', '-')}.log`), output)
  const number = (label) => Number(output.match(new RegExp(`\\b${label} (\\d+)`))?.[1] || 0)
  const row = { suite, exitCode: result.status, tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped'), durationMs: Date.now() - start }
  results.push(row)
  console.log(JSON.stringify(row))
  fs.writeFileSync(path.join(__dirname, `validation-${mode}.json`), JSON.stringify({ observedAt: new Date().toISOString(), results }, null, 2))
  if (result.status !== 0) process.exitCode = 1
}
