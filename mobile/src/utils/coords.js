/**
 * Convert a tap location on the displayed image (in screen pixels) to the
 * original image's pixel coordinate system. The `<Image>` is rendered with
 * `resizeMode="contain"` so we need to account for letterboxing on either axis.
 */
export function viewToImageCoords(tap, view, image) {
  if (!view || !image || !image.width || !image.height) return tap;

  const viewAspect = view.width / view.height;
  const imgAspect = image.width / image.height;

  let displayedW;
  let displayedH;
  let offsetX = 0;
  let offsetY = 0;

  if (imgAspect > viewAspect) {
    // image is wider than view → fit width, letterbox top/bottom
    displayedW = view.width;
    displayedH = view.width / imgAspect;
    offsetY = (view.height - displayedH) / 2;
  } else {
    displayedH = view.height;
    displayedW = view.height * imgAspect;
    offsetX = (view.width - displayedW) / 2;
  }

  const xInDisplayed = tap.x - offsetX;
  const yInDisplayed = tap.y - offsetY;
  const scaleX = image.width / displayedW;
  const scaleY = image.height / displayedH;

  return {
    x: Math.max(0, Math.min(image.width, xInDisplayed * scaleX)),
    y: Math.max(0, Math.min(image.height, yInDisplayed * scaleY)),
  };
}

/**
 * Inverse of `viewToImageCoords` — used to draw markers/lines on the screen
 * for points stored in image-space.
 */
export function imageToViewCoords(point, view, image) {
  if (!view || !image || !image.width || !image.height) return point;

  const viewAspect = view.width / view.height;
  const imgAspect = image.width / image.height;

  let displayedW;
  let displayedH;
  let offsetX = 0;
  let offsetY = 0;

  if (imgAspect > viewAspect) {
    displayedW = view.width;
    displayedH = view.width / imgAspect;
    offsetY = (view.height - displayedH) / 2;
  } else {
    displayedH = view.height;
    displayedW = view.height * imgAspect;
    offsetX = (view.width - displayedW) / 2;
  }

  const scaleX = displayedW / image.width;
  const scaleY = displayedH / image.height;

  return {
    x: offsetX + point.x * scaleX,
    y: offsetY + point.y * scaleY,
  };
}
