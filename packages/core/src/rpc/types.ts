import type { SceneGraph } from '@open-designer/scene-graph'

export interface RPCCommand<A = unknown, R = unknown> {
  name: string
  execute: (graph: SceneGraph, args: A) => R | Promise<R>
}
