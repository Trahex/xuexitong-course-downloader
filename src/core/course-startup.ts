import { CourseDownloader } from "./course-downloader";
import { makeCoursePanelCollapsible } from "./course-panel";

export const WORK_FRAME_NAME = "xxt-course-batch-worker";

export function mountCoursePanel(): void {
  if (!document.body || window.name === WORK_FRAME_NAME) return;
  if (location.pathname.includes("studentstudy")) {
    if (document.getElementById("xxt-course-batch")) return;
    document.getElementById("xxt-course-outline")?.remove();
    document.getElementById("xxt-course-outline-restore")?.remove();
    new CourseDownloader();
    return;
  }
  if (
    window !== window.top ||
    !/\/mycourse\/stu\/?$/.test(location.pathname) ||
    document.getElementById("xxt-course-outline")
  )
    return;
  const panel = document.createElement("section");
  panel.id = "xxt-course-outline";
  panel.style.cssText =
    "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:300px;padding:16px;border:1px solid #ddd;border-radius:12px;background:white;color:#222;font:14px/1.5 sans-serif;box-shadow:0 4px 18px #0002";
  const title = document.createElement("strong");
  title.textContent = "课程批量下载器已启用";
  const status = document.createElement("p");
  status.textContent =
    "当前是课程目录页。进入任意章节的学习页后，右下角会显示“下载整门课程 ZIP”。";
  const open = document.createElement("button");
  open.textContent = "打开第一节学习页";
  open.style.cssText =
    "padding:8px;border:1px solid #ccc;border-radius:6px;cursor:pointer";
  open.onclick = () => {
    const docs: Document[] = [document];
    // Use a real chapter control; its site handler preserves session and signatures.
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      "iframe",
    )) {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch (_) {
        /* respect same-origin restrictions */
      }
    }
    const chapter = docs
      .flatMap((doc) => [...doc.querySelectorAll<HTMLAnchorElement>("a")])
      .find((a) => /^\s*\d+\.\d+\s/.test(a.textContent || ""));
    if (!chapter) {
      status.textContent =
        "目录尚未加载或无法读取。请点击左侧“章节”，再手动打开任意一节。";
      return;
    }
    chapter.click();
    status.textContent =
      "已点击第一节。如浏览器拦截了新窗口，请直接点击目录中的章节。学习页加载后会出现 ZIP 下载按钮。";
  };
  panel.append(title, status, open);
  document.body.append(panel);
  makeCoursePanelCollapsible(panel);
}
