import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import { unzipSync, strFromU8 } from "fflate";

// Run the delivered bundle with real image fetch and real jsPDF/ZIP output.
// Browser-only image decoding and worker delivery are adapted for Node.
test(
  "live bundled current-chapter path creates a PDF and ZIP from the actual first slide",
  { skip: !process.env.XXT_LIVE_IMAGE_URL },
  async () => {
    const dom = new JSDOM(
      '<title>fixture</title><body><a id="cur11">1.1 函数</a><li id="anchor1"><img></li></body>',
      {
        url: "https://mooc1.shu.edu.cn/mycourse/studentstudy?chapterId=11",
        runScripts: "outside-only",
      },
    );
    const win = dom.window;
    win.document.querySelector("img")!.src = process.env.XXT_LIVE_IMAGE_URL!;
    Object.assign(win, {
      Blob,
      fetch,
      AbortController,
      TextDecoder,
      GM_xmlhttpRequest() {
        throw new Error("browser image fetch should work");
      },
    });
    const blobs = new Map<string, Blob>();
    const saved: Blob[] = [];
    win.URL.createObjectURL = (blob: Blob) => {
      const key = "blob:" + blobs.size;
      blobs.set(key, blob);
      if (blob.type === "application/zip") saved.push(blob);
      return key;
    };
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function () {};
    (win as any).FileReader = class {
      result = "";
      onload?: () => void;
      onerror?: () => void;
      readAsDataURL(blob: Blob) {
        void blob
          .arrayBuffer()
          .then((buffer) => {
            this.result =
              "data:" +
              blob.type +
              ";base64," +
              Buffer.from(buffer).toString("base64");
            this.onload?.();
          })
          .catch(() => this.onerror?.());
      }
    };
    (win as any).Image = class {
      width = 0;
      height = 0;
      onload?: () => void;
      onerror?: () => void;
      set src(value: string) {
        const png = Buffer.from(value.split(",")[1], "base64");
        this.width = png.readUInt32BE(16);
        this.height = png.readUInt32BE(20);
        queueMicrotask(() => this.onload?.());
      }
    };
    (win as any).Worker = class {
      onmessage?: (e: any) => void;
      onerror?: (e: any) => void;
      terminated = false;
      context: any;
      ready: Promise<void>;
      constructor(url: string) {
        const self: any = {
          postMessage: (data: any) =>
            queueMicrotask(() => this.onmessage?.({ data })),
          close: () => {},
        };
        this.context = createContext({
          self,
          Blob,
          Uint8Array,
          ArrayBuffer,
          TextDecoder,
          TextEncoder,
          atob,
          btoa,
          console,
        });
        Object.assign(this.context, self);
        this.context.self = this.context;
        this.ready = blobs
          .get(url)!
          .text()
          .then((code) => {
            runInContext(code, this.context);
          });
      }
      postMessage(data: any) {
        void this.ready
          .then(() => {
            if (!this.terminated) this.context.self.onmessage({ data });
          })
          .catch((error) => this.onerror?.(error));
      }
      terminate() {
        this.terminated = true;
      }
    };
    try {
      win.eval(
        readFileSync(
          "dist/tampermonkey/xuexitong-ppt-downloader.user.js",
          "utf-8",
        ),
      );
      win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
      const button = [
        ...win.document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((b) => b.textContent === "测试下载当前章节")!;
      assert.ok(button);
      button.click();
      const end = Date.now() + 15000;
      while (button.disabled && Date.now() < end)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(
        button.disabled,
        false,
        win.document.querySelector("#xxt-course-batch")!.textContent!,
      );
      assert.equal(saved.length, 1);
      const files = unzipSync(new Uint8Array(await saved[0].arrayBuffer()));
      const report = JSON.parse(strFromU8(files["下载清单.json"]));
      assert.equal(report.chapters[0].status, "成功", report.chapters[0].error);
      const pdf = files[report.chapters[0].files[0]];
      assert.ok(Buffer.from(pdf).subarray(0, 5).toString() === "%PDF-");
      assert.match(Buffer.from(pdf).toString("latin1"), /\/Count 1/);
      assert.ok(pdf.length > 10000);
    } finally {
      win.close();
    }
  },
);
