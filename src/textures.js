/** Canvas-generated soft textures (glow, halo). No image assets required. */
export function makeRadialTexture({ size = 256, stops = [] } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** Soft halo ring used for shockwaves. */
export function makeRingTexture({ size = 256 } = {}) {
  return makeRadialTexture({
    size,
    stops: [
      [0, 'rgba(255, 220, 150, 0)'],
      [0.55, 'rgba(255, 220, 150, 0)'],
      [0.7, 'rgba(255, 236, 190, 0.5)'],
      [0.8, 'rgba(255, 190, 110, 0.8)'],
      [0.9, 'rgba(255, 140, 70, 0.22)'],
      [1, 'rgba(255, 120, 60, 0)'],
    ],
  });
}
