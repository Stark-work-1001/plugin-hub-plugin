import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
export async function loadAll(hub) {
    const results = [];
    const catalog = JSON.parse(readFileSync(join(hub, 'catalog.json'), 'utf8'));
    const names = [...new Set(catalog.plugins.flatMap(p => p.unit).concat(catalog.adapterDependencies ?? []))];
    for (const [name, dir] of [[catalog.hub.name, hub], ...names.map(n => [n, join(hub, 'plugins', n.replace(/^@[^/]+\//, ''))]), ...(catalog.components ?? []).map(c => [c.name, join(hub, c.path)])]) {
        try {
            const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
            const dot = pkg.exports?.['.'];
            const entry = typeof dot === 'string' ? dot : (dot?.default ?? dot?.import ?? pkg.main);
            if (!entry || !existsSync(join(dir, entry)))
                throw new Error('Missing runtime entry for ' + name);
            const m = await import(pathToFileURL(join(dir, entry)).href);
            const callable = (typeof m.name === 'string' && typeof m.apply === 'function') || typeof m.default === 'function';
            if (!callable)
                throw new Error('Module does not export a Cordis plugin: ' + name);
            results.push({ name, verdict: 'ok', exports: Object.keys(m) });
        }
        catch (error) {
            results.push({ name, verdict: 'failed', code: error.code, detail: error.message });
        }
    }
    return results;
}
const hub = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const results = await loadAll(hub);
    for (const r of results)
        console.log(r.verdict + ' ' + r.name + (r.detail ? ': ' + r.detail : ''));
    const failed = results.filter(r => r.verdict !== 'ok');
    console.log('Imported ' + results.length + ' modules; failed=' + failed.length);
    process.exitCode = failed.length ? 1 : 0;
}
