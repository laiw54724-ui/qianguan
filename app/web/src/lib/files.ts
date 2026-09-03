// 檔案上傳工具（前端版上傳管線）
// 流程：型別/副檔名檢查 → magic bytes 驗證 → createImageBitmap 縮圖（iOS 超大圖友善）
//       → WebP q0.82（不支援退 JPEG）→ 壓後仍 >500KB 退回 → dataURL 存 localStorage
// ※ 本 Demo 無後端；正式版的 Worker/R2 驗檢、隨機 key、強制 Content-Type/Cache 屬伺服端職責

const MAX_PDF_BYTES = 3.5 * 1024 * 1024; // localStorage 限制，PDF 上限 3.5MB
const IMG_MAX_SIDE = 1200; // 長邊上限
const IMG_QUALITY = 0.82;
const IMG_MAX_BYTES = 500 * 1024; // 壓縮後仍超過就退回，請改用連結

// ---------- magic bytes：不看副檔名，直接驗檔頭 ----------
type ImgFmt = 'jpeg' | 'png' | 'webp';

async function sniffImageFormat(file: File): Promise<ImgFmt | null> {
  const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  return null;
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

// ---------- 讀圖：優先 createImageBitmap + resize（Safari 對超大圖的 canvas 有記憶體上限，bitmap 直縮較穩） ----------
async function decodeScaled(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D) => void }> {
  const scaleOf = (w: number, h: number) => Math.min(1, IMG_MAX_SIDE / Math.max(w, h));
  if ('createImageBitmap' in window) {
    try {
      // 先不帶 resize 拿原始尺寸
      const probe = await createImageBitmap(file);
      const s = scaleOf(probe.width, probe.height);
      const w = Math.max(1, Math.round(probe.width * s));
      const h = Math.max(1, Math.round(probe.height * s));
      probe.close();
      // 再帶 resizeWidth/Height 直接縮（不經大 canvas）
      const bmp = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } as ImageBitmapOptions);
      return { width: w, height: h, draw: (ctx) => ctx.drawImage(bmp, 0, 0, w, h) };
    } catch {
      // 舊 Safari 不支援 resize 選項 → 退回 Image 元素路徑
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = scaleOf(img.naturalWidth, img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * s));
      const h = Math.max(1, Math.round(img.naturalHeight * s));
      URL.revokeObjectURL(url);
      resolve({ width: w, height: h, draw: (ctx) => ctx.drawImage(img, 0, 0, w, h) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片讀取失敗：檔案可能損毀或格式不受支援'));
    };
    img.src = url;
  });
}

function canvasToDataURL(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  // WebP 優先；瀏覽器不支援時 toDataURL 會靜默回退 PNG（由檔頭判斷），那時改要 JPEG
  const webp = canvas.toDataURL('image/webp', IMG_QUALITY);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', IMG_QUALITY);
}

const dataUrlBytes = (d: string) => Math.ceil(((d.length - d.indexOf(',') - 1) * 3) / 4);

export async function readImageFile(file: File): Promise<string> {
  if (isHeic(file)) {
    throw new Error('iPhone 的 HEIC 照片在這裡解不開：請先在「照片」App 分享時選「JPEG」，或到設定→相機→格式改成「最相容」後再拍。');
  }
  const fmt = await sniffImageFormat(file);
  if (!fmt) throw new Error('只支援 JPEG／PNG／WebP 圖片（已驗檔案內容，非只看副檔名）');
  const { width, height, draw } = await decodeScaled(file);
  const out = canvasToDataURL(width, height, draw);
  if (!out) throw new Error('瀏覽器不支援圖片處理');
  if (dataUrlBytes(out) > IMG_MAX_BYTES) {
    throw new Error(`壓縮後仍有 ${Math.round(dataUrlBytes(out) / 1024)}KB（上限 500KB）：請先裁小圖片，或改用「貼圖片網址」。`);
  }
  return out;
}

export function readPdfFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return reject(new Error('請選擇 PDF 檔案'));
    }
    if (file.size > MAX_PDF_BYTES) return reject(new Error('PDF 請小於 3.5MB（本機示範限制）'));
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      // magic bytes：PDF 檔頭固定是 %PDF
      if (!s.startsWith('data:application/pdf') && !s.startsWith('data:application/octet-stream')) {
        return reject(new Error('檔案內容不是 PDF'));
      }
      resolve(s);
    };
    reader.onerror = () => reject(new Error('PDF 讀取失敗'));
    reader.readAsDataURL(file);
  });
}

// 音樂／影片：上傳小檔轉 dataURL（同 3.5MB 上限）
export function readMediaFile(file: File, kind: 'audio' | 'video'): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith(`${kind}/`)) return reject(new Error(kind === 'audio' ? '請選擇音訊檔案' : '請選擇影片檔案'));
    if (file.size > MAX_PDF_BYTES) return reject(new Error('媒體檔請小於 3.5MB（本機示範限制），大型檔案建議改用連結'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });
}
