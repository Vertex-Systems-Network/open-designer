import { access, chmod, mkdir } from 'node:fs/promises'

import { applyLegacyMcpEnvironment } from '../env'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Platform-specific paths for the MCP server's Unix domain socket
 * and the discovery JSON file.
 *
 * Socket directory layout (overridable via OPENDESIGNER_MCP_SOCKET):
 *   macOS:   ~/Library/Application Support/OpenDesigner/
 *   Linux:   $XDG_RUNTIME_DIR/opendesigner/  (fallback: ~/.opendesigner/)
 *   Windows: %LOCALAPPDATA%\OpenDesigner\  (fallback: ~\AppData\Local\OpenDesigner\)
 *
 * On Windows, Unix domain sockets are unavailable — the server uses TCP only.
 *
 * Discovery file: at the platform-default path above, UNLESS
 * OPENDESIGNER_MCP_DISCOVERY_PATH is set (see getDiscoveryPath()). The socket
 * override (OPENDESIGNER_MCP_SOCKET) never moves the discovery file — it is
 * recorded in the discovery file's `socketPath` field so clients read it
 * from the well-known location.
 * Socket file:     <socketDir>/mcp.sock  (or the override path)
 *
 * IMPORTANT: getSocketDir() returns the directory that contains the socket
 * file. It does NOT always contain the discovery file — when
 * OPENDESIGNER_MCP_SOCKET is set, the discovery file stays at getPlatformDir().
 */

const DIR_NAME_UNIX = 'opendesigner'
const DIR_NAME_MACOS = 'OpenDesigner'
const LEGACY_DIR_NAME_UNIX = 'openpencil'
const LEGACY_DIR_NAME_MACOS = 'OpenPencil'
const SOCKET_FILENAME = 'mcp.sock'
const DISCOVERY_FILENAME = 'mcp.json'

const isMacOS = platform() === 'darwin'
const isWindows = platform() === 'win32'

/**
 * Returns the platform-specific default directory for MCP runtime files,
 * ignoring OPENDESIGNER_MCP_SOCKET. The discovery file always lives here so
 * clients can find it at a well-known location regardless of socket overrides.
 * Creates the directory (with restrictive permissions) if it does not exist.
 *
 * The 0o700 mode restricts permissions on Unix. On Windows, mkdir ignores
 * the mode and uses default ACLs — directory access is controlled by the
 * filesystem, not the permission bits.
 */
async function getPlatformDir(): Promise<string> {
  applyLegacyMcpEnvironment()
  let dir: string
  let legacyDir: string

  if (isMacOS) {
    dir = join(homedir(), 'Library', 'Application Support', DIR_NAME_MACOS)
    legacyDir = join(homedir(), 'Library', 'Application Support', LEGACY_DIR_NAME_MACOS)
  } else if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    if (localAppData) {
      dir = join(localAppData, DIR_NAME_MACOS)
      legacyDir = join(localAppData, LEGACY_DIR_NAME_MACOS)
    } else {
      dir = join(homedir(), 'AppData', 'Local', DIR_NAME_MACOS)
      legacyDir = join(homedir(), 'AppData', 'Local', LEGACY_DIR_NAME_MACOS)
    }
  } else {
    // Linux / other Unix
    const xdgRuntime = process.env.XDG_RUNTIME_DIR?.trim()
    if (xdgRuntime) {
      dir = join(xdgRuntime, DIR_NAME_UNIX)
      legacyDir = join(homedir(), `.${LEGACY_DIR_NAME_UNIX}`)
    } else {
      dir = join(homedir(), `.${DIR_NAME_UNIX}`)
      legacyDir = join(homedir(), '.open-pencil')
    }
  }

  try {
    await access(legacyDir)
    dir = legacyDir
  } catch {
    // A clean install uses the new directory; upgrades keep using the existing one.
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  if (!isWindows) await chmod(dir, 0o700)
  return dir
}

/**
 * Returns the directory for the MCP socket file.
 *
 * When OPENDESIGNER_MCP_SOCKET is set, its dirname is used as the socket
 * directory. When unset, the platform default from getPlatformDir() is used.
 * Creates the directory (with restrictive permissions) if it does not exist.
 *
 * NOTE: The discovery file always lives at getPlatformDir(), regardless of
 * OPENDESIGNER_MCP_SOCKET. This function should NOT be used to locate it.
 */
export async function getSocketDir(): Promise<string> {
  applyLegacyMcpEnvironment()
  const socketOverride = process.env.OPENDESIGNER_MCP_SOCKET?.trim()

  if (socketOverride) {
    const dir = dirname(socketOverride)
    // Create missing parents with restrictive permissions. Do NOT chmod
    // existing directories — the override path is user-controlled and
    // may be in a shared directory (e.g. /tmp for tests).
    await mkdir(dir, { recursive: true, mode: 0o700 })
    return dir
  }

  return getPlatformDir()
}

/**
 * Returns the full path to the MCP Unix domain socket.
 *
 * On macOS/Linux: <socketDir>/mcp.sock
 *
 * When OPENDESIGNER_MCP_SOCKET is set, its value is returned directly
 * (no directory resolution needed).
 */
export async function getSocketPath(): Promise<string> {
  applyLegacyMcpEnvironment()
  const socketOverride = process.env.OPENDESIGNER_MCP_SOCKET?.trim()
  if (socketOverride) {
    // Ensure the override directory exists. getSocketDir() creates the
    // directory for the custom socket path (dirname of the override).
    await getSocketDir()
    return socketOverride
  }

  const dir = await getSocketDir()
  return join(dir, SOCKET_FILENAME)
}

/**
 * Returns the full path to the MCP discovery JSON file.
 *
 * The discovery file lives at the platform-default location so clients can
 * find it without knowing whether OPENDESIGNER_MCP_SOCKET is set. It contains
 * the actual socket path (which may be overridden) in its `socketPath` field,
 * so clients read the discovery file to learn where to connect — not the other
 * way around.
 *
 * Set OPENDESIGNER_MCP_DISCOVERY_PATH to relocate the discovery file (e.g. to a
 * temp directory for test isolation). The desktop app reads the platform
 * default via its own path computation (src/app/automation/mcp/spawn.ts) and
 * does not honor this override, so it is primarily useful for tests and
 * standalone server invocations. The parent directory is created (0o700) so
 * writeDiscoveryFile's atomic temp-then-rename succeeds.
 */
export async function getDiscoveryPath(): Promise<string> {
  applyLegacyMcpEnvironment()
  const override = process.env.OPENDESIGNER_MCP_DISCOVERY_PATH?.trim()
  if (override) {
    const dir = dirname(override)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    return override
  }
  const dir = await getPlatformDir()
  return join(dir, DISCOVERY_FILENAME)
}

/**
 * Returns true if the current platform supports Unix domain sockets.
 * Unix domain sockets are available on macOS, Linux, and other POSIX
 * platforms but not on native Windows. WSL is detected as Linux.
 */
export function platformHasUnixSockets(): boolean {
  return !isWindows
}

/**
 * Returns the platform name for display purposes.
 */
export function platformName(): 'macos' | 'linux' | 'windows' | 'other' {
  if (isMacOS) return 'macos'
  if (isWindows) return 'windows'
  if (platform() === 'linux') return 'linux'
  return 'other'
}
