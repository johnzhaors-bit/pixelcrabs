import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { PreviewDeliveryRegistry, createPreviewDeliveryAction, assertPreviewDeliveryScope } from '../src/preview-delivery-protocol.ts'
import { registerWebPreviewCapabilities, webPreviewCapabilitySnapshot, WEB_PREVIEW_ADAPTER_IDS } from '../src/web-preview-capabilities.ts'

test('Web registration exposes descriptors without platform drivers or delivery executors', () => {
  const registry = registerWebPreviewCapabilities()
  assert.deepEqual(registry.list().map(owner => owner.id), ['web'])
  for (const adapter of WEB_PREVIEW_ADAPTER_IDS) {
    const snapshot = webPreviewCapabilitySnapshot(adapter)
    assert.equal(snapshot.version, 1)
    assert.equal(snapshot.owners[0].id, 'web')
    assert.equal(snapshot.routes.length, 7)
    assert.ok(snapshot.routes.every(route => !route.capability.id.startsWith('delivery.')))
  }
  assert.deepEqual(webPreviewCapabilitySnapshot('unknown'), { version: 1, owners: [], routes: [] })
})

test('registration and snapshots cannot mutate stored descriptors', () => {
  const registry = new PreviewDeliveryRegistry()
  const owner = { id: 'example', label: 'Example', kind: 'framework_adapter', projectKinds: ['web'], capabilities: [
    { id: 'development.inspect', risk: 'read', resultKind: 'inspection', runtimeImpact: 'none', targets: ['web'] },
  ] }
  registry.register(owner)
  owner.projectKinds.push('changed')
  owner.capabilities[0].targets.push('changed')
  registry.get('example').capabilities[0].targets.push('changed-again')
  assert.deepEqual(registry.get('example').projectKinds, ['web'])
  assert.deepEqual(registry.get('example').capabilities[0].targets, ['web'])
  assert.throws(() => registry.register(owner), /already registered/)
  assert.throws(() => registry.routes(['missing']), /Unknown/)
  assert.equal(registry.routes(['example'], 'development.start').length, 0)
  assert.throws(() => new PreviewDeliveryRegistry().register({ ...owner, capabilities: [owner.capabilities[0], owner.capabilities[0]] }), /Duplicate capability/)
})

test('actions are scoped to their conversation, project and resolved directory', () => {
  const scope = { conversationId: 'conversation-1', projectId: 'project-1', projectDirectory: path.resolve('example') }
  const input = { selectedElement: 'button' }
  const action = createPreviewDeliveryAction({ ...scope, ownerId: 'web', action: 'inspect', input })
  assert.equal(action.input, input)
  assert.ok(action.requestId)
  assertPreviewDeliveryScope(action, scope)
  for (const change of [{ conversationId: 'another' }, { projectId: 'another' }, { projectDirectory: path.resolve('another') }]) {
    assert.throws(() => assertPreviewDeliveryScope(action, { ...scope, ...change }), /does not belong/)
  }
  assert.throws(() => createPreviewDeliveryAction({ ...scope, ownerId: '', action: 'inspect', input }), /must not be empty/)
})
