import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { mountCoursePanel, WORK_FRAME_NAME } from "../src/core/course-startup";

const outline =
  "https://mooc2-ans.shu.edu.cn/mooc2-ans/mycourse/stu?courseid=20";
const study =
  "https://mooc1.shu.edu.cn/mycourse/studentstudy?chapterId=11&courseId=20";
function bind(win: JSDOM["window"]) {
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
  });
}
test("chapter outline displays enabled panel and clicks the actual course control", () => {
  const dom = new JSDOM("<body><iframe></iframe></body>", { url: outline });
  bind(dom.window);
  const doc = dom.window.document.querySelector("iframe")!.contentDocument!;
  doc.body.innerHTML = "<a>1.1 函数的概念</a>";
  let clicks = 0;
  doc.querySelector("a")!.addEventListener("click", () => clicks++);
  mountCoursePanel();
  mountCoursePanel();
  assert.equal(
    dom.window.document.querySelectorAll("#xxt-course-outline").length,
    1,
  );
  dom.window.document
    .querySelector<HTMLButtonElement>("#xxt-course-outline button")!
    .click();
  assert.equal(clicks, 1);
  dom.window.close();
});
test("learning page displays ZIP button; a processing frame never displays a duplicate UI", () => {
  const dom = new JSDOM("<body></body>", { url: study });
  bind(dom.window);
  mountCoursePanel();
  assert.match(
    dom.window.document.querySelector("#xxt-course-batch")!.textContent!,
    /下载整门课程 ZIP/,
  );
  dom.window.document.body.innerHTML = "";
  dom.window.name = WORK_FRAME_NAME;
  mountCoursePanel();
  assert.equal(dom.window.document.querySelector("#xxt-course-batch"), null);
  dom.window.close();
});
test("an embedded learning page mounts the panel even when it is not the top window", () => {
  const dom = new JSDOM(`<body><iframe src="${study}"></iframe></body>`, {
    url: outline,
  });
  const child = dom.window.document.querySelector("iframe")!.contentWindow!;
  child.document.open();
  child.document.write("<!doctype html><html><body></body></html>");
  child.document.close();
  bind(child as unknown as JSDOM["window"]);
  assert.notEqual(child, child.top);
  mountCoursePanel();
  assert.ok(child.document.getElementById("xxt-course-batch"));
  dom.window.close();
});
test("the actual bundled userscript boots on both SHU directory and learning URLs", () => {
  const script = readFileSync(
    "dist/tampermonkey/xuexitong-ppt-downloader.user.js",
    "utf8",
  );
  assert.match(script, /@version\s+0\.4\.5/);
  assert.match(script, /@connect\s+cldisk\.com\s/);
  assert.match(script, /@connect\s+chaoxing\.com\s/);
  assert.ok(!/@connect\s+\*\./.test(script));
  for (const url of [outline, study]) {
    const dom = new JSDOM("<body></body>", { url, runScripts: "outside-only" });
    try {
      dom.window.eval(script);
      dom.window.document.dispatchEvent(
        new dom.window.Event("DOMContentLoaded"),
      );
      const id = url === study ? "xxt-course-batch" : "xxt-course-outline";
      assert.ok(
        dom.window.document.getElementById(id),
        `missing panel on ${url}`,
      );
    } finally {
      dom.window.close();
    }
  }
});
