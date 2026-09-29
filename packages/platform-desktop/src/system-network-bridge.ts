import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const OUTBOUND_PATH = "/outbound";
const OUTBOUND_BASE_PATH = /^\/outbound-base\/([A-Za-z0-9_-]{1,2048})(\/.*)?$/;
const MAX_STREAMING_UPLOAD_BYTES = 500 * 1024 * 1024;
const BRIDGE_TOKEN_HEADER = "x-pixelcrab-bridge-token";
const BRIDGE_UPSTREAM_HEADER = "x-pixelcrab-bridge-upstream";

export interface SystemNetworkBridgeOptions {
  fetchImpl: typeof globalThis.fetch;
  token?: string;
}

export type NetworkTarget = {
  url: URL;
  preserveWebContext?: boolean;
  streaming?: boolean;
  transformResponse?: (result: Response, response: ServerResponse) => Promise<void>;
};

/**
 * A loopback-only bridge from the OpenCode sidecar to Electron's Chromium
 * network stack. Access requires a per-process secret and targets are limited
 * to credential-free HTTPS URLs, while localhost runtimes remain direct.
 */
export class SystemNetworkBridge {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly token: string;
  private server?: Server;
  private starting?: Promise<void>;
  private port?: number;
  private readonly requests = new Set<AbortController>();

  constructor(options: SystemNetworkBridgeOptions) {
    this.fetchImpl = options.fetchImpl;
    this.token = options.token ?? randomBytes(32).toString("base64url");
  }

  async start(): Promise<string> {
    if (!this.server) {
      this.starting ??= this.listen().finally(() => { this.starting = undefined; });
      await this.starting;
    }
    return this.loopbackBaseURL();
  }

  async close(): Promise<void> {
    await this.starting;
    for (const controller of this.requests) controller.abort();
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private async listen(): Promise<void> {
    const server = createServer((request, response) => void this.handle(request, response));
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("PixelCrab network bridge did not bind to loopback.");
    }
    this.server = server;
    this.port = address.port;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const controller = new AbortController();
    this.requests.add(controller);
    const abort = () => controller.abort();
    const close = () => { if (!response.writableEnded) abort(); };
    request.once("aborted", abort);
    response.once("close", close);
    try {
      const requestURL = new URL(request.url || "/", "http://127.0.0.1");
      const localPrefix = `/${this.token}`;
      const pathAuthenticated = requestURL.pathname.startsWith(`${localPrefix}/`);
      const headerAuthenticated = request.headers[BRIDGE_TOKEN_HEADER] === this.token;
      if (!pathAuthenticated && !headerAuthenticated) return sendError(response, 404, "not_found");
      const localPath = pathAuthenticated ? requestURL.pathname.slice(localPrefix.length) : requestURL.pathname;
      const route = this.resolveTarget(request, localPath, requestURL, headerAuthenticated);
      if (!route) return sendError(response, 404, "not_found");
      const target = route.url;
      const preserveOfficialClientHeaders = route.preserveWebContext === true;
      if (route.streaming) {
        await this.forwardStreamingRequest(request, response, target, controller.signal, preserveOfficialClientHeaders);
        return;
      }

      const body = await readBoundedBody(request, MAX_REQUEST_BYTES);
      const result = await this.fetchImpl(target, {
        method: request.method,
        headers: forwardRequestHeaders(request.headers, preserveOfficialClientHeaders),
        body: request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(body),
        signal: controller.signal,
      });
      if (route.transformResponse) {
        await route.transformResponse(result, response);
        return;
      }
      response.writeHead(result.status, forwardResponseHeaders(result.headers));
      if (!result.body) {
        response.end();
        return;
      }
      await pipeline(Readable.fromWeb(result.body as Parameters<typeof Readable.fromWeb>[0]), response);

    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const status = error instanceof RequestTooLargeError ? 413 : 502;
      if (!response.destroyed) sendError(response, status, status === 413 ? "request_too_large" : "upstream_unavailable");
    } finally {
      this.requests.delete(controller);
      request.off("aborted", abort);
      response.off("close", close);
    }
  }

  protected loopbackBaseURL(): string {
    return `http://127.0.0.1:${this.port}/${this.token}`;
  }

  protected resolveTarget(request: IncomingMessage, localPath: string, requestURL: URL, headerAuthenticated: boolean): NetworkTarget | undefined {
    const outbound = this.outboundTarget(request.method, localPath, requestURL);
    const url = outbound ?? this.outboundBaseTarget(request.method, localPath, requestURL.search)
      ?? (headerAuthenticated ? this.headerBaseTarget(request.method, localPath, requestURL.search, request.headers[BRIDGE_UPSTREAM_HEADER]) : undefined);
    return url ? { url, preserveWebContext: !!outbound, streaming: ["POST", "PUT", "PATCH"].includes(request.method ?? "") && shouldStreamOutboundRequest(request) } : undefined;
  }

  private async forwardStreamingRequest(
    request: IncomingMessage,
    response: ServerResponse,
    target: URL,
    signal: AbortSignal,
    preserveOfficialClientHeaders = false,
  ): Promise<void> {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_STREAMING_UPLOAD_BYTES) throw new RequestTooLargeError();
    let size = 0;
    const bounded = new Transform({
      transform(chunk, _encoding, callback) {
        size += Buffer.byteLength(chunk);
        if (size > MAX_STREAMING_UPLOAD_BYTES) return callback(new RequestTooLargeError());
        callback(null, chunk);
      },
    });
    request.pipe(bounded);
    const result = await this.fetchImpl(target, {
      method: request.method,
      headers: forwardRequestHeaders(request.headers, preserveOfficialClientHeaders),
      body: bounded as unknown as BodyInit,
      signal,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    response.writeHead(result.status, forwardResponseHeaders(result.headers));
    if (!result.body) return void response.end();
    await pipeline(Readable.fromWeb(result.body as Parameters<typeof Readable.fromWeb>[0]), response);
  }

  private outboundTarget(method: string | undefined, path: string, requestURL: URL): URL | undefined {
    if (path !== OUTBOUND_PATH || !method || !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return undefined;
    const raw = requestURL.searchParams.get("url");
    if (!raw) return undefined;
    return parseOutboundURL(raw);
  }

  private outboundBaseTarget(method: string | undefined, path: string, search: string): URL | undefined {
    if (!method || !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return undefined;
    const match = OUTBOUND_BASE_PATH.exec(path);
    if (!match) return undefined;
    const encoded = match[1];
    if (!encoded) return undefined;
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const upstream = parseOutboundURL(decoded);
    if (upstream.search) throw new Error("PixelCrabs outbound base must not contain a query.");
    const suffix = match[2] ?? "";
    const basePath = trimTrailingSlash(upstream.pathname);
    return new URL(`${basePath}${suffix}${search}`, upstream.origin);
  }

  private headerBaseTarget(method: string | undefined, path: string, search: string, raw: string | string[] | undefined): URL | undefined {
    if (!method || !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return undefined;
    if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(raw)) return undefined;
    const upstream = parseOutboundURL(Buffer.from(raw, "base64url").toString("utf8"));
    if (upstream.search) throw new Error("PixelCrabs header bridge base must not contain a query.");
    return new URL(`${trimTrailingSlash(upstream.pathname)}${path}${search}`, upstream.origin);
  }

}

function parseOutboundURL(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("PixelCrabs outbound target must be a credential-free HTTPS URL.");
  }
  return url;
}

function trimTrailingSlash(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "";
}

function forwardRequestHeaders(source: IncomingMessage["headers"], preserveWebContext = false): Headers {
  const headers = new Headers();
  const blocked = new Set([
    "connection",
    "content-length",
    "host",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    // Electron derives Fetch mode from Request options and Origin. Forwarding
    // Node's automatic `cors` mode without Origin fails with ERR_INVALID_ARGUMENT.
    "sec-fetch-mode",
    BRIDGE_TOKEN_HEADER,
    BRIDGE_UPSTREAM_HEADER,
    ...(preserveWebContext ? [] : ["cookie", "origin", "referer"]),
  ]);
  for (const [name, raw] of Object.entries(source)) {
    if (blocked.has(name) || name.startsWith("proxy-") || (!preserveWebContext && name.startsWith("sec-"))) continue;
    const value = Array.isArray(raw) ? raw.join(", ") : raw;
    if (typeof value === "string") headers.set(name, value);
  }
  return headers;
}

function shouldStreamOutboundRequest(request: IncomingMessage): boolean {
  const declared = Number(request.headers["content-length"] ?? Number.NaN);
  if (Number.isFinite(declared)) return declared > MAX_REQUEST_BYTES;
  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  return contentType.includes("multipart/form-data") || contentType.includes("application/octet-stream");
}

export function forwardResponseHeaders(source: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  const blocked = new Set(["connection", "content-length", "content-encoding", "set-cookie", "transfer-encoding", "upgrade"]);
  for (const [name, value] of source.entries()) {
    if (!blocked.has(name)) headers[name] = value;
  }
  return headers;
}

async function readBoundedBody(request: IncomingMessage, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maximum) throw new RequestTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendError(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify({ error: { code, message: "PixelCrab network request could not be completed." } }));
}

class RequestTooLargeError extends Error {}
