import type { VisualChangePanel } from "../../../app/src/pixelcrab/visual-change-panel-contract"

// Serialized into the existing isolated preview world. No Node/IPC access is
// exposed to project scripts; all content uses textContent, never HTML.
export function renderVisualChangePanel(data: VisualChangePanel | null, actionURL: string) {
  const world = globalThis as typeof globalThis & {
    __pixelcrabCaptureTokens?: Set<string>
    __pixelcrabVisualPanel?: {
      host: HTMLElement; shadow: ShadowRoot; position?: { x: number; y: number }
      dispose: () => void; captures: number
    }
  }
  let panel = world.__pixelcrabVisualPanel
  if (!data) {
    panel?.dispose()
    delete world.__pixelcrabVisualPanel
    return
  }
  if (!panel) {
    const host = document.createElement("div")
    host.setAttribute("data-pixelcrab-visual-panel", "")
    host.style.cssText = "all:initial;position:fixed;right:12px;top:52px;width:280px;max-width:calc(100vw - 24px);z-index:2147483646;pointer-events:auto;color-scheme:light;"
    const shadow = host.attachShadow({ mode: "closed" })
    const clamp = () => {
      const current = world.__pixelcrabVisualPanel
      if (!current) return
      const rect = host.getBoundingClientRect()
      const x = Math.max(12, Math.min(current.position?.x ?? innerWidth - rect.width - 12, innerWidth - rect.width - 12))
      const y = Math.max(12, Math.min(current.position?.y ?? 52, innerHeight - rect.height - 12))
      host.style.left = `${x}px`
      host.style.top = `${y}px`
      host.style.right = "auto"
      if (current.position) current.position = { x, y }
    }
    const observer = new ResizeObserver(clamp)
    observer.observe(host)
    window.addEventListener("resize", clamp)
    panel = { host, shadow, captures: 0, dispose: () => {
      observer.disconnect(); window.removeEventListener("resize", clamp); host.remove()
    } }
    world.__pixelcrabVisualPanel = panel
    document.documentElement.append(host)
  }
  panel.host.style.visibility = world.__pixelcrabCaptureTokens?.size ? "hidden" : "visible"
  const current = panel
  const send = (action: string, id?: string, selected?: boolean) => {
    const url = new URL(actionURL)
    url.searchParams.set("action", action)
    if (id) url.searchParams.set("id", id)
    if (selected !== undefined) url.searchParams.set("selected", String(selected))
    window.open(url.href, "_blank")
  }
  const node = (tag: string, text = "", cls = "") => {
    const element = document.createElement(tag)
    element.textContent = text
    element.className = cls
    return element
  }
  const button = (text: string, action: () => void, disabled = false) => {
    const element = document.createElement("button")
    element.type = "button"; element.textContent = text; element.disabled = disabled
    element.addEventListener("click", action)
    return element
  }
  const style = document.createElement("style")
  style.textContent = `
    :host{font:12px/1.5 system-ui,sans-serif;color:#262626}
    *{box-sizing:border-box} .panel{font:12px/1.5 system-ui,sans-serif;color:#262626;background:#fafafa;border:1px solid #e5e5e5;border-radius:18px;
    box-shadow:0 12px 44px #00000020,0 2px 8px #0000000a;display:flex;flex-direction:column;max-height:calc(100vh - 24px);overflow:hidden}
    header{padding:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:grab;touch-action:none;user-select:none}
    header:active{cursor:grabbing}strong{font-size:13px}p{margin:0 12px 8px;color:#737373;font-size:11px;overflow-wrap:anywhere}
    .items{overflow:auto;min-height:0;padding:0 10px;overscroll-behavior:contain;max-height:320px}
    .item{display:flex;align-items:flex-start;gap:7px;padding:9px 0;border-top:1px solid #e5e5e5}
    .copy{min-width:0;flex:1;overflow-wrap:anywhere;white-space:normal}.detail,.status{font-size:11px;color:#737373;margin-top:4px}
    .number{background:#2563eb;color:white;min-width:19px;height:19px;border-radius:50%;text-align:center;flex-shrink:0}
    input{margin:3px 0;flex-shrink:0}button{font:inherit;color:inherit;background:white;border:1px solid #e5e5e5;border-radius:8px;padding:5px 8px;cursor:pointer;white-space:normal;overflow-wrap:anywhere}
    button:disabled{opacity:.4;cursor:default}button:hover:not(:disabled){background:#eee}header button{border:0;background:transparent;font-size:18px;padding:0 4px}
    footer{padding:10px;display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}footer button:last-child{background:#262626;color:white}.error{color:#b91c1c}
  `
  const root = node("section", "", "panel")
  root.setAttribute("aria-label", data.title)
  const header = node("header")
  header.append(node("strong", data.title))
  const close = button("×", () => send("close"))
  close.setAttribute("aria-label", data.close)
  header.append(close)
  let drag: { x: number; y: number; left: number; top: number } | undefined
  header.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("button") || event.button !== 0) return
    const rect = current.host.getBoundingClientRect()
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    header.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  header.addEventListener("pointermove", (event) => {
    if (!drag) return
    const rect = current.host.getBoundingClientRect()
    const x = Math.max(12, Math.min(drag.left + event.clientX - drag.x, innerWidth - rect.width - 12))
    const y = Math.max(12, Math.min(drag.top + event.clientY - drag.y, innerHeight - rect.height - 12))
    current.position = { x, y }; current.host.style.left = `${x}px`; current.host.style.top = `${y}px`
  })
  const endDrag = () => { drag = undefined }
  header.addEventListener("pointerup", endDrag)
  header.addEventListener("pointercancel", endDrag)
  header.addEventListener("lostpointercapture", endDrag)
  root.append(header, node("p", data.description))
  if (data.error) root.append(node("p", data.error, "error"))
  const list = node("div", "", "items")
  if (!data.items.length) list.append(node("p", data.empty))
  for (const item of data.items) {
    const row = node("div", "", "item")
    const select = document.createElement("input")
    select.type = "checkbox"; select.checked = item.selected; select.disabled = data.busy
    select.setAttribute("aria-label", data.select)
    select.addEventListener("change", () => send("select", item.id, select.checked))
    const copy = node("div", "", "copy")
    copy.append(node("div", item.label), node("div", item.detail, "detail"))
    if (item.description) copy.append(node("div", item.description, "detail"))
    if (item.status) copy.append(node("div", item.status, "status"))
    row.append(select, node("span", String(item.number), "number"), copy, button(data.delete, () => send("delete", item.id), data.busy))
    list.append(row)
  }
  root.append(list)
  const footer = node("footer")
  for (const action of data.actions) footer.append(button(action.label, () => send(action.id), action.disabled))
  root.append(footer)
  const scroll = current.shadow.querySelector(".items")?.scrollTop ?? 0
  current.shadow.replaceChildren(style, root)
  list.scrollTop = scroll
}
