import type { MemObservation, MemSummary } from './hub-client';

export function observationMarkdown(o: MemObservation): string {
  const out = [`# ${o.title}`];
  if (o.subtitle) out.push(`*${o.subtitle}*`);
  if (o.narrative) out.push(o.narrative);
  if (o.facts.length) out.push('## Fatti\n' + o.facts.map((f) => `- ${f}`).join('\n'));
  if (o.filesModified.length) out.push('## File\n' + o.filesModified.map((f) => `- \`${f}\``).join('\n'));
  return out.join('\n\n');
}

export function summaryMarkdown(s: MemSummary): string {
  const out = [`# ${s.request ?? 'Riepilogo'}`];
  const part = (h: string, v: string | null) => {
    if (v) out.push(`## ${h}\n${v}`);
  };
  part('Indagato', s.investigated);
  part('Appreso', s.learned);
  part('Completato', s.completed);
  part('Prossimi passi', s.nextSteps);
  return out.join('\n\n');
}
