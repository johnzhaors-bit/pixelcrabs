import { createConnection } from "node:net"

const reservedPorts = new Set<number>()
let allocationQueue = Promise.resolve()

async function loopbackPortInUse(port: number, host: "127.0.0.1" | "::1") {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port })
    const finish = (inUse: boolean) => {
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(250, () => finish(false))
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
  })
}

export async function previewPortAvailable(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid preview port")
  const inUse = await Promise.all([
    loopbackPortInUse(port, "127.0.0.1"),
    loopbackPortInUse(port, "::1"),
  ])
  return !inUse.some(Boolean)
}

export async function findPreviewPort(preferred: number) {
  if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) throw new Error("Invalid preview port")
  for (let port = preferred; port <= Math.min(65535, preferred + 39); port++) {
    if (await previewPortAvailable(port)) return port
  }
  throw new Error(`端口 ${preferred}-${preferred + 39} 均不可用。`)
}

export async function reservePreviewPort(preferred: number) {
  if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) throw new Error("Invalid preview port")
  const previous = allocationQueue
  let unlock = () => {}
  allocationQueue = new Promise<void>((resolve) => {
    unlock = resolve
  })
  await previous
  try {
    for (let port = preferred; port <= Math.min(65535, preferred + 39); port++) {
      if (reservedPorts.has(port) || !(await previewPortAvailable(port))) continue
      reservedPorts.add(port)
      let released = false
      return {
        port,
        release() {
          if (released) return
          released = true
          reservedPorts.delete(port)
        },
      }
    }
    throw new Error(`端口 ${preferred}-${preferred + 39} 均不可用。`)
  } finally {
    unlock()
  }
}
