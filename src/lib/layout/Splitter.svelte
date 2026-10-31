<script lang="ts">
  // Horizontal splitter: drag up/down to resize the panel below. Reports new height.
  let { height, onresize }: { height: number; onresize: (h: number) => void } = $props();

  function down(e: PointerEvent) {
    const startY = e.clientY;
    const startH = height;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onresize(Math.min(600, Math.max(80, startH + (startY - ev.clientY))));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }
</script>

<div class="split" role="separator" aria-orientation="horizontal" onpointerdown={down}></div>

<style>
  .split {
    height: 4px;
    cursor: row-resize;
    background: var(--border);
    flex: none;
  }
  .split:hover {
    background: var(--accent);
  }
</style>
