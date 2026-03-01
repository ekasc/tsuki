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

function assertHasRateLimitBinding(ratelimits, bindingName, label, failures) {
  const found = ratelimits.some((entry) => entry?.name === bindingName)
  if (!found) {
    failures.push(`${label}: missing ratelimit binding "${bindingName}"`)
  }
}

function assertHasAnalyticsBinding(datasets, bindingName, label, failures) {
  const found = datasets.some((entry) => entry?.binding === bindingName)
  if (!found) {
    failures.push(`${label}: missing analytics binding "${bindingName}"`)
  }
}

async function main() {
  const failures = []

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const wrangler = parseJsonc(await readFile('wrangler.jsonc', 'utf8'))

  const wranglerVars = wrangler?.vars ?? {}
  const wranglerTestVars = wrangler?.env?.test?.vars ?? {}
  const wranglerRateLimits = wrangler?.ratelimits ?? []
  const wranglerAnalyticsDatasets = wrangler?.analytics_engine_datasets ?? []
  const wranglerTestRateLimits = wrangler?.env?.test?.ratelimits ?? []
  const wranglerTestAnalyticsDatasets =
    wrangler?.env?.test?.analytics_engine_datasets ?? []

  if (wranglerVars.TSUKI_LOCAL_LIBRARY_DRIVER !== 'disabled') {
    failures.push(
      'wrangler.jsonc vars.TSUKI_LOCAL_LIBRARY_DRIVER must be "disabled" for v1 online release',
    )
  }

  if (wranglerVars.TSUKI_LOCAL_LIBRARY_ENABLED !== '0') {
    failures.push(
      'wrangler.jsonc vars.TSUKI_LOCAL_LIBRARY_ENABLED must be "0" for v1 online release',
    )
  }

  if (wranglerTestVars.TSUKI_LOCAL_LIBRARY_DRIVER !== 'fixtures') {
    failures.push(
      'wrangler.jsonc env.test.vars.TSUKI_LOCAL_LIBRARY_DRIVER must be "fixtures"',
    )
  }

  if (wranglerTestVars.TSUKI_TEST_FIXTURES !== '1') {
    failures.push(
      'wrangler.jsonc env.test.vars.TSUKI_TEST_FIXTURES must be "1"',
    )
  }

  if (wrangler?.main !== '@tanstack/react-start/server-entry') {
    failures.push(
      'wrangler.jsonc main must be "@tanstack/react-start/server-entry"',
    )
  }

  const requiredRateLimitBindings = [
    'TSUKI_RL_SCRAPE',
    'TSUKI_RL_SCRAPE_PREFETCH',
    'TSUKI_RL_SCRAPE_FORCE',
    'TSUKI_RL_IMAGE',
    'TSUKI_RL_IMAGE_PREFETCH',
  ]

  for (const bindingName of requiredRateLimitBindings) {
    assertHasRateLimitBinding(
      wranglerRateLimits,
      bindingName,
      'wrangler.jsonc ratelimits',
      failures,
    )
    assertHasRateLimitBinding(
      wranglerTestRateLimits,
      bindingName,
      'wrangler.jsonc env.test.ratelimits',
      failures,
    )
  }

  assertHasAnalyticsBinding(
    wranglerAnalyticsDatasets,
    'TSUKI_ANALYTICS',
    'wrangler.jsonc analytics_engine_datasets',
    failures,
  )
  assertHasAnalyticsBinding(
    wranglerTestAnalyticsDatasets,
    'TSUKI_ANALYTICS',
    'wrangler.jsonc env.test.analytics_engine_datasets',
    failures,
  )

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
    cloudflareDryDeployScript,
    '--env=""',
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
  assertIncludes(
    cloudflareDeployScript,
    '--env=""',
    'package.json scripts.deploy:cloudflare',
    failures,
  )

  if (cloudflareDeployScript.includes('TSUKI_TEST_FIXTURES=')) {
    failures.push(
      'package.json scripts.deploy:cloudflare must not include TSUKI_TEST_FIXTURES',
    )
  }

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
