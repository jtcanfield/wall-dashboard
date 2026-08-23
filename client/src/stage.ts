export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/**
 * Everything is laid out at a fixed 1920×1080 and scaled to fit the viewport,
 * so the dev laptop, the living room TV and the 40" wall panel are all
 * pixel-identical regardless of monitor size or Windows scaling.
 */
export function mountStageScaling(stage: HTMLElement): void {
  const fit = () => {
    // A viewport of zero — a hidden tab, or Chromium laying out before the TV
    // has finished coming up over DisplayPort — would otherwise bake in
    // scale(0) permanently, since nothing else fires a resize afterwards.
    if (innerWidth === 0 || innerHeight === 0) return;
    const scale = Math.min(innerWidth / STAGE_WIDTH, innerHeight / STAGE_HEIGHT);
    stage.style.transform = `scale(${scale})`;
  };

  addEventListener('resize', fit);
  // The TV powers on after the Wyse does, so re-measure on the events that
  // mark a display actually becoming visible.
  addEventListener('pageshow', fit);
  document.addEventListener('visibilitychange', fit);
  requestAnimationFrame(fit);
  fit();
}
