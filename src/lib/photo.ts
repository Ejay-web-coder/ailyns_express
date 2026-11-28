/** Longest side of an uploaded proof photo, in pixels. Phone photos are 3000-4000px; this keeps them ~200-400 KB. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that photo. Please take it again."));
    };
    img.src = url;
  });
}

/**
 * Shrink a camera photo and stamp a caption (order number, time) along the bottom, so the picture
 * carries its own proof of when and for which order it was taken. Returns a JPEG.
 * Browsers apply the photo's EXIF rotation when drawing it, so portrait shots stay upright.
 */
export async function prepareProofPhoto(file: File, caption: string): Promise<Blob> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose a photo (JPEG or PNG).");
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device can't prepare photos.");
  ctx.drawImage(img, 0, 0, width, height);

  // Caption band: white text on a dark strip, sized to the photo.
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.032));
  const pad = Math.round(fontSize * 0.6);
  ctx.font = `600 ${fontSize}px "DM Sans", system-ui, sans-serif`;
  let text = caption;
  while (text.length > 8 && ctx.measureText(text).width > width - pad * 2) text = `${text.slice(0, -2)}…`;
  const band = fontSize + pad * 2;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, height - band, width, band);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, height - band / 2);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't prepare that photo. Please try again."))),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}
