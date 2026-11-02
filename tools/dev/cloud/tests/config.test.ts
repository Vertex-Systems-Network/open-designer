import { describe, expect, test } from 'bun:test'

import { composeProjectName, localCloudDeploymentTOML } from '#cloud-dev/config'

import { parseCloudDeploymentTOML } from '@open-designer/cloud/server'

const secrets = {
  DATABASE_URL: 'postgresql://openpencil:password@127.0.0.1:54329/opendesigner',
  BETTER_AUTH_SECRET: 'local-development-secret-at-least-32-characters',
  S3_ACCESS_KEY_ID: 'opendesigner',
  S3_SECRET_ACCESS_KEY: 'opendesigner-development-secret'
}

describe('local Cloud development configuration', () => {
  test('points branch URLs at the Compose services published on loopback', () => {
    const config = parseCloudDeploymentTOML(
      localCloudDeploymentTOML({
        cloudURL: 'https://feature.cloud.open-designer.localhost',
        editorURL: 'https://feature.open-designer.localhost',
        objectStorageURL: 'http://127.0.0.1:41000',
        smtpPort: 41025
      }),
      secrets
    )

    expect(config).toMatchObject({
      deployment: 'self-hosted',
      publicURL: 'https://feature.cloud.open-designer.localhost',
      trustedOrigins: [
        'https://feature.open-designer.localhost',
        'https://feature.cloud.open-designer.localhost'
      ],
      emailPasswordEnabled: true,
      emailPasswordSignUpEnabled: true,
      passkeysEnabled: true,
      s3Endpoint: 'http://127.0.0.1:41000',
      emailTransport: 'smtp',
      smtpHost: '127.0.0.1',
      smtpPort: 41025,
      smtpSecure: false
    })
  })

  test('derives a Compose project name from the branch', () => {
    expect(composeProjectName('feature/cloud auth')).toBe('opendesigner-cloud-feature-cloud-auth')
    expect(composeProjectName('')).toBe('opendesigner-cloud-development')
  })
})
