// No generic network proxy: only GETs to course/preview hosts are accepted.
const requests = new Map();
function allowed(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (/(^|\.)chaoxing\.com$|(^|\.)cldisk\.com$/.test(url.hostname) ||
        ["mooc1.shu.edu.cn", "mooc2-ans.shu.edu.cn"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!sender.tab || !allowed(sender.url)) return;
  const key = `${sender.tab.id}:${sender.frameId}:${request.id}`;
  if (request.type === "GM_abort") {
    requests.get(key)?.abort();
    return;
  }
  if (request.type !== "GM_xmlhttpRequest") return;
  if (
    !allowed(request.details.url) ||
    !["GET", undefined].includes(request.details.method)
  ) {
    sendResponse({ error: "不支持的文件请求" });
    return;
  }
  const controller = new AbortController();
  requests.set(key, controller);
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(request.details.timeout || 60000, 120000),
  );
  fetch(request.details.url, {
    credentials: "include",
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!allowed(response.url)) throw new Error("文件重定向到不支持的站点");
      const buffer = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < buffer.length; offset += 32768) {
        binary += String.fromCharCode(
          ...buffer.subarray(offset, offset + 32768),
        );
      }
      const type =
        response.headers.get("content-type") || "application/octet-stream";
      sendResponse({
        status: response.status,
        statusText: response.statusText,
        response: `data:${type};base64,${btoa(binary)}`,
        finalUrl: response.url,
        responseHeaders: [...response.headers]
          .map(([name, value]) => `${name}: ${value}`)
          .join("\r\n"),
      });
    })
    .catch((error) =>
      sendResponse({
        error:
          error.name === "AbortError" ? "请求停止或超时" : "文件网络请求失败",
      }),
    )
    .finally(() => {
      clearTimeout(timer);
      requests.delete(key);
    });
  return true;
});
