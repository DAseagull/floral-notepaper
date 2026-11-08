export function fitPinSize(
  width: number,
  height: number,
  scale: number,
  maxWidth: number,
  maxHeight: number,
) {
  if (
    ![width, height, scale, maxWidth, maxHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error("无效的图片尺寸");
  }
  const factor = Math.min(Math.max(scale, 0.05), maxWidth / width, maxHeight / height, 4);
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}
