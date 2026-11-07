// Builds a signed release and publishes it on GitHub, where installed copies of Ideal look for updates.
// Usage: node scripts/release.mjs "What changed"   (bump the version in tauri.conf.json, Cargo.toml, package.json first)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO = 'miky41195/Ideal';
const notes = process.argv[2];
if (!notes) throw new Error('Pass the release notes: node scripts/release.mjs "What changed"');

const key = join(homedir(), '.tauri', 'ideal.key');
if (!existsSync(key)) throw new Error(`Signing key missing: ${key} (without it, installed copies cannot verify updates)`);
const { version } = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const tag = `v${version}`;
const gh = existsSync('C:/Program Files/GitHub CLI/gh.exe') ? 'C:/Program Files/GitHub CLI/gh.exe' : 'gh';
const run = (cmd, args, env) => execFileSync(cmd, args, { stdio: 'inherit', shell: cmd === 'npm', env: { ...process.env, ...env } });

run('npm', ['run', 'tauri', 'build'], { TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' });

const bundle = 'src-tauri/target/release/bundle';
const setup = `${bundle}/nsis/Ideal_${version}_x64-setup.exe`;
const msi = `${bundle}/msi/Ideal_${version}_x64_en-US.msi`;
const latest = `${bundle}/latest.json`;
writeFileSync(
  latest,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        'windows-x86_64': {
          signature: readFileSync(`${setup}.sig`, 'utf8').trim(),
          url: `https://github.com/${REPO}/releases/download/${tag}/Ideal_${version}_x64-setup.exe`,
        },
      },
    },
    null,
    2,
  ),
);

run(gh, ['release', 'create', tag, setup, `${setup}.sig`, msi, latest, '--repo', REPO, '--title', `Ideal ${version}`, '--notes', notes]);
console.log(`Published ${tag}: installed copies will offer the update at their next start.`);
