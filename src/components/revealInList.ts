/**
 * Scrolls a list so `item` is in view, moving only the list itself.
 * (scrollIntoView would also scroll the page, which on a phone pulls the
 * board off the screen every time a move is added below it.)
 */
export function revealInList(item: HTMLElement | null) {
  if (!item) return;
  let list = item.parentElement;
  while (list && !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) list = list.parentElement;
  if (!list || list === document.body || list === document.documentElement) return;
  const r = item.getBoundingClientRect();
  const box = list.getBoundingClientRect();
  if (r.top < box.top) list.scrollTop -= box.top - r.top;
  else if (r.bottom > box.bottom) list.scrollTop += Math.min(r.bottom - box.bottom, r.top - box.top);
}
