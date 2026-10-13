import { existsSync, readFileSync, lstatSync, realpathSync, readdirSync, mkdirSync, symlinkSync, writeFileSync, unlinkSync, renameSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readProfile, mountKind } from './inspect.js';
const norm = p => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const sha = text => createHash('sha256').update(text).digest('hex');
export function planDeploy({ catalogDir, profileDir, only, apply = false }) {
    const source = resolve(catalogDir);
    const profile = readProfile(profileDir);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    const blockers = [];
    if (!profile)
        blockers.push({ code: 'profile-unreadable', message: 'Cannot read profile manifest' });
    if (only?.length)
        blockers.push({ code: 'partial-bundle', message: 'The four feature groups are mounted together; partial registration is unsupported' });
    const linkPath = join(profileDir, 'node_modules', manifest.name);
    let existing;
    try {
        existing = lstatSync(linkPath);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    if (existing && (!existing.isSymbolicLink() || norm(realpathSync(linkPath)) !== norm(source))) {
        blockers.push({ code: 'occupied-mount', message: 'Target mount differs; refusing to replace it' });
    }
    const spec = 'link:' + source.replaceAll('\\', '/');
    if (profile?.dependencies[manifest.name] && profile.dependencies[manifest.name] !== spec) {
        blockers.push({ code: 'occupied-dependency', message: 'Existing dependency points elsewhere; refusing to overwrite it' });
    }
    const loaded = spawnSync(process.execPath, [join(source, 'scripts/load-test.mjs')], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    if (loaded.status !== 0)
        blockers.push({ code: 'import-gate', message: (loaded.stderr || loaded.stdout || loaded.error?.message || 'Import gate failed').slice(-2000) });
    const plan = [{ id: 'hub', pkgName: manifest.name, source, unit: [manifest.name], steps: [
                { kind: 'symlink', what: linkPath + ' → ' + source, currentKind: mountKind(linkPath) },
                { kind: 'edit-json', what: 'Add one link: dependency and bundle; preserve existing entries' },
            ] }];
    const result = { plan, blockers, findings: [], applied: false };
    if (!apply || blockers.length)
        return result;
    const backupDir = join(source, '.backups', new Date().toISOString().replaceAll(/[:.]/g, '-'));
    mkdirSync(backupDir, { recursive: true });
    const originals = {};
    for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
        const file = join(profileDir, name);
        if (!existsSync(file))
            continue;
        originals[name] = readFileSync(file, 'utf8');
        copyFileSync(file, join(backupDir, name));
    }
    writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({ profileDir, hashes: Object.fromEntries(Object.entries(originals).map(([k, v]) => [k, sha(v)])), addedLink: !existing ? linkPath : null }, null, 2));
    let created = false;
    try {
        if (!existing) {
            mkdirSync(join(profileDir, 'node_modules'), { recursive: true });
            symlinkSync(source, linkPath, 'dir');
            created = true;
        }
        const pkg = JSON.parse(originals['package.json']);
        pkg.dependencies ??= {};
        pkg.dependencies[manifest.name] = spec;
        pkg.dsh ??= {};
        pkg.dsh.profile ??= {};
        pkg.dsh.profile.bundles ??= [];
        if (!pkg.dsh.profile.bundles.includes(manifest.name))
            pkg.dsh.profile.bundles.push(manifest.name);
        if (sha(readFileSync(join(profileDir, 'package.json'), 'utf8')) !== sha(originals['package.json']))
            throw new Error('Profile changed concurrently; deployment cancelled');
        const temporary = join(profileDir, 'package.json.hub-pending');
        writeFileSync(temporary, JSON.stringify(pkg, null, 2) + '\n');
        renameSync(temporary, join(profileDir, 'package.json'));
        result.applied = true;
        result.backupDir = backupDir;
    }
    catch (error) {
        if (created)
            unlinkSync(linkPath);
        throw error;
    }
    return result;
}
export function verifyMounts(profileDir, pkgNames) {
    const profile = readProfile(profileDir);
    return pkgNames.map(name => {
        const link = join(profileDir, 'node_modules', name);
        const kind = mountKind(link);
        let realpath;
        try {
            realpath = realpathSync(link);
        }
        catch { }
        const declared = profile?.dependencies[name];
        const expected = declared?.startsWith('link:') ? resolve(profileDir, declared.slice(5)) : undefined;
        return { name, kind, realpath, ok: kind === 'link' && !!realpath && !!expected && norm(realpath) === norm(expected) && profile.bundles.includes(name) };
    });
}
export function findStaleMounts(profileDir) {
    const profile = readProfile(profileDir);
    if (!profile)
        return [];
    const out = [];
    function walk(base, prefix = '') {
        if (!existsSync(base))
            return;
        for (const e of readdirSync(base, { withFileTypes: true })) {
            if (e.name.startsWith('.'))
                continue;
            const full = join(base, e.name);
            const name = prefix + e.name;
            if (!prefix && e.name.startsWith('@') && e.isDirectory() && !e.isSymbolicLink()) {
                walk(full, name + '/');
                continue;
            }
            if (mountKind(full) !== 'link' || Object.hasOwn(profile.dependencies, name))
                continue;
            try {
                out.push({ entry: name, pkgName: JSON.parse(readFileSync(join(full, 'package.json'), 'utf8')).name ?? name, realpath: realpathSync(full) });
            }
            catch { }
        }
    }
    walk(join(profileDir, 'node_modules'));
    return out;
}
