import { releaseVersion } from './context.ts'

export const desktopBuilds = [
  {
    target: 'aarch64-apple-darwin',
    platform: 'macos-latest',
    label: 'macos-arm64',
    saveBunCache: true
  },
  {
    target: 'x86_64-apple-darwin',
    platform: 'macos-latest',
    label: 'macos-x64',
    saveBunCache: false
  },
  {
    target: 'x86_64-pc-windows-msvc',
    platform: 'windows-latest',
    label: 'windows-x64',
    saveBunCache: true
  },
  {
    target: 'aarch64-pc-windows-msvc',
    platform: 'windows-latest',
    label: 'windows-arm64',
    saveBunCache: false
  },
  {
    target: 'x86_64-unknown-linux-gnu',
    platform: 'ubuntu-22.04',
    label: 'linux-x64',
    saveBunCache: true
  }
] as const

export const desktopTargets = desktopBuilds.map((build) => build.target)

export type DesktopTarget = (typeof desktopTargets)[number]

export interface DesktopAsset {
  source: string
  name: string
  updaterKeys: string[]
  signed: boolean
}

/** Required OpenDesigner release outputs, not a discovery or packaging implementation. */
export function desktopAssets(target: DesktopTarget, version: string): DesktopAsset[] {
  releaseVersion(`v${version}`)

  if (target.endsWith('apple-darwin')) {
    const arch = target.startsWith('aarch64') ? 'aarch64' : 'x64'
    const platform = arch === 'x64' ? 'darwin-x86_64' : 'darwin-aarch64'
    return [
      {
        source: `OpenDesigner_${version}_${arch}.dmg`,
        name: `OpenDesigner_${version}_${arch}.dmg`,
        updaterKeys: [],
        signed: false
      },
      {
        source: 'OpenDesigner.app.tar.gz',
        name: `OpenDesigner_${arch}.app.tar.gz`,
        updaterKeys: [platform, `${platform}-app`],
        signed: true
      }
    ]
  }
  if (target.endsWith('windows-msvc')) {
    const arch = target.startsWith('aarch64') ? 'arm64' : 'x64'
    const platform = target.startsWith('aarch64') ? 'windows-aarch64' : 'windows-x86_64'
    return [
      {
        source: `OpenDesigner_${version}_${arch}-setup.exe`,
        name: `OpenDesigner_${version}_${arch}-setup.exe`,
        updaterKeys: [`${platform}-nsis`],
        signed: true
      },
      {
        source: `OpenDesigner_${version}_${arch}_en-US.msi`,
        name: `OpenDesigner_${version}_${arch}_en-US.msi`,
        updaterKeys: [platform, `${platform}-msi`],
        signed: true
      }
    ]
  }
  return [
    {
      source: `OpenDesigner_${version}_amd64.AppImage`,
      name: `OpenDesigner_${version}_amd64.AppImage`,
      updaterKeys: ['linux-x86_64', 'linux-x86_64-appimage'],
      signed: true
    },
    {
      source: `OpenDesigner_${version}_amd64.deb`,
      name: `OpenDesigner_${version}_amd64.deb`,
      updaterKeys: ['linux-x86_64-deb'],
      signed: true
    },
    {
      source: `OpenDesigner-${version}-1.x86_64.rpm`,
      name: `OpenDesigner-${version}-1.x86_64.rpm`,
      updaterKeys: ['linux-x86_64-rpm'],
      signed: true
    }
  ]
}
