import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { safeName } from "./course-model";

/** Split archives at 250 MB to bound the amount retained in the browser. */
export class CourseArchive {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private size = 0;
  private count = 0;
  private part = 1;
  private paths = new Set<string>();
  private zip: Zip;
  constructor(
    private course: string,
    private save: (blob: Blob, name: string) => void,
    private limit = 250 * 1024 * 1024,
  ) {
    this.zip = this.create();
  }
  private create(): Zip {
    return new Zip((error, data) => {
      if (error) throw error;
      this.chunks.push(new Uint8Array(data));
    });
  }
  async add(folder: string, name: string, blob: Blob): Promise<string> {
    if (this.size && this.size + blob.size > this.limit) this.flush();
    const base = `${safeName(folder)}/${safeName(name)}`;
    let path = base;
    let suffix = 2;
    while (this.paths.has(path)) {
      const match = base.match(/^(.*?)(\.[^./]+)?$/)!;
      path = `${match[1]} (${suffix++})${match[2] || ""}`;
    }
    this.paths.add(path);
    const file = new ZipPassThrough(path);
    this.zip.add(file);
    file.push(new Uint8Array(await blob.arrayBuffer()), true);
    this.size += blob.size;
    this.count++;
    return path;
  }
  finish(report: unknown): void {
    const file = new ZipPassThrough("下载清单.json");
    this.zip.add(file);
    file.push(strToU8(JSON.stringify(report, null, 2)), true);
    this.count++;
    this.flush();
  }
  private flush(): void {
    if (!this.count) return;
    this.zip.end();
    this.save(
      new Blob(this.chunks, { type: "application/zip" }),
      `${safeName(this.course)}_课程文件_${this.part++}.zip`,
    );
    this.chunks = [];
    this.size = 0;
    this.count = 0;
    this.zip = this.create();
  }
}
