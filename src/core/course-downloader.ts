import {
  allowedURL,
  discoverChapters,
  permissionProblem,
  safeName,
  type Chapter,
  type CourseResource,
} from "./course-model";
import { scanDocument, scanFrame } from "./course-bridge";
import { CourseArchive } from "./course-archive";
import { AccessError, downloadCourseFile } from "./course-request";
import { DownloadController } from "./download-controller";
import { generatePDF, savePDF } from "./pdf-generator";
import { makeCoursePanelCollapsible } from "./course-panel";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function readableDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch (_) {
    return null;
  }
}
function fingerprint(doc: Document): string {
  return `${doc.URL}|${[...doc.querySelectorAll<HTMLIFrameElement>('iframe#iframe, iframe[src*="knowledgeid="], iframe[src*="knowledge/cards"]')].map((f) => f.src).join("|")}`;
}
async function waitUntil<T>(
  get: () => T | null,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (signal.aborted) throw new Error("已停止");
    const value = get();
    if (value) return value;
    await delay(250);
  }
  throw new Error(message);
}
interface RecordItem {
  chapterId: string;
  chapter: string;
  status: string;
  files: string[];
  error?: string;
  timingsMs?: {
    chapterLoad: number;
    resourceScan: number;
    fileDownload: number;
  };
}

export class CourseDownloader {
  private running = false;
  private abort?: AbortController;
  private failures = new Set<string>();
  private loadedChapterId: string | null = null;
  private status = document.createElement("p");
  private start = document.createElement("button");
  private test = document.createElement("button");
  private retry = document.createElement("button");
  private stop = document.createElement("button");
  constructor() {
    const panel = document.createElement("section");
    panel.id = "xxt-course-batch";
    panel.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:300px;padding:16px;border:1px solid #ddd;border-radius:12px;background:white;color:#222;font:14px/1.5 sans-serif;box-shadow:0 4px 18px #0002";
    const title = document.createElement("strong");
    title.textContent = "整门课程批量下载 · 0.4.5";
    const hint = document.createElement("p");
    hint.textContent =
      "收集章节中的文件；可下载的原文件优先，课件预览导出为 PDF。";
    this.start.textContent = "下载整门课程 ZIP";
    this.test.textContent = "测试下载当前章节";
    this.retry.textContent = "重试失败章节";
    this.stop.textContent = "停止并保存已下载";
    this.retry.disabled = true;
    this.stop.disabled = true;
    for (const button of [this.start, this.test, this.retry, this.stop]) {
      button.style.cssText =
        "margin:4px;padding:8px;border:1px solid #ccc;border-radius:6px;cursor:pointer";
    }
    this.status.textContent = "请保持本页面打开。大课程会自动分成多个 ZIP。";
    panel.append(
      title,
      hint,
      this.start,
      this.test,
      this.retry,
      this.stop,
      this.status,
    );
    document.body.append(panel);
    makeCoursePanelCollapsible(panel);
    this.start.onclick = () => void this.run(false);
    this.test.onclick = () => void this.run(false, true);
    this.retry.onclick = () => void this.run(true);
    this.stop.onclick = () => {
      this.abort?.abort();
      this.status.textContent = "正在停止并保存已下载文件…";
    };
  }
  private async run(retryOnly: boolean, currentOnly = false): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.start.disabled = this.test.disabled = this.retry.disabled = true;
    this.stop.disabled = false;
    this.abort = new AbortController();
    this.loadedChapterId = null;
    const signal = this.abort.signal;
    const stage = document.createElement("iframe");
    stage.name = "xxt-course-batch-worker";
    stage.title = "课程批量下载工作页面";
    // A real rendered page is needed for lazy courseware loading, kept off screen.
    stage.style.cssText =
      "position:fixed;left:-12000px;top:0;width:1100px;height:800px;border:0";
    if (!currentOnly) stage.src = location.href;
    const courseName = safeName(
      document
        .querySelector(".courseName, .course-name, h1")
        ?.textContent?.trim() ||
        document.title.replace(/[-_].*$/, "") ||
        "课程",
    );
    const archive = new CourseArchive(`${courseName}_${Date.now()}`, savePDF);
    const records: RecordItem[] = [];
    const seen = new Set<string>();
    const failed = new Set<string>();
    let stopped = false;
    let selected: Chapter[] = [];
    try {
      const denied = permissionProblem(document);
      if (denied) throw new AccessError(denied);
      if (!currentOnly) document.body.append(stage);
      this.status.textContent = "正在读取完整章节目录…";
      const chapters = await waitUntil(
        () => {
          const doc = currentOnly ? document : readableDocument(stage);
          if (!doc || doc.readyState === "loading" || doc.URL === "about:blank")
            return null;
          const error = permissionProblem(doc);
          if (error) throw new AccessError(error);
          const list = discoverChapters(doc);
          return list.length ? list : null;
        },
        signal,
        "未找到课程目录。请打开任意章节的学习页后再试；该站点的目录结构也可能尚未支持。",
      );
      selected = currentOnly
        ? chapters.filter(
            (c) =>
              c.id === new URL(location.href).searchParams.get("chapterId"),
          )
        : retryOnly
          ? chapters.filter((c) => this.failures.has(c.id))
          : chapters;
      if (!selected.length) throw new Error("没有可重试的章节");
      let consecutiveScanFailures = 0;
      for (let index = 0; index < selected.length; index++) {
        const chapter = selected[index];
        const record: RecordItem = {
          chapterId: chapter.id,
          chapter: chapter.title,
          status: "失败",
          files: [],
        };
        records.push(record);
        if (signal.aborted) {
          stopped = true;
          record.status = "未下载";
          break;
        }
        this.status.textContent = `章节 ${index + 1}/${selected.length}：正在切换 · ${chapter.title}`;
        const timings = { chapterLoad: 0, resourceScan: 0, fileDownload: 0 };
        record.timingsMs = timings;
        let phase: keyof typeof timings = "chapterLoad";
        let started = performance.now();
        try {
          if (!currentOnly) await this.openChapter(stage, chapter, signal);
          timings.chapterLoad = Math.round(performance.now() - started);
          this.status.textContent = `章节 ${index + 1}/${selected.length}：扫描附件 · ${chapter.title}`;
          phase = "resourceScan";
          started = performance.now();
          const scan = () =>
            currentOnly
              ? scanDocument(document, chapter.title, signal)
              : scanFrame(stage, chapter.title, signal);
          const packet = await scan();
          if (packet.errors.some((error) => /登录/.test(error)))
            throw new AccessError(packet.errors.join("；"));
          // Let lazy frames settle; an early empty scan must not silently count as success.
          if (!packet.resources.length && !packet.errors.length) {
            await delay(1500);
            const second = await scan();
            packet.resources.push(...second.resources);
            packet.errors.push(...second.errors);
          }
          if (packet.errors.length && !packet.resources.length)
            throw new AccessError(packet.errors.join("；"));
          if (!packet.resources.length)
            throw new Error("未发现可下载文件或已加载的课件预览，请检查此章节");
          timings.resourceScan = Math.round(performance.now() - started);
          const resources = this.preferOriginals(packet.resources);
          phase = "fileDownload";
          started = performance.now();
          const errors: string[] = [...new Set(packet.errors)];
          for (const resource of resources) {
            if (signal.aborted) throw new Error("已停止");
            if (seen.has(resource.key)) continue;
            try {
              const files = await this.downloadResource(
                resource,
                signal,
                (progress) => {
                  this.status.textContent = `章节 ${index + 1}/${selected.length}：${chapter.title} · ${progress}`;
                },
              );
              for (const file of files)
                record.files.push(
                  await archive.add(chapter.title, file.name, file.blob),
                );
              seen.add(resource.key);
            } catch (error) {
              if (
                signal.aborted ||
                (error instanceof AccessError && /登录/.test(error.message))
              )
                throw error;
              errors.push(
                `${resource.name}：${error instanceof Error ? error.message : "下载失败"}`,
              );
            }
          }
          if (errors.length) throw new Error(errors.join("；"));
          timings.fileDownload = Math.round(performance.now() - started);
          record.status = record.files.length ? "成功" : "重复文件已跳过";
          consecutiveScanFailures = 0;
        } catch (error) {
          timings[phase] = Math.round(performance.now() - started);
          if (signal.aborted) {
            stopped = true;
            record.status = "已停止";
            break;
          }
          record.error = error instanceof Error ? error.message : "下载失败";
          failed.add(chapter.id);
          if (
            !record.files.length &&
            /框架未响应|加载超时|章节切换超时|章节读取超时|图片请求失败|图片请求超时/.test(
              record.error,
            )
          ) {
            consecutiveScanFailures++;
            if (consecutiveScanFailures >= 3) {
              stopped = true;
              throw new Error(
                `连续三节无法读取课件，已停止批量任务。请先测试当前章节。${record.error}`,
              );
            }
          } else consecutiveScanFailures = 0;
          if (error instanceof AccessError && /登录/.test(record.error)) {
            throw error;
          }
        }
      }
      // Include every unprocessed chapter so partial exports cannot look complete.
      const processed = new Set(records.map((r) => r.chapterId));
      for (const chapter of selected) {
        if (!processed.has(chapter.id))
          records.push({
            chapterId: chapter.id,
            chapter: chapter.title,
            status: "未下载",
            files: [],
          });
        if (
          !records.find(
            (r) =>
              r.chapterId === chapter.id &&
              ["成功", "重复文件已跳过"].includes(r.status),
          )
        )
          failed.add(chapter.id);
      }
      const success = records.filter(
        (r) => r.status === "成功" || r.status === "重复文件已跳过",
      ).length;
      this.status.textContent = `${stopped ? "已停止" : "处理结束"}：${success}/${selected.length} 节成功，${failed.size} 节需检查。ZIP 内附下载清单。`;
    } catch (error) {
      this.status.textContent =
        error instanceof Error ? error.message : "课程下载失败";
      for (const record of records)
        if (record.status === "失败") record.error ||= this.status.textContent;
    } finally {
      stage.remove();
      for (const chapter of selected) {
        if (!records.some((r) => r.chapterId === chapter.id))
          records.push({
            chapterId: chapter.id,
            chapter: chapter.title,
            status: "未下载",
            files: [],
          });
        if (
          !records.some(
            (r) =>
              r.chapterId === chapter.id &&
              ["成功", "重复文件已跳过"].includes(r.status),
          )
        )
          failed.add(chapter.id);
      }
      try {
        if (records.length)
          archive.finish({
            version: "0.4.5",
            course: courseName,
            stopped: stopped || signal.aborted,
            chapters: records,
          });
      } catch (_) {
        this.status.textContent =
          "ZIP 保存失败，请检查浏览器的下载设置和可用内存。";
      }
      this.failures = failed;
      this.running = false;
      this.start.disabled = this.test.disabled = false;
      this.retry.disabled = !failed.size;
      this.stop.disabled = true;
    }
  }
  private async openChapter(
    stage: HTMLIFrameElement,
    chapter: Chapter,
    signal: AbortSignal,
  ): Promise<void> {
    const doc = readableDocument(stage);
    if (!doc) throw new AccessError("无法读取章节页面，请检查登录状态");
    const current = discoverChapters(doc).find((c) => c.id === chapter.id);
    if (!current) throw new Error("章节目录发生变化，请重新开始");
    const old = fingerprint(doc);
    const currentId =
      this.loadedChapterId || new URL(doc.URL).searchParams.get("chapterId");
    if (currentId !== chapter.id) {
      const click = current.element.matches("a, [onclick]")
        ? current.element
        : current.element.querySelector<HTMLElement>("a, [onclick]") ||
          current.element;
      const href = click.getAttribute("href");
      const linked = href ? allowedURL(href, doc.URL) : null;
      if (linked?.pathname.includes("studentstudy")) stage.src = linked.href;
      else click.click();
      await waitUntil(
        () => {
          const next = readableDocument(stage);
          return next && next.URL !== "about:blank" && fingerprint(next) !== old
            ? next
            : null;
        },
        signal,
        "章节切换超时（可能未开放或此站点使用了尚未支持的目录结构）",
      );
    }
    // Require settled frame addresses rather than reading the previous chapter.
    let previous = "";
    let stable = 0;
    await waitUntil(
      () => {
        const next = readableDocument(stage);
        if (!next || next.readyState === "loading") return null;
        const denied = permissionProblem(next);
        if (denied) throw new AccessError(denied);
        const value = fingerprint(next);
        stable = value === previous ? stable + 1 : 0;
        previous = value;
        return stable >= 2 ? next : null;
      },
      signal,
      "课件页面加载超时",
    );
    this.loadedChapterId = chapter.id;
  }
  private preferOriginals(resources: CourseResource[]): CourseResource[] {
    const originals = new Set(
      resources.filter((r) => r.url).map((r) => r.name.replace(/\.[^.]+$/, "")),
    );
    return resources.filter(
      (r) => !r.pages || !originals.has(r.name.replace(/\.[^.]+$/, "")),
    );
  }
  private async downloadResource(
    resource: CourseResource,
    signal: AbortSignal,
    progress: (text: string) => void,
  ): Promise<{ blob: Blob; name: string }[]> {
    if (resource.url) {
      for (let attempt = 0; ; attempt++) {
        try {
          progress(`正在下载原文件 · ${resource.name}`);
          const file = await downloadCourseFile(
            resource.url,
            signal,
            (loaded, total, speed) => {
              const format = (bytes: number) =>
                bytes >= 1024 * 1024
                  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
                  : `${Math.round(bytes / 1024)} KB`;
              progress(
                `下载 ${resource.name} · ${format(loaded)}${total ? "/" + format(total) : ""} · ${format(speed)}/s`,
              );
            },
          );
          return [{ blob: file.blob, name: file.name || resource.name }];
        } catch (error) {
          if (signal.aborted || error instanceof AccessError || attempt >= 2)
            throw error;
          await delay(1000 * (attempt + 1));
        }
      }
    }
    if (!resource.pages?.length) throw new Error("文件缺少下载地址");
    if (resource.pages.some((url) => !allowedURL(url)))
      throw new Error("课件预览地址不受支持");
    const controller = new DownloadController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const name = `${resource.name.replace(/\.[^.]+$/, "")}.pdf`;
      const result = await generatePDF(
        {
          fileName: name,
          baseUrl: "",
          pageCount: resource.pages.length,
          pageUrls: resource.pages,
        },
        (current, total) => progress(`${resource.name} ${current}/${total} 页`),
        controller,
        { autoSplit: true },
      );
      return (Array.isArray(result) ? result : [result]).map(
        (blob, i, all) => ({
          blob,
          name:
            all.length === 1
              ? name
              : name.replace(/\.pdf$/, `_Part${i + 1}.pdf`),
        }),
      );
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
