import { spawn } from "node:child_process"

export type PreviewPortOwner = {
  pid: number
  processGroupId?: number
  parentPid?: number
  ancestors?: number[]
}

export type PreviewPortOwnership = {
  status: "verified" | "mismatch" | "missing" | "unsupported"
  port: number
  owners: PreviewPortOwner[]
  message: string
}

export function previewPortOwnersMatch(input: {
  owners: PreviewPortOwner[]
  rootPid: number
  processGroupId?: number
  platform?: NodeJS.Platform
}) {
  if (!input.owners.length) return false
  return (input.platform ?? process.platform) === "win32"
    ? input.owners.every((owner) => owner.pid === input.rootPid || owner.ancestors?.includes(input.rootPid))
    : Boolean(input.processGroupId) && input.owners.every((owner) => owner.processGroupId === input.processGroupId)
}

function run(command: string, args: string[], timeout = 5_000) {
  return new Promise<{ stdout: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
    let stdout = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} timed out.`))
    }, timeout)
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => (stdout += chunk))
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (exitCode) => {
      clearTimeout(timer)
      resolve({ stdout, exitCode })
    })
  })
}

function parseLsof(value: string) {
  const owners: PreviewPortOwner[] = []
  let current: PreviewPortOwner | undefined
  for (const line of value.split(/\r?\n/)) {
    const field = line[0]
    const number = Number(line.slice(1))
    if (!Number.isInteger(number) || number <= 0) continue
    if (field === "p") {
      current = { pid: number }
      owners.push(current)
    } else if (field === "g" && current) current.processGroupId = number
    else if (field === "R" && current) current.parentPid = number
  }
  return owners
}

async function observePosix(port: number): Promise<PreviewPortOwner[]> {
  const result = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-FpgR"])
  if (result.exitCode !== 0 && !result.stdout.trim()) return []
  return parseLsof(result.stdout)
}

async function observeWindows(port: number): Promise<PreviewPortOwner[]> {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$connections=@(Get-NetTCPConnection -State Listen -LocalPort ${port})`,
    "$items=@()",
    "foreach($connection in $connections){$pidValue=[int]$connection.OwningProcess;$ancestors=@();$process=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $pidValue);while($process -and [int]$process.ParentProcessId -gt 0){$parent=[int]$process.ParentProcessId;$ancestors+=$parent;$process=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $parent)};$items+=[PSCustomObject]@{pid=$pidValue;ancestors=$ancestors}}",
    "$items|ConvertTo-Json -Compress",
  ].join(";")
  const result = await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script])
  if (result.exitCode !== 0 || !result.stdout.trim()) return []
  const parsed = JSON.parse(result.stdout) as
    | { pid?: unknown; ancestors?: unknown }
    | Array<{ pid?: unknown; ancestors?: unknown }>
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((item) => {
    if (!Number.isInteger(item.pid)) return []
    return [
      {
        pid: item.pid as number,
        ancestors: Array.isArray(item.ancestors)
          ? item.ancestors.filter((value): value is number => Number.isInteger(value))
          : [],
      },
    ]
  })
}

export async function verifyPreviewPortOwnership(input: {
  port: number
  rootPid?: number
  processGroupId?: number
}): Promise<PreviewPortOwnership> {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535)
    return { status: "mismatch", port: input.port, owners: [], message: "Runtime端口无效。" }
  if (!input.rootPid)
    return { status: "unsupported", port: input.port, owners: [], message: "Runtime没有可验证的根进程。" }
  try {
    const owners = process.platform === "win32" ? await observeWindows(input.port) : await observePosix(input.port)
    if (!owners.length)
      return { status: "missing", port: input.port, owners, message: "未发现该端口的监听进程。" }
    const matches = previewPortOwnersMatch({
      owners,
      rootPid: input.rootPid,
      processGroupId: input.processGroupId,
    })
    return matches
      ? { status: "verified", port: input.port, owners, message: "监听端口属于当前受管进程树。" }
      : { status: "mismatch", port: input.port, owners, message: "监听端口属于其他进程或进程组。" }
  } catch (error) {
    return {
      status: "unsupported",
      port: input.port,
      owners: [],
      message: `当前系统无法完成端口归属探测：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
