const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repetitions = Number(process.env.AUTH_TEST_REPEATS || 20)
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 100) {
  throw new Error('AUTH_TEST_REPEATS must be an integer from 1 to 100')
}
console.log(`Auth stability: ${process.platform}, Node ${process.version}, SQLite ${process.versions.sqlite}, repetitions ${repetitions}`)
for (let attempt = 1; attempt <= repetitions; attempt += 1) {
  console.log(`Auth stability run ${attempt}/${repetitions}`)
  const result = spawnSync(process.execPath, ['--test', 'tests/auth.test.js', 'tests/auth-process.test.js', 'tests/sqliteSessionStore.test.js'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit', timeout: 60_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
