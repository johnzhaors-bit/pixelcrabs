import { randomUUID } from "node:crypto"
import path from "node:path"

export type PreviewDeliveryOwnerKind = "framework_adapter" | "platform_driver"

export type PreviewDeliveryCapabilityId =
  | "development.inspect"
  | "development.prepare"
  | "development.start"
  | "development.refresh"
  | "development.restart"
  | "development.verify"
  | "validation.internal_preview"
  | "validation.external_preview"
  | "validation.device_preview"
  | "validation.qr_preview"
  | "delivery.local_build"
  | "delivery.upload"
  | "delivery.deploy"
  | "delivery.submit_review"
  | "delivery.publish"

export type PreviewDeliveryCapability = {
  id: PreviewDeliveryCapabilityId
  risk: "read" | "process" | "network" | "account_write" | "production"
  permission?: string
  resultKind: string
  /** Platform validation and delivery must not mutate the active development runtime. */
  runtimeImpact: "none" | "refresh_owner" | "restart_owner"
  /** Optional target scope owned by this module, such as mini-app platform IDs. */
  targets?: readonly string[]
}

export type PreviewDeliveryOwnerDescriptor = {
  id: string
  label: string
  kind: PreviewDeliveryOwnerKind
  projectKinds: readonly string[]
  capabilities: readonly PreviewDeliveryCapability[]
}

export type PreviewDeliveryActionEnvelope<TAction extends string, TInput> = {
  requestId: string
  conversationId: string
  projectId: string
  projectDirectory: string
  ownerId: string
  action: TAction
  input: TInput
}

export type PreviewDeliveryActionResult<TFacts> = {
  requestId: string
  ownerId: string
  action: string
  status: "ready" | "running" | "succeeded" | "missing" | "blocked" | "failed" | "cancelled"
  missingCapabilities: string[]
  message: string
  facts?: TFacts
}

export type PreviewDeliveryScope = {
  conversationId: string
  projectId: string
  projectDirectory: string
}

export type PreviewDeliveryCapabilityRoute = {
  ownerId: string
  ownerKind: PreviewDeliveryOwnerKind
  capability: PreviewDeliveryCapability
}

function requireText(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} must not be empty`)
  return value
}

function cloneCapability(value: PreviewDeliveryCapability): PreviewDeliveryCapability {
  return { ...value, ...(value.targets ? { targets: [...value.targets] } : {}) }
}

function cloneOwner(value: PreviewDeliveryOwnerDescriptor): PreviewDeliveryOwnerDescriptor {
  return {
    ...value,
    projectKinds: [...value.projectKinds],
    capabilities: value.capabilities.map(cloneCapability),
  }
}

export function createPreviewDeliveryAction<TAction extends string, TInput>(input: {
  conversationId: string
  projectId: string
  projectDirectory: string
  ownerId: string
  action: TAction
  input: TInput
  requestId?: string
}): PreviewDeliveryActionEnvelope<TAction, TInput> {
  return {
    requestId: input.requestId ?? randomUUID(),
    conversationId: requireText(input.conversationId, "conversationId"),
    projectId: requireText(input.projectId, "projectId"),
    projectDirectory: path.resolve(requireText(input.projectDirectory, "projectDirectory")),
    ownerId: requireText(input.ownerId, "ownerId"),
    action: requireText(input.action, "action") as TAction,
    // The core deliberately preserves the owner's private input without inspecting or merging it.
    input: input.input,
  }
}

export function assertPreviewDeliveryScope(
  action: PreviewDeliveryActionEnvelope<string, unknown>,
  expected: PreviewDeliveryScope,
) {
  if (
    action.conversationId !== expected.conversationId ||
    action.projectId !== expected.projectId ||
    path.resolve(action.projectDirectory) !== path.resolve(expected.projectDirectory)
  )
    throw new Error("Preview/Delivery action does not belong to the active conversation and project")
}

export class PreviewDeliveryRegistry {
  readonly #owners = new Map<string, PreviewDeliveryOwnerDescriptor>()

  register(descriptor: PreviewDeliveryOwnerDescriptor) {
    requireText(descriptor.id, "owner.id")
    if (this.#owners.has(descriptor.id)) throw new Error(`Preview/Delivery owner already registered: ${descriptor.id}`)
    const capabilityIds = new Set<PreviewDeliveryCapabilityId>()
    for (const capability of descriptor.capabilities) {
      if (capabilityIds.has(capability.id)) throw new Error(`Duplicate capability ${capability.id} in ${descriptor.id}`)
      capabilityIds.add(capability.id)
    }
    this.#owners.set(descriptor.id, cloneOwner(descriptor))
    return this
  }

  get(ownerId: string) {
    const descriptor = this.#owners.get(ownerId)
    return descriptor ? cloneOwner(descriptor) : undefined
  }

  list() {
    return [...this.#owners.values()].map(cloneOwner)
  }

  routes(ownerIds: readonly string[], capabilityId?: PreviewDeliveryCapabilityId) {
    const routes: PreviewDeliveryCapabilityRoute[] = []
    for (const ownerId of ownerIds) {
      const owner = this.#owners.get(ownerId)
      if (!owner) throw new Error(`Unknown Preview/Delivery owner: ${ownerId}`)
      for (const capability of owner.capabilities) {
        if (capabilityId && capability.id !== capabilityId) continue
        routes.push({ ownerId: owner.id, ownerKind: owner.kind, capability: cloneCapability(capability) })
      }
    }
    return routes
  }
}

