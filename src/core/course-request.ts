import { allowedURL } from "./course-model";

export class AccessError extends Error {}

export function downloadCourseFile(
  url: string,
  signal: AbortSignal,
  onProgress?: (loaded: number, total: number, bytesPerSecond: number) => void,
): Promise<{ blob: Blob; name?: string }> {
  if (!allowedURL(url)) return Promise.reject(new Error("文件地址不受支持"));
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const abort = () => {
      request.abort();
      reject(new Error("已停止"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    const request = GM_xmlhttpRequest({
      method: "GET",
      url,
      responseType: "blob",
      timeout: 60000,
      onprogress: (response) => {
        const seconds = Math.max((performance.now() - started) / 1000, 0.1);
        onProgress?.(
          response.loaded,
          response.lengthComputable ? response.total : 0,
          response.loaded / seconds,
        );
      },
      onload: async (response) => {
        cleanup();
        if (signal.aborted) {
          reject(new Error("已停止"));
          return;
        }
        if (response.status === 401) {
          reject(new AccessError("需要重新登录"));
          return;
        }
        if (response.status === 403) {
          reject(new AccessError("文件没有下载权限"));
          return;
        }
        if (!allowedURL(response.finalUrl || url)) {
          reject(new AccessError("文件重定向到不支持的站点"));
          return;
        }
        if (response.status !== 200) {
          reject(new Error(`文件请求失败（${response.status}）`));
          return;
        }
        try {
          const blob = response.response as Blob;
          const head = await blob.slice(0, 512).text();
          if (
            !blob.size ||
            /text\/html/i.test(blob.type) ||
            /^\s*(<!doctype html|<html)/i.test(head)
          ) {
            throw new AccessError("返回了登录页或错误页面，未保存为文件");
          }
          const disposition =
            response.responseHeaders.match(
              /^content-disposition:\s*(.+)$/im,
            )?.[1] || "";
          const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
          const plain = disposition.match(
            /filename="([^"]+)"|filename=([^;]+)/i,
          );
          let name = plain?.[1] || plain?.[2]?.trim();
          if (encoded) {
            try {
              name = decodeURIComponent(encoded);
            } catch (_) {
              /* retain ordinary name */
            }
          }
          resolve({ blob, name });
        } catch (error) {
          reject(error);
        }
      },
      onerror: () => {
        cleanup();
        reject(new Error("文件网络请求失败"));
      },
      ontimeout: () => {
        cleanup();
        reject(new Error("文件下载超时"));
      },
      onabort: () => {
        cleanup();
        reject(new Error("已停止"));
      },
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
