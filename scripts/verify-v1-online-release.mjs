import { readFile } from 'node:fs/promises'
import process from 'node:process'

function parseJsonc(content) {
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLineComments = withoutBlockComments.replace(
    /^\s*\/\/.*$/gm,
    '',
  )
  const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(withoutTrailingCommas)
}

function assertIncludes(list, value, label, failures) {
  if (!list.includes(value)) {
    failures.push(`${label}: expected to include "${value}"`)
  }
}

async function main() {
  const failures = []

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const wrangler = parseJsonc(await readFile('wrangler.jsonc', 'utf8'))

  const wranglerVars = wrangler?.vars ?? {}
  if (wranglerVars.TSUKI_LOCAL_LIBRARY_ENABLED !== '0') {
    failures.push(
      'wrangler.jsonc vars.TSUKI_LOCAL_LIBRARY_ENABLED must be "0" for v1 online release',
    )
  }

  if (wrangler?.main !== '@tanstack/react-start/server-entry') {
    failures.push(
      'wrangler.jsonc main must be "@tanstack/react-start/server-entry"',
    )
  }

  const scripts = packageJson?.scripts ?? {}
  const cloudflareBuildScript = scripts['build:cloudflare'] ?? ''
  const cloudflareDryDeployScript = scripts['deploy:cloudflare:dry'] ?? ''
  const cloudflareDeployScript = scripts['deploy:cloudflare'] ?? ''

  assertIncludes(
    cloudflareBuildScript,
    'VITE_LOCAL_LIBRARY_ENABLED=0',
    'package.json scripts.build:cloudflare',
    failures,
  )
  assertIncludes(
    cloudflareDryDeployScript,
    'VITE_LOCAL_LIBRARY_ENABLED=0',
    'package.json scripts.deploy:cloudflare:dry',
    failures,
  )
  assertIncludes(
    cloudflareDryDeployScript,
    'wrangler@4.69.0',
    'package.json scripts.deploy:cloudflare:dry',
    failures,
  )
  assertIncludes(
    cloudflareDryDeployScript,
    'deploy --dry-run --config dist/server/wrangler.json',
    'package.json scripts.deploy:cloudflare:dry',
    failures,
  )
  assertIncludes(
    cloudflareDryDeployScript,
    '--config dist/server/wrangler.json',
    'package.json scripts.deploy:cloudflare:dry',
    failures,
  )
  assertIncludes(
    cloudflareDeployScript,
    'VITE_LOCAL_LIBRARY_ENABLED=0',
    'package.json scripts.deploy:cloudflare',
    failures,
  )
  assertIncludes(
    cloudflareDeployScript,
    'wrangler@4.69.0',
    'package.json scripts.deploy:cloudflare',
    failures,
  )
  assertIncludes(
    cloudflareDeployScript,
    'deploy --config dist/server/wrangler.json',
    'package.json scripts.deploy:cloudflare',
    failures,
  )
  assertIncludes(
    cloudflareDeployScript,
    '--config dist/server/wrangler.json',
    'package.json scripts.deploy:cloudflare',
    failures,
  )

  if (failures.length > 0) {
    console.error('v1 online release verification failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('v1 online release verification passed')
}

void main()
