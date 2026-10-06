/** Where a dropdown menu should open relative to its trigger so that it always fits inside the viewport. */

export interface MenuPlacementInput {
  /** Trigger's top and bottom edges in viewport coordinates (getBoundingClientRect). */
  triggerTop: number;
  triggerBottom: number;
  viewportHeight: number;
  optionCount: number;
  /** Tallest the menu may be before it scrolls internally. */
  maxMenuHeight?: number;
  optionHeight?: number;
}

export interface MenuPlacement {
  placement: "below" | "above";
  /** The menu scrolls inside this height; never taller than the space it was given. */
  maxHeight: number;
}

const GAP = 6; // between trigger and menu
const VIEWPORT_MARGIN = 12; // keep clear of the screen edge
const MIN_HEIGHT = 96; // always room for a few options, even on a very short screen

export function computeMenuPlacement({
  triggerTop,
  triggerBottom,
  viewportHeight,
  optionCount,
  maxMenuHeight = 220,
  optionHeight = 36,
}: MenuPlacementInput): MenuPlacement {
  const contentHeight = optionCount * optionHeight + 8;
  const wanted = Math.min(maxMenuHeight, contentHeight);
  const spaceBelow = viewportHeight - triggerBottom - GAP - VIEWPORT_MARGIN;
  const spaceAbove = triggerTop - GAP - VIEWPORT_MARGIN;

  // Prefer opening downward; flip up only when it doesn't fit below and there is more room above.
  const placement = spaceBelow >= wanted || spaceBelow >= spaceAbove ? "below" : "above";
  const space = placement === "below" ? spaceBelow : spaceAbove;

  return { placement, maxHeight: Math.max(MIN_HEIGHT, Math.min(maxMenuHeight, space)) };
}
