"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

import { computeMenuPlacement, type MenuPlacement } from "@/lib/ui/menuPlacement";

interface CustomSelectOption {
  value: string;
  label: string;
  color?: string;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  /** Extra class on the portaled menu (it lives in document.body, so `className` can't style it). */
  menuClassName?: string;
  /** Tallest the menu may be before it scrolls internally. */
  maxMenuHeight?: number;
  color?: string;
  ariaLabel?: string;
}

interface MenuRect extends MenuPlacement {
  /** Horizontal centre of the trigger; the menu is centred on it. */
  left: number;
  top: number;
  bottom: number;
  width: number;
}

// Native <select> popups are rendered by the OS, not the page, so they ignore the app's dark
// theme on Windows/Chrome — a jarring light system list popping out of an otherwise fully
// styled dark card. This is a custom listbox so the open state matches the app.
//
// The menu is rendered through a portal into document.body rather than inline: an inline
// absolutely-positioned menu is still confined to its nearest ancestor stacking context, so
// once more than one of these sits in a scrolling list, whichever row comes later in the DOM
// paints over an earlier row's open menu regardless of z-index. Escaping to body sidesteps
// that entirely — position is computed from the trigger's own bounding rect instead.
// Exit transition length in ms — kept in one place since both the CSS (.custom-select-menu)
// and the unmount timer below need to agree on it.
const CLOSE_TRANSITION_MS = 130;

export default function CustomSelect({
  value,
  options,
  onChange,
  className = "",
  menuClassName = "",
  maxMenuHeight,
  color,
  ariaLabel,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  // Mounted a beat longer than `open` so the closing transition can play out before the
  // portaled menu leaves the DOM, rather than it just vanishing on click. `visible` is what
  // actually drives the CSS transition: it's flipped a frame after mount, so the browser
  // paints the collapsed starting state first and has something to transition from.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (open) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const placement = computeMenuPlacement({
          triggerTop: rect.top,
          triggerBottom: rect.bottom,
          viewportHeight: window.innerHeight,
          optionCount: options.length,
          maxMenuHeight,
        });
        setMenuRect({
          ...placement,
          left: rect.left + rect.width / 2,
          top: rect.bottom + 6,
          bottom: window.innerHeight - rect.top + 6,
          width: rect.width,
        });
      }
      setMounted(true);
    } else {
      setVisible(false);
      if (mounted) {
        closeTimerRef.current = setTimeout(() => setMounted(false), CLOSE_TRANSITION_MS);
      }
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mounted` intentionally excluded: including it would re-fire this on the very unmount it schedules; options/maxMenuHeight only matter at the moment of opening
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted]);

  // Once the menu is showing, bring the selected option into view and put keyboard focus on it. The menu is
  // scrolled directly (not with scrollIntoView, which could also scroll the page and close the menu).
  useEffect(() => {
    if (!visible) return;
    const menu = menuRef.current;
    const selectedOption = menu?.querySelector<HTMLElement>(".custom-select-option.is-selected");
    if (!menu || !selectedOption) return;
    menu.scrollTop = selectedOption.offsetTop - (menu.clientHeight - selectedOption.offsetHeight) / 2;
    selectedOption.focus({ preventScroll: true });
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const openedAtWidth = window.innerWidth;
    // The menu is portaled to document.body, so it's not a DOM descendant of rootRef — check
    // both, or every pointerdown on an option would register as "outside" and close the menu
    // before the option's own click handler fires.
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    // Reposition would need to track every ancestor scroll container; closing is simpler and matches how
    // native dropdowns behave when the page moves under them. But scroll events are captured from every
    // element, including this menu's own list: scrolling the options must NOT close the menu.
    const handleScroll = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      close();
    };
    // Mobile browsers fire `resize` as the address bar collapses while scrolling; only a width change
    // (rotation, window resize) invalidates the position.
    const handleResize = () => {
      if (window.innerWidth !== openedAtWidth) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const moveFocus = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".custom-select-option") ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const target =
      e.key === "ArrowDown" ? Math.min(current + 1, items.length - 1)
      : e.key === "ArrowUp" ? Math.max(current - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : -1;
    if (target === -1) return;
    e.preventDefault();
    items[target].focus({ preventScroll: true });
    // Keep the focused option inside the menu's own scroll area.
    const menu = menuRef.current;
    if (menu) {
      const item = items[target];
      if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop - 4;
      else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) {
        menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight + 4;
      }
    }
  };

  return (
    <div className={`custom-select-root ${className}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="custom-select"
        style={{ color }}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={13} className="custom-select-chevron" style={{ opacity: open ? 1 : 0.6 }} />
      </button>

      {mounted &&
        menuRect &&
        createPortal(
          <ul
            ref={menuRef}
            className={`custom-select-menu ${menuRect.placement === "above" ? "is-above" : ""} ${visible ? "is-visible" : ""} ${menuClassName}`}
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={moveFocus}
            style={{
              ...(menuRect.placement === "above" ? { bottom: menuRect.bottom } : { top: menuRect.top }),
              left: menuRect.left,
              minWidth: menuRect.width,
              maxHeight: menuRect.maxHeight,
            }}
          >
            {options.map((option) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  className={`custom-select-option ${option.value === value ? "is-selected" : ""}`}
                  style={{ color: option.color }}
                  onClick={() => {
                    onChange(option.value);
                    close();
                    buttonRef.current?.focus({ preventScroll: true });
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
