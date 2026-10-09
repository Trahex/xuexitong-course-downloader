import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installCourseBridge, scanFrame } from "../src/core/course-bridge";

// Models the observed SHU screen/file -> pan-yz.chaoxing.com redirect.
// Use the real receiver and resource scanner, not fabricated resource replies.
test("redirect handshake reads 40 real DOM pages, retries late injection, and rejects foreign origins/sources", async () => {
  const parent = new JSDOM(
    '<body><iframe id="panView" src="https://mooc1.shu.edu.cn/mooc-ans/screen/file?objectid=fixture"></iframe></body>',
    { url: "https://mooc1.shu.edu.cn/ananas/modules/pdf/index.html" },
  );
  const child = new JSDOM(
    "<body>" +
      Array.from(
        { length: 40 },
        (_, i) =>
          `<li id="anchor${i + 1}"><img src="https://s3.cldisk.com/doc/fixture/thumb/${i + 1}.png"></li>`,
      ).join("") +
      "</body>",
    { url: "https://pan-yz.chaoxing.com/screen/v2/file_fixture" },
  );
  const frame = parent.window.document.querySelector("iframe")!;
  Object.assign(globalThis, {
    window: parent.window,
    document: parent.window.document,
    location: parent.window.location,
  });
  Object.defineProperty(child.window, "parent", { value: parent.window });
  Object.defineProperty(frame, "contentWindow", { value: child.window });
  Object.defineProperty(frame, "contentDocument", { value: null });
  const outbound: { kind: string; origin: string; name?: string }[] = [];
  parent.window.postMessage = ((message: any, origin: string) => {
    assert.equal(origin, parent.window.location.origin);
    queueMicrotask(() =>
      parent.window.dispatchEvent(
        new parent.window.MessageEvent("message", {
          source: child.window as any,
          origin: child.window.location.origin,
          data: message,
        }),
      ),
    );
  }) as any;
  child.window.postMessage = ((message: any, origin: string) => {
    outbound.push({ kind: message.kind, origin, name: message.name });
    if (message.kind === "probe") {
      // Neither an unrelated frame on an allowed origin nor an unapproved redirect may select the target origin.
      for (const [source, untrustedOrigin] of [
        [parent.window, "https://pan-yz.chaoxing.com"],
        [child.window, "https://evil.test"],
      ] as const)
        parent.window.dispatchEvent(
          new parent.window.MessageEvent("message", {
            source: source as any,
            origin: untrustedOrigin,
            data: { ...message, kind: "ready" },
          }),
        );
    }
    if (origin !== "*" && origin !== child.window.location.origin) return;
    queueMicrotask(() =>
      child.window.dispatchEvent(
        new child.window.MessageEvent("message", {
          source: parent.window as any,
          origin: parent.window.location.origin,
          data: message,
        }),
      ),
    );
  }) as any;
  const late = setTimeout(
    () => installCourseBridge(child.window as unknown as Window),
    550,
  );
  try {
    const packet = await scanFrame(
      frame,
      "第一章 函数的概念.pptx",
      new AbortController().signal,
      2500,
    );
    assert.deepEqual(packet.errors, []);
    assert.equal(packet.resources.length, 1);
    assert.equal(packet.resources[0].pages!.length, 40);
    assert.equal(packet.resources[0].name, "第一章 函数的概念.pptx");
    assert.ok(outbound.filter((m) => m.kind === "probe").length >= 2);
    assert.ok(
      outbound
        .filter((m) => m.kind === "probe")
        .every((m) => m.origin === "*" && m.name === undefined),
    );
    assert.ok(
      outbound
        .filter((m) => m.kind === "scan")
        .every((m) => m.origin === "https://pan-yz.chaoxing.com"),
    );
  } finally {
    clearTimeout(late);
    parent.window.close();
    child.window.close();
  }
});

test("missing receiver reports a sanitized frame address, stops promptly, and obeys cancellation", async () => {
  const dom = new JSDOM(
    '<body><iframe src="https://mooc1.shu.edu.cn/screen/file?enc=private&objectid=secret"></iframe></body>',
    { url: "https://mooc1.shu.edu.cn/mycourse/studentstudy" },
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
  });
  const frame = dom.window.document.querySelector("iframe")!;
  Object.defineProperty(frame, "contentDocument", { value: null });
  frame.contentWindow!.postMessage = () => {};
  try {
    await assert.rejects(
      scanFrame(frame, "test", new AbortController().signal, 30),
      (error) => {
        assert.match((error as Error).message, /框架未响应/);
        assert.ok(!(error as Error).message.includes("private"));
        assert.ok(!(error as Error).message.includes("secret"));
        return true;
      },
    );
    const abort = new AbortController();
    const pending = scanFrame(frame, "test", abort.signal, 1000);
    abort.abort();
    await assert.rejects(pending, /已停止/);
  } finally {
    dom.window.close();
  }
});
