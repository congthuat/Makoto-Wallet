/** Recompute on each Tab: disclosure state and disabled controls can change. */
export function modalTabStops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(
    'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]',
  )].filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[hidden],[inert]")) return false;
    const style = getComputedStyle(element);
    if (style.visibility !== "visible" || !element.getClientRects().length) return false;
    // Browsers may still report rectangles for content inside closed details.
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === "DETAILS" && !ancestor.hasAttribute("open")) {
        const summary = ancestor.querySelector(":scope > summary");
        if (!summary?.contains(element)) return false;
      }
    }
    if (element.tagName === "SUMMARY") {
      const details = element.parentElement;
      if (details?.tagName !== "DETAILS" || details.querySelector(":scope > summary") !== element) return false;
    }
    return true;
  }).sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

/** Undefined leaves normal browser navigation (including disclosures) intact. */
export function modalWrapTarget<T>(stops: T[], active: T | null, backwards: boolean, panel: T): T | undefined {
  if (!stops.length) return panel;
  if (!stops.includes(active as T)) return backwards ? stops[stops.length - 1] : stops[0];
  if (backwards && active === stops[0]) return stops[stops.length - 1];
  if (!backwards && active === stops[stops.length - 1]) return stops[0];
  return undefined;
}
