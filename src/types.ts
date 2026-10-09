/**
 * PPT 信息接口
 */
export interface PPTInfo {
  baseUrl: string;
  pageCount: number;
  fileName: string;
  /** Explicit DOM image addresses, including query strings and non-PNG pages. */
  pageUrls?: string[];
}

/**
 * 图片信息接口
 */
export interface ImageInfo {
  url: string;
  width: number;
  height: number;
}
