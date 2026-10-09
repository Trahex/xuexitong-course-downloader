import { mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
mkdirSync("userscript", { recursive: true });
mkdirSync("downloads", { recursive: true });
copyFileSync("dist/tampermonkey/xuexitong-ppt-downloader.user.js", "userscript/xuexitong-course-downloader.user.js");
copyFileSync(`dist/extension/${pkg.name}.zip`, `downloads/${pkg.name}-${pkg.version}.zip`);
console.log("Updated userscript and extension downloads");
