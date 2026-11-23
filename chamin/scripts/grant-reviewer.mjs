import { execFileSync } from 'node:child_process'

const username = process.argv[2]
if (process.argv.length !== 3 || !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username ?? '')) {
  throw new Error('Usage: node scripts/grant-reviewer.mjs <registered-username>')
}
const output = execFileSync('wrangler', [
  'd1', 'execute', 'DB', '--remote', '--json', '--command',
  "UPDATE users SET reviewer=1 WHERE username='" + username + "' AND role='owner'",
], { encoding: 'utf8' })
const [result] = JSON.parse(output)
if (!result.success || result.meta.changes !== 1) throw new Error('No matching registered company owner was found.')
console.log('Reviewer access granted. Open /workspace/review while signed in.')
