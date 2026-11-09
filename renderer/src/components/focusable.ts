/** The first element in `root` a keyboard user could land on — shared by overlay.ts and popover.ts's focus-on-open. */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  // An ⓘ explanation button is never a useful place to start — landing on it
  // would open its tooltip the moment a dialog appears.
  return root.querySelector<HTMLElement>(
    'a[href], button:not([disabled]):not(.info-tip-btn), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
}
