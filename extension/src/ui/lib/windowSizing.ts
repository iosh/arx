import { ARX_UI_INNER_SIZE } from "@/ui/lib/uiWindow";

/**
 * `browser.windows.create({ width/height })` uses the outer window size, so the
 * content area can be smaller depending on OS/WM window decorations.
 *
 * Resize by the measured delta to reach a target content-area size.
 */
export const adjustWindowInnerSize = (target = ARX_UI_INNER_SIZE) => {
  try {
    const missingWidth = target.width - window.innerWidth;
    const missingHeight = target.height - window.innerHeight;

    if (missingWidth !== 0 || missingHeight !== 0) {
      window.resizeBy(missingWidth, missingHeight);
    }
  } catch {
    // Some extension surfaces may disallow resizing.
  }
};
