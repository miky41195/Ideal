/** Claude's spinner keeps output flowing while it works, so silence after a sent message means done or waiting. */
const QUIET_MS = 4000;
/** Quick replies are read as they arrive: no point in calling anyone back for them. */
const MIN_WORK_MS = 5000;

export class AttentionTracker {
  armed = false;
  #submitted = 0;
  #lastOutput = 0;

  onSubmit(now: number): void {
    this.armed = true;
    this.#submitted = now;
    this.#lastOutput = 0;
  }

  onOutput(now: number): void {
    if (this.armed) this.#lastOutput = now;
  }

  /** True once, when the work that followed a sent message has ended. */
  tick(now: number): boolean {
    if (!this.armed || !this.#lastOutput || now - this.#lastOutput < QUIET_MS) return false;
    this.armed = false;
    return this.#lastOutput - this.#submitted >= MIN_WORK_MS;
  }
}
