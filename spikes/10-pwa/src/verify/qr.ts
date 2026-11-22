/**
 * QR コードからバイト列を取り出す（jsQR。バイトモードの中身は binaryData に入る）。
 * カメラ（getUserMedia）と、QR を写した画像ファイルの両方に対応する。ネットは使わない。
 */
import jsQR from 'jsqr';

const decode = (img: ImageData): Uint8Array | undefined => {
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return code && code.binaryData.length ? Uint8Array.from(code.binaryData) : undefined;
};

export async function readQrFromImage(file: Blob): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const out = decode(ctx.getImageData(0, 0, bmp.width, bmp.height));
  if (!out) throw new Error('画像から QR コードを読み取れなかった');
  return out;
}

/** カメラ映像から QR を探し続ける。見つかったら onFound を呼んで止まる。戻り値で停止できる */
export async function scanQrFromCamera(video: HTMLVideoElement, onFound: (b: Uint8Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true'); // iPhone で全画面にしない
  await video.play();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let stopped = false;
  const stop = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const found = decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (found) { stop(); onFound(found); return; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return stop;
}
