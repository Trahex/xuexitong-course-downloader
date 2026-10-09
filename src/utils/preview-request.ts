import { allowedURL } from "../core/course-model";
import { AccessError } from "../core/course-request";

function errorDetail(error: unknown): string {
  const fields =
    typeof error === "object" && error !== null
      ? ["status", "statusText", "error", "message", "code"].map(
          (key) => (error as Record<string, unknown>)[key],
        )
      : [error];
  return (
    fields
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map(String)
      .join(" · ")
      .replace(/https?:\/\/[^\s]+/g, "[请求地址]")
      .slice(0, 160) || "未提供原因"
  );
}

async function validateImage(
  blob: Blob,
  status: number,
  finalURL: string,
): Promise<Blob> {
  if (status === 401) throw new AccessError("预览图片需要重新登录");
  if (status === 403) throw new AccessError("预览图片没有下载权限（HTTP 403）");
  if (status !== 200) throw new Error(`图片请求失败（HTTP ${status}）`);
  if (!allowedURL(finalURL))
    throw new AccessError("预览图片重定向到不支持的站点");
  const bytes = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  if (/text\/html/i.test(blob.type) || /^\s*(<!doctype html|<html)/i.test(text))
    throw new AccessError("图片请求返回了登录页或错误页面");
  const png =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  const gif = text.startsWith("GIF8");
  const webp = text.startsWith("RIFF") && text.slice(8, 12) === "WEBP";
  if (!blob.size || !(png || jpeg || gif || webp))
    throw new Error("响应不是有效的预览图片");
  return blob;
}

function gmImage(url: string, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let request: { abort(): void } | undefined;
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      fail(new Error("已停止"));
      request?.abort();
    };
    const timer = setTimeout(() => {
      fail(new Error("油猴图片请求超时"));
      request?.abort();
    }, 20000);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    try {
      request = GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "blob",
        timeout: 20000,
        onload: (response) => {
          void validateImage(
            response.response as Blob,
            response.status,
            response.finalUrl || url,
          )
            .then((blob) => {
              if (finished) return;
              finished = true;
              cleanup();
              resolve(blob);
            })
            .catch(fail);
        },
        onerror: (error) =>
          fail(
            new Error(
              `油猴图片请求失败（${errorDetail(error)}）；请检查该脚本是否允许连接 ${new URL(url).hostname}`,
            ),
          ),
        ontimeout: () => fail(new Error("油猴图片请求超时")),
        onabort: () => fail(new Error("已停止")),
      });
    } catch (error) {
      fail(new Error(`油猴图片请求失败（${errorDetail(error)}）`));
    }
  });
}

/** Public previews with CORS can use the browser; GM is the fallback for network/CORS failures. */
export async function requestPreviewImage(
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!allowedURL(url)) throw new Error("预览图片地址不受支持");
  if (signal?.aborted) throw new Error("已停止");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  let browserError: unknown;
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    });
    return await validateImage(
      await response.blob(),
      response.status,
      response.url || url,
    );
  } catch (error) {
    if (signal?.aborted) throw new Error("已停止");
    if (error instanceof AccessError) throw error;
    browserError = error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  try {
    return await gmImage(url, signal);
  } catch (error) {
    if (signal?.aborted || error instanceof AccessError) throw error;
    throw new Error(
      `浏览器图片请求失败（${errorDetail(browserError)}）；${error instanceof Error ? error.message : errorDetail(error)}`,
    );
  }
}
