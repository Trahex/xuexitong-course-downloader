/** Collapse only the UI; the existing downloader and its controls stay mounted. */
export function makeCoursePanelCollapsible(panel: HTMLElement): void {
  const minimize = document.createElement("button");
  minimize.type = "button";
  minimize.textContent = "−";
  minimize.title = "最小化下载面板";
  minimize.setAttribute("aria-label", minimize.title);
  minimize.style.cssText =
    "position:absolute;right:10px;top:10px;width:28px;height:28px;padding:0;border:1px solid #ccc;border-radius:6px;background:white;color:#222;font:20px sans-serif;cursor:pointer";
  const title = panel.querySelector("strong");
  if (title) title.style.cssText = "display:block;padding-right:30px";

  const restore = document.createElement("button");
  restore.id = `${panel.id}-restore`;
  restore.type = "button";
  restore.textContent = "课程下载";
  restore.title = "展开下载面板";
  restore.setAttribute("aria-label", restore.title);
  restore.setAttribute("aria-controls", panel.id);
  restore.setAttribute("aria-expanded", "false");
  restore.style.cssText =
    "display:none;position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:white;color:#222;font:14px sans-serif;box-shadow:0 2px 8px #0002;cursor:pointer";
  minimize.onclick = () => {
    panel.style.display = "none";
    restore.style.display = "block";
    restore.focus();
  };
  restore.onclick = () => {
    panel.style.display = "";
    restore.style.display = "none";
    minimize.focus();
  };
  panel.append(minimize);
  panel.after(restore);
}
