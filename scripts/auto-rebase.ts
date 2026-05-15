import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', env: { ...process.env, GIT_EDITOR: 'true' } })
  } catch (e: any) {
    return (e.stdout || '') + (e.stderr || '')
  }
}

function getConflictedFiles(): string[] {
  const out = run('git diff --name-only --diff-filter=U')
  return out.trim().split('\n').filter(Boolean)
}

function resolveConflictMarkers(content: string): string {
  if (!content.includes('<<<<<<<')) return content
  const lines = content.split('\n')
  const result: string[] = []
  let state: 'normal' | 'ours' | 'theirs' = 'normal'
  let oursLines: string[] = []
  let theirsLines: string[] = []
  
  for (const line of lines) {
    if (line.startsWith('<<<<<<<')) {
      state = 'ours'
      oursLines = []
      theirsLines = []
    } else if (line === '=======') {
      state = 'theirs'
    } else if (line.startsWith('>>>>>>>')) {
      state = 'normal'
      result.push(...oursLines, ...theirsLines)
    } else if (state === 'ours') {
      oursLines.push(line)
    } else if (state === 'theirs') {
      theirsLines.push(line)
    } else {
      result.push(line)
    }
  }
  return result.join('\n')
}

function resolveConflicts(): boolean {
  const files = getConflictedFiles()
  if (files.length === 0) return true
  console.log(`  Conflicted files: ${files.join(', ')}`)
  
  for (const file of files) {
    if (file === 'bun.lock') {
      run(`git checkout --theirs "${file}"`)
    } else {
      try {
        const content = readFileSync(file, 'utf-8')
        const resolved = resolveConflictMarkers(content)
        writeFileSync(file, resolved, 'utf-8')
      } catch {
        run(`git checkout --theirs "${file}"`)
      }
    }
    run(`git add "${file}"`)
  }
  return true
}

console.log('Starting automated rebase...\n')

let conflictCount = 0
let iterations = 0
const maxIterations = 300

// Start the rebase
let output = run('git rebase origin/main')
console.log(output.substring(0, 500))

while (iterations++ < maxIterations) {
  const status = run('git status')
  
  if (!status.includes('rebasing') && !status.includes('rebase')) {
    console.log('\nRebase completed!')
    break
  }
  
  const conflicted = getConflictedFiles()
  if (conflicted.length > 0) {
    conflictCount++
    const commitMatch = status.match(/Could not apply (\w+)/)
    const commitInfo = commitMatch ? commitMatch[1] : 'unknown'
    console.log(`\n[${iterations}] Conflict #${conflictCount} (${commitInfo}): ${conflicted.join(', ')}`)
    
    // Handle delete/modify conflicts
    for (const file of conflicted) {
      const diffOutput = run(`git diff --diff-filter=D -- "${file}"`)
      if (diffOutput.includes('deleted in')) {
        // If file was deleted in the commit being applied, accept the deletion
        run(`git rm "${file}" 2>/dev/null || git checkout --theirs "${file}" && git add "${file}"`)
      }
    }
    
    resolveConflicts()
  }
  
  output = run('git rebase --continue')
  if (output.includes('successfully rebased')) {
    console.log('\nRebase completed successfully!')
    break
  }
  if (output.includes('CONFLICT') || output.includes('could not apply')) {
    continue
  }
  if (output.includes('fatal') || output.includes('error: failed')) {
    console.error('Fatal error:', output)
    break
  }
  console.log(output.substring(0, 300))
}

console.log(`\nTotal conflicts resolved: ${conflictCount}`)
