import { settings } from '../settings/settings.svelte';
import { tabs } from '../editor/tabs.svelte';
import { debounce } from '../terminal/activity';
import * as c from './hub-client';
import { health } from './health.svelte';

export type Section = 'sessions' | 'observations' | 'summaries' | 'memories' | 'docs';
const PAGE = 30;

const emptyFlags = (): Record<Section, boolean> => ({ sessions: false, observations: false, summaries: false, memories: false, docs: false });
const emptyErrors = (): Record<Section, string | null> => ({ sessions: null, observations: null, summaries: null, memories: null, docs: null });

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export class HubState {
  projectPath = $state('');
  sessions = $state<c.SessionMeta[]>([]);
  observations = $state<c.MemObservation[]>([]);
  summaries = $state<c.MemSummary[]>([]);
  memories = $state<c.MdFile[]>([]);
  docs = $state<c.MdFile[]>([]);
  hasMoreObservations = $state(false);
  loading = $state<Record<Section, boolean>>(emptyFlags());
  error = $state<Record<Section, string | null>>(emptyErrors());
  memStatus = $state<'unknown' | 'up' | 'down'>('unknown');
  query = $state('');
  searchError = $state<string | null>(null);

  private activity = debounce(() => {
    // Single source of truth for the worker is health.mem: skip claude-mem sections unless it is up.
    void this.refresh('sessions');
    void this.refresh('memories');
    void this.refresh('docs');
    if (health.mem === 'up') {
      void this.refresh('observations');
      void this.refresh('summaries');
    }
  }, 2000);

  private get port(): number {
    return settings.value.claudeMem.port;
  }
  private get project(): string {
    return baseName(this.projectPath);
  }

  get filteredSessions(): c.SessionMeta[] {
    return this.filter(this.sessions, (s) => s.title);
  }
  get filteredMemories(): c.MdFile[] {
    return this.filter(this.memories, (f) => f.name);
  }
  get filteredDocs(): c.MdFile[] {
    return this.filter(this.docs, (f) => f.name);
  }

  private filter<T>(items: T[], title: (t: T) => string): T[] {
    const q = this.query.trim().toLowerCase();
    return q ? items.filter((i) => title(i).toLowerCase().includes(q)) : items;
  }

  private async load(section: Section, fn: () => Promise<void>): Promise<void> {
    this.loading[section] = true;
    try {
      await fn();
      this.error[section] = null;
    } catch (e) {
      this.error[section] = String(e);
    } finally {
      this.loading[section] = false;
    }
  }

  async refresh(section?: Section): Promise<void> {
    if (!this.projectPath) return;
    const p = this.projectPath;
    const want = (s: Section) => !section || section === s;
    const jobs: Promise<void>[] = [];
    if (want('sessions')) jobs.push(this.load('sessions', async () => void (this.sessions = await c.sessionsList(p))));
    if (want('memories')) jobs.push(this.load('memories', async () => void (this.memories = await c.memoriesList(p))));
    if (want('docs')) jobs.push(this.load('docs', async () => void (this.docs = await c.docsList(p))));
    if (want('observations') || want('summaries')) {
      jobs.push(
        (async () => {
          if (health.mem === 'up') this.memStatus = 'up';
          else {
            try {
              this.memStatus = (await c.memHealth(this.port)) ? 'up' : 'down';
            } catch {
              this.memStatus = 'down';
            }
          }
          const sub: Promise<void>[] = [];
          if (want('observations'))
            sub.push(
              this.load('observations', async () => {
                const r = await c.memObservations(this.port, this.project, 0, PAGE);
                this.observations = r.items;
                this.hasMoreObservations = r.hasMore;
              }),
            );
          if (want('summaries'))
            sub.push(this.load('summaries', async () => void (this.summaries = (await c.memSummaries(this.port, this.project, 0, PAGE)).items)));
          await Promise.all(sub);
        })(),
      );
    }
    await Promise.all(jobs);
  }

  async loadMoreObservations(): Promise<void> {
    await this.load('observations', async () => {
      const r = await c.memObservations(this.port, this.project, this.observations.length, PAGE);
      this.observations = [...this.observations, ...r.items];
      this.hasMoreObservations = r.hasMore;
    });
  }

  /** Filters sessions/memories/docs by title (see filtered*) and asks claude-mem, showing the result as a doc tab. */
  async search(q: string): Promise<void> {
    this.query = q;
    this.searchError = null;
    const t = q.trim();
    if (!t) return;
    try {
      const md = await c.memSearch(this.port, this.project, t);
      tabs.openDoc(`search:${t}`, `Ricerca claude-mem: ${t}`, md);
    } catch (e) {
      this.searchError = String(e);
    }
  }

  /** Terminal went idle: refresh once, 2 s after the last call. */
  refreshOnActivity(): void {
    this.activity();
  }

  cancelActivity(): void {
    this.activity.cancel();
  }
}

export const hub = new HubState();
