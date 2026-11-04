import { describe, expect, test } from 'bun:test'

import type {
  SessionConfigOption,
  SessionModeState,
  SessionModelState
} from '@agentclientprotocol/sdk'

import { buildControls } from '@/app/ai/agents/acp/catalog'

const models: SessionModelState = {
  currentModelId: 'codex[low]',
  availableModels: [
    { modelId: 'codex[low]', name: 'Codex (low)' },
    { modelId: 'codex[high]', name: 'Codex (high)' }
  ]
}

const modes: SessionModeState = {
  currentModeId: 'agent',
  availableModes: [
    { id: 'agent', name: 'Agent' },
    { id: 'plan', name: 'Plan' }
  ]
}

function configOptions(name: string): SessionConfigOption[] {
  return [
    {
      id: 'theme',
      name,
      type: 'select',
      category: 'other',
      currentValue: 'dark',
      options: [
        { value: 'dark', name: 'Dark' },
        { value: 'light', name: 'Light' }
      ]
    }
  ]
}

describe('ACP session controls', () => {
  test('keeps model and mode controls when configuration options refresh', () => {
    const controls = buildControls({ configOptions: configOptions('Theme'), models, modes })
    const refreshed = buildControls({ configOptions: configOptions('Appearance'), models, modes })

    expect(controls.map((control) => control.category)).toEqual([
      'other',
      'model',
      'thought_level',
      'mode'
    ])
    expect(refreshed.map((control) => control.category)).toEqual([
      'other',
      'model',
      'thought_level',
      'mode'
    ])
  })
})
