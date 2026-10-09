# 学习通课程文件批量下载器

**一次点击，下载整门课程的章节文件。** 优先保存网站开放的原文件；只有文档预览时，导出为 PDF，再按章节整理成 ZIP。

支持 Tampermonkey 油猴脚本和 Chrome / Edge 扩展。当前版本 **0.4.5**。

[安装油猴脚本](https://github.com/Trahex/xuexitong-course-downloader/raw/refs/heads/main/userscript/xuexitong-course-downloader.user.js) · [下载扩展安装包](https://github.com/Trahex/xuexitong-course-downloader/raw/refs/heads/main/downloads/xuexitong-course-downloader-0.4.5.zip) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/Trahex/xuexitong-course-downloader/issues)

## 功能

| 功能 | 使用效果 |
| --- | --- |
| 整课批量下载 | 遍历学习页目录中的章节，一次启动，自动处理 |
| 原文件优先 | 保存网站提供的 PPT / PPTX、PDF、Word、Excel、压缩包等附件 |
| 课件预览转 PDF | 原文件没有下载入口时，将可正常浏览的文档预览整理成 PDF |
| 按章节 ZIP 整理 | 自动建立章节目录，跳过重复资源，同名文件自动编号 |
| 大课程分卷 | 文件累计约 250 MB 时另存下一份 ZIP |
| 单章节测试 | 先测试当前章节，确认能下载后再启动整课任务 |
| 进度与下载清单 | 显示章节、页数或文件传输进度，记录成功、失败及未处理的章节 |
| 停止与失败重试 | 随时停止并保存已有文件，随后可重试失败章节 |
| 面板最小化 | 点右上角“−”收起，点“课程下载”恢复；下载继续运行 |

已适配上海大学 `mooc1.shu.edu.cn`、`mooc2-ans.shu.edu.cn`，以及超星 `*.chaoxing.com` 学习页。其他学校的页面结构可能不同，欢迎提供问题反馈。

## 快速开始

1. 在 Chrome 或 Edge 中安装 **Tampermonkey**。
2. 点击上方“安装油猴脚本”并安装。已有旧版时可完整替换脚本；避免同时启用多个下载脚本。
3. 正常登录学习通，进入课程的任意章节学习页。
4. 在右下角面板点击 **“测试下载当前章节”**，检查 ZIP 内的文件是否正常。
5. 点击 **“下载整门课程 ZIP”**，保持页面打开，等待浏览器保存 ZIP。

目录页会提供进入第一节的入口。收起面板不会停止下载；关闭或刷新页面会结束当前任务。正在下载时，请等任务结束后再更新脚本。

如果浏览器询问图片域名的连接权限，允许脚本访问页面中课件使用的超星 / cldisk 域名即可。

扩展版：下载上方 ZIP 并解压，在 Chrome / Edge 扩展管理页开启开发者模式，选择“加载已解压的扩展程序”。

## 下载结果

```text
课程文件_1.zip
├── 1.1 函数的概念/
│   └── 课件.pdf
├── 1.2 数列的极限/
│   └── 讲义.pptx
└── 下载清单.json
```

原文件可下载时保留原格式；预览导出得到 PDF。下载清单列出每一节的状态、文件路径和错误原因。部分章节失败时，已经下载的文件仍会保存。

## 常见问题

**为什么下载的是 PDF？** 页面只开放了课件阅读预览，没有提供原文件下载入口。脚本会将可访问的预览导出为 PDF。

**按钮没有显示？** 确认脚本已启用，并打开章节学习页，页面地址通常包含 `studentstudy`。更新后刷新页面。

**失败如何处理？** 先测试当前章节，查看 ZIP 中的下载清单。登录过期时重新登录；失败重试会生成新的 ZIP，需与之前的下载一起保留。连续三节出现框架或图片网络请求失败时，程序会停止，避免整课反复等待。

**整门课程包括哪些内容？** 指学习页目录中的已显示章节及其可访问的文件下载入口、文档预览。资料区、作业答案、直播、加密视频流、未开放章节，以及服务器没有提供的原文件不在范围内。课程内部另设子页、分页目录或隐藏附件时可能需要额外适配。

## 从源码构建

要求 **Node.js 22.22.2+**、**pnpm 10.27.0**。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

- 油猴构建文件：`dist/tampermonkey/xuexitong-ppt-downloader.user.js`。
- 扩展安装包：`dist/extension/xuexitong-course-downloader.zip`。解压后，在 Chrome / Edge 扩展管理页开启开发者模式，选择“加载已解压的扩展程序”。
- 更新仓库内可安装脚本与扩展包：运行 `pnpm publish:files`。

普通测试使用模拟页面和请求。两项可选联网测试需设置 `XXT_LIVE_IMAGE_URL` 为当前阅读器实际显示的预览图片地址；默认跳过，不包含账号或课程链接。

## 来源与许可证

基于 [hazuki-keatsu/xuexitong-ppt-downloader](https://github.com/hazuki-keatsu/xuexitong-ppt-downloader) 扩展，由 **Trahex** 维护课程批量下载版。新增整课遍历、资源读取、跨域框架握手、ZIP 整理、下载诊断和最小化面板等功能。

保留上游作者署名及 **MIT** 许可证，详见 [LICENSE](LICENSE)。使用时遵守课程访问权限：脚本不会绕过登录、未开放章节或下载权限限制。
