import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let uploadDir: string;

/** 确保 uploads 目录存在，返回绝对路径 */
export function ensureUploadDir(): string {
  if (!uploadDir) {
    uploadDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
}

export const UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 保存图片 base64（支持 data: URL 或纯 base64）到 uploads/，返回可访问的 URL。
 * 限制：≤2MB，仅常见图片后缀。
 */
export function saveBase64Image(base64: string, ext = '.png'): string {
  const match = /^data:(image\/[a-z.+-]+);base64,(.*)$/s.exec(base64);
  const mime = match ? match[1] : 'image/png';
  const data = match ? match[2] : base64;

  const buf = Buffer.from(data, 'base64');
  if (buf.length === 0) throw new Error('图片数据为空');
  if (buf.length > UPLOAD_MAX_BYTES) throw new Error('图片不能超过 2MB');

  const cleanExt = mime.split('/')[1]?.split('+')[0] || ext.slice(1);
  const finalExt = UPLOAD_EXT.has(`.${cleanExt}`) ? `.${cleanExt}` : '.png';
  const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${finalExt}`;
  fs.writeFileSync(path.join(ensureUploadDir(), file), buf);
  return `/uploads/${file}`;
}
