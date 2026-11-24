import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'

const [mode, username, target, ...options] = process.argv.slice(2)
if (!['invite','revoke'].includes(mode) || !/^ops-[a-z0-9][a-z0-9_.-]{0,27}$/.test(username ?? '') ||
    !['--local','--remote'].includes(target) || (options.length && (target !== '--local' || options.length !== 2 || options[0] !== '--persist-to'))) {
  throw new Error('Usage: node scripts/grant-reviewer.mjs invite|revoke ops-username --remote (or --local [--persist-to PATH])')
}
function execute(sql) {
  const output = execFileSync('wrangler', ['d1','execute','DB',target,...options,'--config','wrangler.jsonc','--json','--command',sql], {encoding:'utf8'})
  const results = JSON.parse(output)
  if (!results.every(result => result.success)) throw new Error('Operator administration failed.')
  return results
}
const now = Date.now()
if (mode === 'invite') {
  const existing = execute(`SELECT 1 FROM users WHERE username='${username}'`)[0].results
  if (existing.length) throw new Error('This username already exists. Use a new, dedicated operator username.')
  const token = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(token).digest('hex')
  execute(`UPDATE bunker_operator_invites SET expires_at=${now}
    WHERE username='${username}' AND used_by IS NULL AND expires_at>${now}`)
  const [inserted] = execute(`INSERT INTO bunker_operator_invites VALUES
    ('${hash}','${username}',${now},${now + 3600000},NULL) RETURNING username`)
  if (inserted.results.length !== 1) throw new Error('Invitation was not created.')
  console.log('Private, single-use operator activation path. Share it directly with the verified operator. It expires in one hour.')
  console.log('/register#operator=' + token)
} else {
  const [revoked] = execute(`UPDATE bunker_operators SET revoked_at=${now} WHERE revoked_at IS NULL AND user_id IN
    (SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id WHERE u.username='${username}' AND c.workspace_kind='operations')
    RETURNING user_id`)
  if (revoked.results.length !== 1) throw new Error('No active, dedicated operator account matched.')
  console.log('Operator privileges revoked and sessions signed out.')
}
