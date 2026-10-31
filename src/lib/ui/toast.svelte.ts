export interface Toast {
  id: number;
  text: string;
}

class Toasts {
  items = $state<Toast[]>([]);
}
export const toasts = new Toasts();

let counter = 0;

export function showToast(text: string, ms = 6000): void {
  if (toasts.items.some((t) => t.text === text)) return;
  const id = ++counter;
  toasts.items.push({ id, text });
  setTimeout(() => {
    toasts.items = toasts.items.filter((t) => t.id !== id);
  }, ms);
}
