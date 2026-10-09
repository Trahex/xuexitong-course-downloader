/**
 * 学习通 PPT 下载器主入口
 */

import { ChapterDownloader } from "./core/downloaders/chapter-downloader";
import { MaterialDownloader } from "./core/downloaders/material-downloader";
import { installCourseBridge } from "./core/course-bridge";
import { mountCoursePanel, WORK_FRAME_NAME } from "./core/course-startup";

installCourseBridge();

function start(): void {
  mountCoursePanel();
  // Do not start a second downloader inside the batch processing frame.
  if (window.name === WORK_FRAME_NAME) return;
  try {
    if (location.pathname.includes("studentstudy")) new ChapterDownloader();
    else if (
      window === window.top &&
      location.pathname.includes("mooc2-ans/mycourse/stu")
    )
      new MaterialDownloader();
  } catch (error) {
    // A single-file preview problem must not suppress the independent course UI.
    console.warn("[课程下载器] 单文件按钮初始化失败", error);
  }
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
window.addEventListener("popstate", mountCoursePanel);
window.addEventListener("hashchange", mountCoursePanel);
