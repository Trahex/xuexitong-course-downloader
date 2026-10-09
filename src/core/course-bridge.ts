import {
  allowedURL,
  permissionProblem,
  readResources,
  type CourseResource,
} from "./course-model";

const CHANNEL = "xxt-course-resources-v2";
export interface ResourcePacket {
  resources: CourseResource[];
  errors: string[];
}
interface BridgeMessage {
  channel: string;
  kind: "probe" | "ready" | "scan" | "result";
  token: string;
  name?: string;
  packet?: ResourcePacket;
}
function frameName(frame: HTMLIFrameElement, fallback: string): string {
  try {
    const data = JSON.parse(frame.getAttribute("data") || "{}");
    return typeof data.name === "string" ? data.name : fallback;
  } catch (_) {
    return fallback;
  }
}
export function resourceFrameURL(frame: HTMLIFrameElement): URL | null {
  const src = frame.getAttribute("src")?.trim();
  return src ? allowedURL(src, frame.ownerDocument.URL) : null;
}
export function resourceFrames(
  doc: Document,
  resources: CourseResource[],
): HTMLIFrameElement[] {
  const original = doc.querySelector<HTMLAnchorElement>("#downloadUrl[href]");
  const originalURL = original
    ? allowedURL(original.getAttribute("href") || "", doc.URL)
    : null;
  const hasOriginal =
    !!originalURL && resources.some((r) => r.url === originalURL.href);
  return [...doc.querySelectorAll<HTMLIFrameElement>("iframe")].filter(
    (frame) =>
      !!resourceFrameURL(frame) && !(hasOriginal && frame.id === "panView"),
  );
}
function readableDocument(frame: HTMLIFrameElement): Document | null {
  try {
    const doc = frame.contentDocument;
    return doc && doc.URL !== "about:blank" && doc.readyState !== "loading"
      ? doc
      : null;
  } catch (_) {
    return null;
  }
}
/** Read same-origin documents directly; only inaccessible frames need a relay. */
export async function scanDocument(
  doc: Document,
  name: string,
  signal: AbortSignal,
): Promise<ResourcePacket> {
  if (signal.aborted) throw new Error("已停止");
  const result: ResourcePacket = { resources: [], errors: [] };
  const denied = permissionProblem(doc);
  if (denied) return { resources: [], errors: [denied] };
  try {
    result.resources = readResources(doc, name);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "课件读取失败");
  }
  const packets = await Promise.all(
    resourceFrames(doc, result.resources).map(async (frame) => {
      try {
        return await scanFrame(frame, frameName(frame, name), signal);
      } catch (error) {
        if (signal.aborted) throw error;
        return {
          resources: [],
          errors: [error instanceof Error ? error.message : "框架读取失败"],
        };
      }
    }),
  );
  for (const packet of packets) {
    result.resources.push(...packet.resources);
    result.errors.push(...packet.errors);
  }
  result.resources = [
    ...new Map(result.resources.map((r) => [r.key, r])).values(),
  ];
  return result;
}
function isAncestor(source: MessageEventSource | null, local: Window): boolean {
  let ancestor = local.parent;
  while (ancestor !== local) {
    if (ancestor === source) return true;
    if (ancestor === ancestor.parent) break;
    ancestor = ancestor.parent;
  }
  return false;
}
/** Verify a redirected frame's actual origin before sending course metadata. */
export function installCourseBridge(local: Window = window): void {
  const sessions = new Map<string, Promise<ResourcePacket>>();
  local.addEventListener("message", (event) => {
    const message = event.data as BridgeMessage;
    if (
      !message ||
      message.channel !== CHANNEL ||
      typeof message.token !== "string" ||
      !allowedURL(event.origin) ||
      !isAncestor(event.source, local)
    )
      return;
    const parent = event.source as Window;
    if (message.kind === "probe") {
      parent.postMessage(
        { channel: CHANNEL, kind: "ready", token: message.token },
        event.origin,
      );
      return;
    }
    if (
      message.kind !== "scan" ||
      typeof message.name !== "string" ||
      sessions.has(message.token)
    )
      return;
    const task = scanDocument(
      local.document,
      message.name,
      new AbortController().signal,
    );
    sessions.set(message.token, task);
    if (sessions.size > 32) sessions.delete(sessions.keys().next().value!);
    void task
      .then((packet) => {
        parent.postMessage(
          { channel: CHANNEL, kind: "result", token: message.token, packet },
          event.origin,
        );
      })
      .catch((error) => {
        parent.postMessage(
          {
            channel: CHANNEL,
            kind: "result",
            token: message.token,
            packet: {
              resources: [],
              errors: [error instanceof Error ? error.message : "课件读取失败"],
            },
          },
          event.origin,
        );
      });
  });
}
export async function scanFrame(
  frame: HTMLIFrameElement,
  name: string,
  signal: AbortSignal,
  timeoutMs = 12000,
): Promise<ResourcePacket> {
  if (signal.aborted) throw new Error("已停止");
  const target = resourceFrameURL(frame);
  const source = frame.contentWindow;
  if (!target || !source) throw new Error("章节页面地址不受支持");
  const doc = readableDocument(frame);
  if (doc) return scanDocument(doc, name, signal);
  const local = window;
  const token = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let verifiedOrigin: string | null = null;
    const cleanup = () => {
      clearTimeout(deadline);
      clearInterval(retry);
      local.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error("已停止"));
    };
    const receive = (event: MessageEvent) => {
      const message = event.data as BridgeMessage;
      if (
        event.source !== source ||
        !allowedURL(event.origin) ||
        message?.channel !== CHANNEL ||
        message.token !== token
      )
        return;
      if (message.kind === "ready") {
        verifiedOrigin = event.origin;
        source.postMessage(
          { channel: CHANNEL, kind: "scan", token, name },
          verifiedOrigin,
        );
      } else if (
        message.kind === "result" &&
        event.origin === verifiedOrigin &&
        message.packet
      ) {
        cleanup();
        resolve(message.packet);
      }
    };
    const probe = () => {
      // This contains no filename, URL, login data, or course metadata.
      source.postMessage({ channel: CHANNEL, kind: "probe", token }, "*");
    };
    const deadline = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `课件框架未响应：${target.origin}${target.pathname}。请确认油猴允许在超星域名和所有框架运行；可先测试当前章节。`,
        ),
      );
    }, timeoutMs);
    const retry = setInterval(probe, 500);
    local.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else probe();
  });
}
