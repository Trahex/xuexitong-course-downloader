export interface Chapter {
  id: string;
  title: string;
  element: HTMLElement;
}

export interface CourseResource {
  name: string;
  url?: string;
  pages?: string[];
  key: string;
}

export function allowedURL(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    const host = url.hostname;
    return url.protocol === "https:" &&
      (host === "chaoxing.com" ||
        host.endsWith(".chaoxing.com") ||
        host === "cldisk.com" ||
        host.endsWith(".cldisk.com") ||
        ["mooc1.shu.edu.cn", "mooc2-ans.shu.edu.cn"].includes(host))
      ? url
      : null;
  } catch (_) {
    return null;
  }
}

export function safeName(value: string): string {
  const name = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 150);
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    ? `_${name || "未命名"}`
    : name;
}

/** Use the site's actual chapter controls; never construct signed chapter URLs. */
export function discoverChapters(doc: Document): Chapter[] {
  const result = new Map<string, Chapter>();
  const selector =
    '[id^="cur"], [onclick*="getTeacherAjax"], [onclick*="openChapter"], a[href*="chapterId="], a[href*="chapterid="]';
  for (const element of doc.querySelectorAll<HTMLElement>(selector)) {
    const onclick = element.getAttribute("onclick") || "";
    const href = element.getAttribute("href") || "";
    const url = href ? allowedURL(href, doc.URL) : null;
    const id =
      element.id.match(/^cur(\d+)$/)?.[1] ||
      url?.searchParams.get("chapterId") ||
      url?.searchParams.get("chapterid") ||
      // getTeacherAjax(courseId, clazzId, chapterId, ...)
      onclick.match(
        /getTeacherAjax\(\s*['"]?\d+['"]?\s*,\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)/,
      )?.[1];
    const title = (element.getAttribute("title") || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (id && title && !result.has(id)) result.set(id, { id, title, element });
  }
  return [...result.values()];
}

/** Only advertised file links and already rendered preview pages are collected. */
export function readResources(
  doc: Document,
  fallbackName = "课件",
): CourseResource[] {
  const resources: CourseResource[] = [];
  const seen = new Set<string>();
  for (const anchor of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = allowedURL(anchor.getAttribute("href") || "", doc.URL);
    if (
      !url ||
      anchor.getAttribute("aria-disabled") === "true" ||
      anchor.classList.contains("disabled")
    )
      continue;
    const text = anchor.textContent?.trim() || "";
    if (
      !(
        anchor.id === "downloadUrl" ||
        anchor.hasAttribute("download") ||
        /\.(pptx?|pdf|docx?|xlsx?|zip|rar|7z|txt|csv|mp[34]|wav|png|jpe?g)(?:$|[?#])/i.test(
          url.href,
        ) ||
        /^(下载|下载附件|下载原文件|下载文件)$/.test(text)
      )
    )
      continue;
    const name =
      anchor.getAttribute("download") ||
      doc.querySelector<HTMLInputElement>("#fileInfoNameInput")?.value ||
      (/\.[a-z0-9]{1,6}$/i.test(text) ? text : "") ||
      fallbackName;
    if (!seen.has(url.href)) {
      seen.add(url.href);
      resources.push({ name, url: url.href, key: url.href });
    }
  }
  const images = [
    ...doc.querySelectorAll<HTMLImageElement>('li[id^="anchor"] img'),
  ];
  if (images.length) {
    const pages = images.map(
      (img) =>
        allowedURL(
          img.getAttribute("data-src") ||
            img.getAttribute("data-original") ||
            img.getAttribute("src") ||
            "",
          doc.URL,
        )?.href,
    );
    if (pages.some((url) => !url))
      throw new Error("课件预览有缺失页或不支持的图片地址");
    const name =
      doc.querySelector<HTMLInputElement>("#fileInfoNameInput")?.value ||
      fallbackName;
    resources.push({ name, pages: pages as string[], key: pages[0]! });
  }
  return resources;
}

export function permissionProblem(doc: Document): string | null {
  const text = (doc.body?.innerText || doc.body?.textContent || "").slice(
    0,
    20000,
  );
  if (
    doc.querySelector('input[type="password"]') ||
    /请先登录|登录已过期|登录失效|重新登录/.test(text)
  )
    return "需要登录，请登录后重新开始";
  if (/无权访问|没有权限|暂无权限|章节未开放|该章节尚未开放/.test(text))
    return "章节没有访问权限或尚未开放";
  return null;
}
