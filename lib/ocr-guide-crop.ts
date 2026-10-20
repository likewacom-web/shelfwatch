export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Maps the on-screen guide frame of the label camera to a crop rectangle in the captured photo.
 * The camera preview fills the screen like `resizeMode: cover`, so the photo is scaled by
 * max(screenW / photoW, screenH / photoH) and centred. Generous padding is added so small
 * differences between preview and photo framing never cut the product name off.
 */
export function computeGuideCrop(photoWidth: number, photoHeight: number, screen: Rect, frame: Rect | null): Rect {
  const full = { x: 0, y: 0, width: photoWidth, height: photoHeight };
  if (!(photoWidth > 0 && photoHeight > 0)) return full;

  let target: Rect;
  if (frame && screen.width > 0 && screen.height > 0 && frame.width > 0 && frame.height > 0) {
    const scale = Math.max(screen.width / photoWidth, screen.height / photoHeight);
    const offsetX = (screen.width - photoWidth * scale) / 2;
    const offsetY = (screen.height - photoHeight * scale) / 2;
    const frameX = frame.x - screen.x;
    const frameY = frame.y - screen.y;
    target = {
      x: (frameX - offsetX) / scale,
      y: (frameY - offsetY) / scale,
      width: frame.width / scale,
      height: frame.height / scale,
    };
  } else {
    // No measurement: use the middle band of the photo.
    target = { x: photoWidth * 0.1, y: photoHeight * 0.3, width: photoWidth * 0.8, height: photoHeight * 0.4 };
  }

  const padX = target.width * 0.08;
  const padY = target.height * 0.6;
  const x = Math.max(0, Math.floor(target.x - padX));
  const y = Math.max(0, Math.floor(target.y - padY));
  const right = Math.min(photoWidth, Math.ceil(target.x + target.width + padX));
  const bottom = Math.min(photoHeight, Math.ceil(target.y + target.height + padY));
  if (right - x < 32 || bottom - y < 32) return full;
  return { x, y, width: right - x, height: bottom - y };
}
