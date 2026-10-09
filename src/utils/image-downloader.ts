import { requestPreviewImage } from "./preview-request";

export function downloadImage(
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return requestPreviewImage(url, signal);
}

export async function downloadImageAsArrayBuffer(
  url: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  return (await downloadImage(url, signal)).arrayBuffer();
}

/**
 * 将 Blob 转换为 Data URL
 */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 加载图片并获取尺寸
 */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * 转换图片格式为 JPEG
 */
export async function processImage(
  blob: Blob,
  quality = 0.8,
): Promise<{ buffer: ArrayBuffer; format: "JPEG" | "PNG" }> {
  // 如果已经是 JPEG，直接返回
  if (blob.type === "image/jpeg" || blob.type === "image/jpg") {
    return {
      buffer: await blob.arrayBuffer(),
      format: "JPEG",
    };
  }

  // 使用 Bitmap 和 Canvas 进行转换
  try {
    const bitmap = await createImageBitmap(blob);

    // 创建 Canvas
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let ctx:
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;

    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    } else {
      canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    }

    if (!ctx) throw new Error("Cannot create canvas context");

    // 绘制图片
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    // @ts-ignore
    ctx.drawImage(bitmap, 0, 0);

    // 导出为 JPEG
    let jpegBlob: Blob | null = null;

    if (canvas instanceof OffscreenCanvas) {
      jpegBlob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    } else {
      jpegBlob = await new Promise<Blob | null>((resolve) =>
        (canvas as HTMLCanvasElement).toBlob(resolve, "image/jpeg", quality),
      );
    }

    if (!jpegBlob) throw new Error("Canvas conversion failed");

    return {
      buffer: await jpegBlob.arrayBuffer(),
      format: "JPEG",
    };
  } catch (e) {
    console.warn("[图片处理] 转换 JPEG 失败，回退到原始格式", e);
    return {
      buffer: await blob.arrayBuffer(),
      format: "PNG",
    };
  }
}

import type { DownloadController } from "../core/download-controller";

/**
 * 通用的并发下载函数
 */
export async function downloadWithConcurrency<T>(
  urls: string[],
  downloadFn: (url: string) => Promise<T>,
  concurrency: number = 5,
  controller?: DownloadController,
): Promise<T[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("并发数必须为正整数");
  const results: T[] = new Array(urls.length);
  let next = 0;
  let failure: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    async () => {
      while (next < urls.length && !failure) {
        controller?.throwIfAborted();
        const index = next++;
        try {
          results[index] = await downloadFn(urls[index]);
        } catch (error) {
          failure = error || new Error("图片下载失败");
        }
      }
    },
  );
  const settled = await Promise.allSettled(workers);
  controller?.throwIfAborted();
  const rejected = settled.find((r) => r.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  if (failure) throw failure;
  return results;
}
