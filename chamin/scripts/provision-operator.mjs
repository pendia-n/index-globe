import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The production Worker derives the password verifier using its own signing secret.
// This tool never reads local environment files or retrieves the Worker secret.
const [username, outputDirectory, target = '--remote'] = process.argv.slice(2)
if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username || '') || !outputDirectory || !['--remote','--local'].includes(target)) {
  throw new Error('Usage: node scripts/provision-operator.mjs USERNAME PRIVATE_OUTPUT_DIRECTORY --remote; password supplied on stdin')
}
const password = readFileSync(0, 'utf8').trim()
if (!/^(?=.*[a-zA-Z])(?=.*\d).{12,18}$/.test(password)) throw new Error('Password must meet the existing Worker password rules.')
function execute(sql) {
  return JSON.parse(execFileSync('wrangler', ['d1','execute','DB',target,'--config','wrangler.jsonc','--json','--command',sql], {encoding:'utf8',stdio:['ignore','pipe','pipe']}))
}
if (execute(`SELECT 1 FROM users WHERE username='${username}'`)[0].results.length) {
  throw new Error('Username already exists. Refusing to change an existing account.')
}
const token=randomBytes(32).toString('hex')
const hash=createHash('sha256').update(token).digest('hex')
const now=Date.now()
execute(`INSERT INTO bunker_operator_invites VALUES('${hash}','${username}',${now},${now+600000},NULL)`)
const recovery=randomBytes(20).toString('hex')
const directory=resolve(outputDirectory)
mkdirSync(directory,{recursive:true,mode:0o700})
writeFileSync(resolve(directory,'Teder operator recovery.txt'),`Teder operator ${username}\nRecovery code: ${recovery.match(/.{5}/g).join('-')}\nStore privately. Recovery requires your username and this code.\n`,{mode:0o600,flag:'wx'})
const origin='https://teder.pendia-community.workers.dev'
const payload={action:'register',username,password,code:recovery,recoveryConfirmation:recovery,saved:true,operatorInvite:token}
const output=execFileSync('curl',['-sS','-w','\n%{http_code}',origin+'/api/teder','-H','Content-Type: application/json','-H','Origin: '+origin,'--data-binary','@-'],{input:JSON.stringify(payload),encoding:'utf8',stdio:['pipe','pipe','pipe']})
if(!output.endsWith('201')) throw new Error('Operator registration failed. The recovery file is private; inspect account metadata before retrying.')
const row=execute(`SELECT u.username,c.workspace_kind,EXISTS(SELECT 1 FROM bunker_operators o WHERE o.user_id=u.id AND o.revoked_at IS NULL) AS active_operator FROM users u JOIN companies c ON c.id=u.company_id WHERE u.username='${username}'`)[0].results[0]
if(row?.workspace_kind!=='operations'||row.active_operator!==1) throw new Error('Operator registration requires investigation.')
console.log('Dedicated operator created using the production Worker password hasher. Recovery saved privately. No customer permissions changed.')
