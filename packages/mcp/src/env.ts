/** Keep existing MCP launch configurations working through the product rename. */
export function applyLegacyMCPEnvironment(): void {
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('OPENPENCIL_MCP_') || value === undefined) continue
    const currentName = `OPENDESIGNER_${name.slice('OPENPENCIL_'.length)}`
    if (process.env[currentName] === undefined) process.env[currentName] = value
  }
}
