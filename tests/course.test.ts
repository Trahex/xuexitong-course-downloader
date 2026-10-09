import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { unzipSync, strFromU8 } from "fflate";
import {
  allowedURL,
  discoverChapters,
  permissionProblem,
  readResources,
  safeName,
} from "../src/core/course-model";
import { CourseArchive } from "../src/core/course-archive";
import { downloadWithConcurrency } from "../src/utils/image-downloader";
import { DownloadController } from "../src/core/download-controller";
import { AccessError, downloadCourseFile } from "../src/core/course-request";
import { CourseDownloader } from "../src/core/course-downloader";
import { resourceFrameURL, resourceFrames } from "../src/core/course-bridge";

const base =
  "https://mooc1.shu.edu.cn/mycourse/studentstudy?chapterId=11&courseId=20&enc=fixture";
const documentFor = (html: string) =>
  new JSDOM(html, { url: base }).window.document;

test("blank frames do not cost a timeout; advertised originals skip their preview but keep other attachments", () => {
  const doc = documentFor(
    '<a id="downloadUrl" href="https://mooc1.shu.edu.cn/a.ppt">下载</a><iframe></iframe><iframe src="about:blank"></iframe><iframe id="panView" src="https://s.cldisk.com/preview"></iframe><iframe id="other" src="https://mooc1.shu.edu.cn/attachment"></iframe>',
  );
  assert.equal(resourceFrameURL(doc.querySelector("iframe")!), null);
  assert.deepEqual(
    resourceFrames(doc, readResources(doc)).map((f) => f.id),
    ["other"],
  );
  doc.querySelector("#downloadUrl")!.setAttribute("href", "javascript:void(0)");
  assert.deepEqual(
    resourceFrames(doc, readResources(doc)).map((f) => f.id),
    ["panView", "other"],
  );
});

test("reads chapter controls in order, deduplicates nested controls, never manufactures signed URLs", () => {
  const doc =
    documentFor(`<li id="cur11" title="1.1 函数"><a onclick="getTeacherAjax(20,30,11)">函数</a></li>
    <a onclick="getTeacherAjax('20','30','12')">1.2 极限</a>
    <a href="${base.replace("chapterId=11", "chapterId=13")}">1.3 连续</a>`);
  assert.deepEqual(
    discoverChapters(doc).map((c) => [c.id, c.title]),
    [
      ["11", "1.1 函数"],
      ["12", "1.2 极限"],
      ["13", "1.3 连续"],
    ],
  );
});
test("preserves actual signed image URLs, lazy URLs, and order; ignores disabled and foreign download links", () => {
  const doc = documentFor(`<input id="fileInfoNameInput" value="函数.PPT">
    <a id="downloadUrl" href="javascript:void(0)">下载</a>
    <a href="https://mooc1.shu.edu.cn/file/a.docx">讲义.docx</a>
    <a href="https://evil.test/a.ppt">恶意文件</a>
    <a aria-disabled="true" href="https://mooc1.shu.edu.cn/file/blocked.ppt">不可下载</a>
    <li id="anchor1"><img src="https://s.cldisk.com/doc/1.png?token=test"></li>
    <li id="anchor2"><img data-original="https://s.cldisk.com/doc/2.jpg?token=test" src="about:blank"></li>`);
  const resources = readResources(doc);
  assert.equal(resources.length, 2);
  assert.deepEqual(resources[1].pages, [
    "https://s.cldisk.com/doc/1.png?token=test",
    "https://s.cldisk.com/doc/2.jpg?token=test",
  ]);
  assert.equal(allowedURL("https://chaoxing.com.evil.test/a"), null);
  assert.equal(allowedURL("http://mooc1.shu.edu.cn/a"), null);
  assert.throws(
    () =>
      readResources(
        documentFor('<li id="anchor1"><img src="about:blank"></li>'),
      ),
    /缺失页/,
  );
});
test("detects login and locked chapters; sanitizes archive traversal and Windows reserved names", () => {
  assert.match(
    permissionProblem(documentFor('<input type="password">'))!,
    /登录/,
  );
  assert.match(
    permissionProblem(documentFor("<p>该章节尚未开放</p>"))!,
    /未开放/,
  );
  assert.equal(permissionProblem(documentFor("<p>正常章节</p>")), null);
  assert.equal(safeName("../CON"), "__CON");
  assert.equal(safeName("CON.pdf"), "_CON.pdf");
  assert.ok(!safeName("../../chapter/a.ppt").includes("/"));
});
test("ZIPs contain actual files, unique names, and report; large courses split without losing entries", async () => {
  const saved: Blob[] = [];
  const archive = new CourseArchive("数学", (blob) => saved.push(blob), 5);
  await archive.add("第一章", "a.ppt", new Blob(["aaa"]));
  await archive.add("第一章", "a.ppt", new Blob(["bbb"]));
  await archive.add("第二章", "b.pdf", new Blob(["c"]));
  archive.finish({ success: 3 });
  assert.equal(saved.length, 2);
  const files = Object.assign(
    {},
    ...(await Promise.all(
      saved.map(async (blob) =>
        unzipSync(new Uint8Array(await blob.arrayBuffer())),
      ),
    )),
  );
  assert.equal(strFromU8(files["第一章/a.ppt"]), "aaa");
  assert.equal(strFromU8(files["第一章/a (2).ppt"]), "bbb");
  assert.deepEqual(JSON.parse(strFromU8(files["下载清单.json"])), {
    success: 3,
  });
});
test("concurrent downloads preserve order and reject missing slides instead of returning a hole", async () => {
  let active = 0,
    peak = 0;
  const result = await downloadWithConcurrency(
    ["1", "2", "3"],
    async (value) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) =>
        setTimeout(resolve, value === "1" ? 20 : 2),
      );
      active--;
      return value;
    },
    2,
  );
  assert.deepEqual(result, ["1", "2", "3"]);
  assert.equal(peak, 2);
  await assert.rejects(
    downloadWithConcurrency(
      ["1", "2"],
      async (value) => {
        if (value === "2") throw new Error("missing page");
        return value;
      },
      2,
    ),
    /missing page/,
  );
  const controller = new DownloadController();
  controller.abort();
  await assert.rejects(
    downloadWithConcurrency(["1"], async (value) => value, 1, controller),
    /用户取消/,
  );
});
test("file requests reject HTML login responses and 403; honor stop and Content-Disposition filenames", async () => {
  let aborted = false;
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    queueMicrotask(() =>
      details.onload({
        status: 200,
        response: new Blob(["<html>login</html>"]),
        responseHeaders: "",
      }),
    );
    return {
      abort() {
        aborted = true;
      },
    };
  };
  await assert.rejects(
    downloadCourseFile(
      "https://mooc1.shu.edu.cn/file",
      new AbortController().signal,
    ),
    AccessError,
  );
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    queueMicrotask(() =>
      details.onload({
        status: 403,
        response: new Blob(),
        responseHeaders: "",
      }),
    );
    return {
      abort() {
        aborted = true;
      },
    };
  };
  await assert.rejects(
    downloadCourseFile(
      "https://mooc1.shu.edu.cn/file",
      new AbortController().signal,
    ),
    /下载权限/,
  );
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    downloadCourseFile("https://mooc1.shu.edu.cn/file", stopped.signal),
    /已停止/,
  );
  assert.equal(aborted, true);
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    queueMicrotask(() =>
      details.onload({
        status: 200,
        response: new Blob(["real-file"]),
        responseHeaders:
          "content-disposition: attachment; filename*=UTF-8''%E5%87%BD%E6%95%B0.pptx",
      }),
    );
    return { abort() {} };
  };
  assert.equal(
    (
      await downloadCourseFile(
        "https://mooc1.shu.edu.cn/file",
        new AbortController().signal,
      )
    ).name,
    "函数.pptx",
  );
});

test("batch integration: visits all chapters, saves remaining files after 403, and reports exact chapter failures", async () => {
  const root = new JSDOM("<title>高等数学</title><body></body>", { url: base });
  Object.assign(globalThis, {
    window: root.window,
    document: root.window.document,
    location: root.window.location,
  });
  const staging = new JSDOM(
    `<a id="cur11">1.1 函数</a><a id="cur12">1.2 极限</a><a id="cur13">1.3 连续</a><iframe src="https://mooc1.shu.edu.cn/cards?knowledgeid=11"></iframe>`,
    { url: base },
  );
  let current = "11";
  const attachments = staging.window.document.createElement("div");
  staging.window.document.body.append(attachments);
  const refreshAttachments = () => {
    attachments.innerHTML =
      current === "12"
        ? '<a download="locked.ppt" href="https://mooc1.shu.edu.cn/locked">下载</a><a download="remaining.docx" href="https://mooc1.shu.edu.cn/remaining">下载</a>'
        : `<a download="${current}.pptx" href="https://mooc1.shu.edu.cn/${current}">下载</a>`;
  };
  refreshAttachments();
  // A blank placeholder must not require another script to reply.
  const emptyFrameDocument = documentFor("<body></body>");
  Object.defineProperty(
    staging.window.document.querySelector("iframe")!,
    "contentDocument",
    {
      get: () => {
        return emptyFrameDocument;
      },
    },
  );
  const visited: string[] = ["11"];
  for (const anchor of staging.window.document.querySelectorAll(
    'a[id^="cur"]',
  )) {
    anchor.addEventListener("click", () => {
      current = anchor.id.slice(3);
      visited.push(current);
      refreshAttachments();
      staging.window.document.querySelector("iframe")!.src =
        `https://mooc1.shu.edu.cn/cards?knowledgeid=${current}`;
    });
  }
  const create = root.window.document.createElement.bind(root.window.document);
  root.window.document.createElement = ((tag: string, ...args: any[]) => {
    const element = create(tag, ...args);
    if (tag === "iframe") {
      const source = {};
      Object.defineProperty(element, "contentDocument", {
        get: () => staging.window.document,
      });
      Object.defineProperty(element, "contentWindow", { get: () => source });
    }
    return element;
  }) as any;
  const blobs: Blob[] = [];
  const originalURL = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    blobs.push(blob as Blob);
    return "blob:fixture";
  };
  root.window.HTMLAnchorElement.prototype.click = function () {};
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    queueMicrotask(() =>
      details.onload({
        status: details.url.endsWith("/locked") ? 403 : 200,
        response: new Blob(["fixture-file"]),
        responseHeaders: "",
        finalUrl: details.url,
      }),
    );
    return { abort() {} };
  };
  try {
    new CourseDownloader();
    const button = root.window.document.querySelector<HTMLButtonElement>(
      "#xxt-course-batch button",
    )!;
    button.click();
    const end = Date.now() + 25000;
    while (button.disabled && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(button.disabled, false);
    assert.deepEqual(visited, ["11", "12", "13"]);
    assert.equal(blobs.length, 1);
    const files = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
    const report = JSON.parse(strFromU8(files["下载清单.json"]));
    assert.deepEqual(
      report.chapters.map((c: any) => c.status),
      ["成功", "失败", "成功"],
    );
    assert.ok(files["1.2 极限/remaining.docx"]);
    assert.equal(root.window.document.querySelector("iframe"), null);
  } finally {
    URL.createObjectURL = originalURL;
    root.window.close();
    staging.window.close();
  }
});

test("current-chapter test downloads the displayed DOM without opening a batch worker", async () => {
  const root = new JSDOM(
    '<title>数学</title><body><a id="cur11">1.1 函数</a><a id="cur12">1.2 极限</a><a download="讲义.pptx" href="https://mooc1.shu.edu.cn/file">下载</a></body>',
    { url: base },
  );
  Object.assign(globalThis, {
    window: root.window,
    document: root.window.document,
    location: root.window.location,
  });
  const blobs: Blob[] = [];
  const originalURL = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    blobs.push(blob as Blob);
    return "blob:fixture";
  };
  root.window.HTMLAnchorElement.prototype.click = function () {};
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    queueMicrotask(() =>
      details.onload({
        status: 200,
        response: new Blob(["file"]),
        responseHeaders: "",
      }),
    );
    return { abort() {} };
  };
  try {
    new CourseDownloader();
    const button = [
      ...root.window.document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent === "测试下载当前章节")!;
    button.click();
    const end = Date.now() + 3000;
    while (button.disabled && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(button.disabled, false);
    assert.equal(root.window.document.querySelector("iframe"), null);
    assert.equal(blobs.length, 1);
    const files = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
    const report = JSON.parse(strFromU8(files["下载清单.json"]));
    assert.equal(report.version, "0.4.5");
    assert.equal(report.chapters.length, 1);
    assert.equal(report.chapters[0].status, "成功");
    assert.ok(files["1.1 函数/讲义.pptx"]);
  } finally {
    URL.createObjectURL = originalURL;
    root.window.close();
  }
});
