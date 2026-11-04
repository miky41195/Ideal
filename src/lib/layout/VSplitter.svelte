<script lang="ts">
  // Vertical splitter: drag left/right to resize the panel on its left. Reports the new width.
  let { width, min = 160, max = 640, onresize }: { width: number; min?: number; max?: number; onresize: (w: number) => void } =
    $props();

  function down(e: PointerEvent) {
    const startX = e.clientX;
    const startW = width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onresize(Math.min(max, Math.max(min, startW + (ev.clientX - startX))));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }
</script>

<div class="vsplit" role="separator" aria-orientation="vertical" onpointerdown={down}></div>

<style>
  .vsplit {
    width: 4px;
    cursor: col-resize;
    background: var(--border);
    flex: none;
  }
  .vsplit:hover {
    background: var(--accent);
  }
</style>
