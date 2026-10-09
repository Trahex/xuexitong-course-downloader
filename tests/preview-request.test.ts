import test from "node:test";
import assert from "node:assert/strict";
import { requestPreviewImage } from "../src/utils/preview-request";
import { AccessError } from "../src/core/course-request";
const url = "https://s3.cldisk.com/doc/fixture/1.png?token=private";
const png = new Blob(
  [
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN4sAAAAASUVORK5CYII=",
      "base64",
    ),
  ],
  { type: "image/png" },
);
const originalFetch = globalThis.fetch;
function failGM() {
  throw new Error("GM should not be called");
}

test("CORS preview uses browser fetch without cookies or GM permissions and keeps image bytes", async () => {
  (globalThis as any).GM_xmlhttpRequest = failGM;
  globalThis.fetch = (async (actual, options) => {
    assert.equal(actual, url);
    assert.equal(options!.credentials, "omit");
    assert.equal(options!.mode, "cors");
    return new Response(png, { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(
      await (await requestPreviewImage(url)).arrayBuffer(),
      await png.arrayBuffer(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser network failure falls back to GM, but status and HTML denials do not trigger another route", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  let count = 0;
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    count++;
    queueMicrotask(() =>
      details.onload({ status: 200, response: png, finalUrl: url }),
    );
    return { abort() {} };
  };
  try {
    assert.equal((await requestPreviewImage(url)).size, png.size);
    assert.equal(count, 1);
    for (const [status, body] of [
      [401, png],
      [403, png],
      [200, new Blob(["<html>login</html>"], { type: "text/html" })],
    ] as const) {
      globalThis.fetch = async () => new Response(body, { status });
      await assert.rejects(requestPreviewImage(url), AccessError);
      assert.equal(count, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports GM error fields and host instead of object string or signed URL", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    queueMicrotask(() =>
      details.onerror({
        status: 0,
        statusText: "blocked",
        error: "not permitted " + url,
      }),
    );
    return { abort() {} };
  };
  try {
    await assert.rejects(requestPreviewImage(url), (error) => {
      const message = (error as Error).message;
      assert.match(message, /blocked/);
      assert.match(message, /s3\.cldisk\.com/);
      assert.ok(!message.includes("[object Object]"));
      assert.ok(!message.includes("private"));
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stop aborts active browser and GM requests; unsupported image addresses are rejected", async () => {
  let gmCalls = 0,
    gmAborts = 0;
  (globalThis as any).GM_xmlhttpRequest = () => {
    gmCalls++;
    return {
      abort() {
        gmAborts++;
      },
    };
  };
  globalThis.fetch = (_url, options) =>
    new Promise((_resolve, reject) =>
      options!.signal!.addEventListener("abort", () =>
        reject(new Error("aborted")),
      ),
    );
  try {
    const first = new AbortController();
    const browserPending = requestPreviewImage(url, first.signal);
    first.abort();
    await assert.rejects(browserPending, /已停止/);
    assert.equal(gmCalls, 0);
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    const second = new AbortController();
    const gmPending = requestPreviewImage(url, second.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    second.abort();
    await assert.rejects(gmPending, /已停止/);
    assert.equal(gmAborts, 1);
    await assert.rejects(
      requestPreviewImage("https://evil.test/image.png"),
      /不受支持/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("empty or foreign redirects cannot become PDF images", async () => {
  globalThis.fetch = async () => new Response(new Blob(), { status: 200 });
  (globalThis as any).GM_xmlhttpRequest = (details: any) => {
    queueMicrotask(() =>
      details.onload({
        status: 200,
        response: png,
        finalUrl: "https://evil.test/file",
      }),
    );
    return { abort() {} };
  };
  try {
    await assert.rejects(requestPreviewImage(url), /不支持的站点/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test(
  "live first slide downloads through production image helper",
  { skip: !process.env.XXT_LIVE_IMAGE_URL },
  async () => {
    (globalThis as any).GM_xmlhttpRequest = failGM;
    const result = await requestPreviewImage(process.env.XXT_LIVE_IMAGE_URL!);
    assert.equal(result.type, "image/png");
    assert.ok(result.size > 10000);
  },
);
