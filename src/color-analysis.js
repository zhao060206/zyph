import { classifyPixels } from './tones.mjs';

export async function analyzeBlob(blob) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  let bitmap, url;
  try {
    if (window.createImageBitmap) {
      try { bitmap = await createImageBitmap(blob, { resizeWidth: 64, resizeHeight: 64 }); }
      catch (error) { bitmap = null; }
    }
    if (!bitmap) {
      url = URL.createObjectURL(blob);
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('无法分析图片色调'));
        img.src = url;
      });
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法分析图片色调');
    context.drawImage(bitmap, 0, 0, 64, 64);
    return classifyPixels(context.getImageData(0, 0, 64, 64).data);
  } finally {
    if (bitmap && bitmap.close) bitmap.close();
    if (url) URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
