import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPackageMetadata,
  assertPublicContainerWorkflowContract,
  assertReleaseWorkflowExecutionContract,
  assertReleaseWorkflowStateContract,
  assertWorkflowValidationContract,
  parsePrePushInput,
  parseWorkflowDocument,
  prePushBranchUpdates,
} from '../tools/release-preflight.mjs'
import {
  parseSmokeOptions,
  sanitizeContainerName,
} from '../tools/smoke-container-image.mjs'

function resolvePublicWorkflow(name) {
  const sourceTemplate = resolve('.public', name)
  return existsSync(sourceTemplate)
    ? sourceTemplate
    : resolve('.github', 'workflows', name)
}

function readWorkflowFixture(workflowPath) {
  return readFileSync(workflowPath, 'utf8').replace(/\r\n?/g, '\n')
}

function replaceRequired(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Release-contract fault injection did not match: ${search}`)
  }
  return source.replace(search, replacement)
}

describe('release preflight contracts', () => {
  const packageJson = { name: 'phd-atlas', version: '0.1.0-beta.5' }
  const lockJson = {
    name: 'phd-atlas',
    version: '0.1.0-beta.5',
    packages: { '': { name: 'phd-atlas', version: '0.1.0-beta.5' } },
  }

  it('requires package and lock metadata to agree exactly', () => {
    expect(assertPackageMetadata(packageJson, lockJson)).toEqual(packageJson)
    expect(() => assertPackageMetadata(packageJson, {
      ...lockJson,
      packages: { '': { name: 'phd-atlas', version: '0.1.0-beta.4' } },
    })).toThrow(/Version mismatch/)
    expect(() => assertPackageMetadata(packageJson, {
      ...lockJson,
      name: 'phd-atlas-source',
    })).toThrow(/Package-name mismatch/)
  })

  it('parses workflow YAML and rejects workflows without jobs', () => {
    expect(parseWorkflowDocument('name: CI\njobs:\n  verify:\n    runs-on: ubuntu-latest\n', 'ci.yml').jobs)
      .toHaveProperty('verify')
    expect(() => parseWorkflowDocument('name: [\n', 'broken.yml')).toThrow(/invalid YAML/)
    expect(() => parseWorkflowDocument('name: CI\n', 'empty.yml')).toThrow(/jobs mapping/)
  })

  it('requires every validation workflow to use the shared forced build-mode gate', () => {
    const valid = [
      'name: CI',
      'jobs:',
      '  verify:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npm run verify:tree',
      '',
    ].join('\n')
    expect(() => assertWorkflowValidationContract(valid, 'ci.yml')).not.toThrow()
    expect(() => assertWorkflowValidationContract(
      valid.replace('npm run verify:tree', 'npx tsc --noEmit'),
      'ci.yml',
    )).toThrow(/weaker tsc --noEmit/)
  })

  it('pins Draft Release operations to the numeric Release ID', () => {
    const valid = [
      'echo "RELEASE_ID=$release_id"',
      'gh api "repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}"',
      'gh api "repos/${GITHUB_REPOSITORY}/releases/assets/${asset_id}"',
      "'{tag_name: $tag, target_commitish: $target, draft: true}'",
      "'{tag_name: $tag, target_commitish: $target, draft: false}'",
    ].join('\n')
    expect(() => assertReleaseWorkflowStateContract(valid)).not.toThrow()
    expect(() => assertReleaseWorkflowStateContract(
      `${valid}\ngh release view "$GITHUB_REF_NAME"`,
    )).toThrow(/Draft Release by tag/)
    expect(() => assertReleaseWorkflowStateContract(
      valid.replace("'{tag_name: $tag, target_commitish: $target, draft: false}'", ''),
    )).toThrow(/both Draft and publication PATCH payloads/)
  })

  it('makes public main container publication consume the matching CI result once', () => {
    const workflowPath = resolvePublicWorkflow('publish-container.yml')
    const workflow = readWorkflowFixture(workflowPath)
    expect(() => assertPublicContainerWorkflowContract(workflow, workflowPath)).not.toThrow()
    expect(() => assertPublicContainerWorkflowContract(
      replaceRequired(workflow, '--commit "$GITHUB_SHA"', '--branch main'),
      workflowPath,
    )).toThrow(/matching-CI contract/)
    expect(() => assertPublicContainerWorkflowContract(
      replaceRequired(
        workflow,
        '      - name: Define candidate and immutable SHA tags',
        '      - name: Repeat full tree gate\n        run: npm run verify:tree\n\n      - name: Define candidate and immutable SHA tags',
      ),
      workflowPath,
    )).toThrow(/instead of repeating the full tree gate/)
  })

  it('keeps MSSQL and Release publication on one runner and installs once', () => {
    const workflowPath = resolvePublicWorkflow('release.yml')
    const workflow = readWorkflowFixture(workflowPath)
    expect(() => assertReleaseWorkflowExecutionContract(workflow, workflowPath)).not.toThrow()
    expect(() => assertReleaseWorkflowExecutionContract(
      replaceRequired(
        workflow,
        'jobs:\n  release:',
        'jobs:\n  mssql-release-gate:\n    runs-on: ubuntu-latest\n    steps: []\n\n  release:',
      ),
      workflowPath,
    )).toThrow(/cannot wait for a second runner/)
    expect(() => assertReleaseWorkflowExecutionContract(
      replaceRequired(
        workflow,
        '      - name: Verify source\n        run: npm run verify:tree',
        '      - name: Verify source\n        run: |\n          npm ci\n          npm run verify:tree',
      ),
      workflowPath,
    )).toThrow(/install dependencies exactly once/)
  })

  it('blocks manual version-tag pushes before immutable tags can be created early', () => {
    expect(() => parsePrePushInput(
      `refs/tags/v0.1.0-beta.6 ${'a'.repeat(40)} refs/tags/v0.1.0-beta.6 ${'0'.repeat(40)}\n`,
    )).toThrow(/Refusing manual release-tag push/)
    expect(() => parsePrePushInput(
      `HEAD ${'a'.repeat(40)} refs/tags/v0.1.0-beta.6 ${'0'.repeat(40)}\n`,
    )).toThrow(/Refusing manual release-tag push/)
  })

  it('classifies a pushed branch by its remote ref even when the local ref is HEAD', () => {
    const updates = parsePrePushInput(
      `HEAD ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}\n`,
    )

    expect(prePushBranchUpdates(updates)).toEqual(updates)
  })
})

describe('container smoke options', () => {
  it('pins the isolated smoke topology to one trusted forwarding hop', () => {
    const source = readFileSync(
      resolve('tools', 'smoke-container-image.mjs'),
      'utf8',
    )
    expect(source).toContain("'TRUST_PROXY=1'")
    expect(source).not.toContain("'TRUST_PROXY=true'")
  })

  it('defaults to both release architectures and registry pulls', () => {
    expect(parseSmokeOptions(['ghcr.io/example/app:beta'], {})).toEqual({
      imageRef: 'ghcr.io/example/app:beta',
      imageLabel: 'published',
      architectures: ['amd64', 'arm64'],
      pullPolicy: 'always',
    })
  })

  it('supports one local architecture without pulling and validates inputs', () => {
    expect(parseSmokeOptions([
      'phd-atlas-preflight:test',
      'local',
      '--architectures',
      'arm64',
      '--pull',
      'never',
    ], {})).toMatchObject({ architectures: ['arm64'], pullPolicy: 'never' })
    expect(() => parseSmokeOptions(
      ['image', '--architectures', '386'],
      {},
    )).toThrow(/amd64,arm64/)
  })

  it('creates Docker-safe bounded container names', () => {
    const name = sanitizeContainerName(`PhD Atlas/Release_${'x'.repeat(200)}`)
    expect(name).toMatch(/^[a-z0-9][a-z0-9_.-]*$/)
    expect(name.length).toBeLessThanOrEqual(120)
  })
})
