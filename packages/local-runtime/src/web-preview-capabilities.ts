import { PreviewDeliveryRegistry, type PreviewDeliveryCapability, type PreviewDeliveryCapabilityId } from "./preview-delivery-protocol.ts"

export const WEB_PREVIEW_ADAPTER_IDS = Object.freeze(["vite", "next", "nuxt", "astro", "web-static"] as const)

const capability = (
  id: PreviewDeliveryCapabilityId,
  risk: PreviewDeliveryCapability["risk"],
  resultKind: string,
  runtimeImpact: PreviewDeliveryCapability["runtimeImpact"],
  permission?: string,
  targets?: readonly string[],
): PreviewDeliveryCapability => ({ id, risk, resultKind, runtimeImpact, permission, targets })

/** Register only implemented Web capabilities; no cloud or platform drivers. */
export function registerWebPreviewCapabilities(registry = new PreviewDeliveryRegistry()) {
  return registry.register({
      id: "web",
      label: "Web Framework Adapter",
      kind: "framework_adapter",
      projectKinds: WEB_PREVIEW_ADAPTER_IDS,
      capabilities: [
        capability("development.inspect", "read", "preview_inspection", "none"),
        capability("development.start", "process", "preview_runtime", "restart_owner"),
        capability("development.refresh", "process", "preview_runtime", "refresh_owner"),
        capability("development.restart", "process", "preview_runtime", "restart_owner"),
        capability("development.verify", "read", "preview_observation", "none"),
        capability("validation.internal_preview", "read", "preview_presentation", "none"),
        capability("validation.external_preview", "process", "external_preview", "none", "external_preview.open"),
      ],
    })
}

export function webPreviewCapabilitySnapshot(adapterId: string) {
  const registry = registerWebPreviewCapabilities()
  const ownerIds = WEB_PREVIEW_ADAPTER_IDS.some((id) => id === adapterId) ? ["web"] : []
  return {
    version: 1 as const,
    owners: ownerIds.map((ownerId) => registry.get(ownerId)!),
    routes: registry.routes(ownerIds),
  }
}
