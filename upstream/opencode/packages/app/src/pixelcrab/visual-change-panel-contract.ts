export type VisualChangePanel = {
  title: string
  description: string
  error: string
  empty: string
  close: string
  select: string
  delete: string
  busy: boolean
  items: { id: string; number: number; label: string; detail: string; description: string; status: string; selected: boolean }[]
  actions: { id: "add" | "apply" | "clear" | "cancel-waiting"; label: string; disabled: boolean }[]
}

export type VisualChangePanelAction = {
  action: "close" | "select" | "delete" | "add" | "apply" | "clear" | "cancel-waiting"
  id?: string
  selected?: boolean
}
