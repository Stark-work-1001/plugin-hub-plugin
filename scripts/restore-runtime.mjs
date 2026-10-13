import { existsSync, readFileSync, readdirSync, mkdirSync, lstatSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const within = path => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'));
const runtimeFile = join(root, 'runtime-links.json');
const links = existsSync(runtimeFile) ? JSON.parse(readFileSync(runtimeFile, 'utf8')).links : [
    ...readdirSync(join(root, 'vendor'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
        const pkg = JSON.parse(readFileSync(join(root, 'vendor', e.name, 'package.json'), 'utf8'));
        return { path: 'node_modules/' + pkg.name, target: 'vendor/' + e.name };
    }),
    ...catalog.components.map(c => ({ path: 'node_modules/' + c.name, target: c.path })),
];
let created = 0;
for (const entry of links) {
    const link = resolve(root, entry.path), target = resolve(root, entry.target);
    if (!within(link) || !within(target) || !entry.path.startsWith('node_modules/'))
        throw new Error('Runtime link escapes package');
    if (!existsSync(target) || !within(realpathSync(target)))
        throw new Error('Runtime dependency missing or external: ' + entry.target);
    mkdirSync(dirname(link), { recursive: true });
    if (!within(realpathSync(dirname(link))))
        throw new Error('Runtime link parent escapes package');
    let stat;
    try {
        stat = lstatSync(link);
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    if (stat) {
        if (stat.isSymbolicLink() && existsSync(link) && realpathSync(link).toLowerCase() === realpathSync(target).toLowerCase())
            continue;
        if (existsSync(runtimeFile) || !stat.isSymbolicLink() || !within(realpathSync(link)))
            throw new Error('Refusing to replace occupied runtime link: ' + entry.path);
        unlinkSync(link);
    }
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    created++;
}
console.log(JSON.stringify({ restored: created, links: links.length, offline: existsSync(runtimeFile) }));
