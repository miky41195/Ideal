import type { TranscriptEntry, TranscriptPage } from './hub-client';

export type ReadPage = (offset: number, limit: number) => Promise<TranscriptPage>;

/** Pages a transcript; `reset` switches source and discards in-flight responses of the previous one. */
export class TranscriptPager {
  entries: TranscriptEntry[] = [];
  total = 0;
  loading = false;
  error: string | null = null;
  private token = 0;

  constructor(
    private read: ReadPage,
    private onChange: () => void = () => {},
    private limit = 100,
  ) {}

  reset(read: ReadPage): void {
    this.token++;
    this.read = read;
    this.entries = [];
    this.total = 0;
    this.loading = false;
    this.error = null;
    this.onChange();
  }

  async more(): Promise<void> {
    if (this.loading) return;
    const tok = this.token;
    this.loading = true;
    this.onChange();
    try {
      const page = await this.read(this.entries.length, this.limit);
      if (tok !== this.token) return;
      this.entries = [...this.entries, ...page.entries];
      this.total = page.total;
      this.error = null;
    } catch (e) {
      if (tok === this.token) this.error = String(e);
    } finally {
      if (tok === this.token) {
        this.loading = false;
        this.onChange();
      }
    }
  }
}
