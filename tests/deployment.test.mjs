import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDeploy, verifyMounts } from '../lib/deploy.js';
import { loadAll } from '../scripts/load-test.mjs';
import { workingDirectoryAdapter } from '../adapters/working-directory.js';
const hub = fileURLToPath(new URL('..', import.meta.url));
function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-hub-tests-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, dependencies: { existing: 'link:./existing-package' }, dsh: { profile: { bundles: ['core', 'existing'] } } }));
    writeFileSync(join(dir, 'cordis.patch.yml'), '# Preserve this patch verbatim\n[]\n');
    return dir;
}
function clean(dir) {
    assert.ok(resolve(dir).startsWith(join(resolve(tmpdir()), 'plugin-hub-tests-')));
    rmSync(dir, { recursive: true, force: true });
}
test('deployment registers only the hub and preserves existing profile fields and patch', () => {
    const dir = fixture();
    try {
        const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8');
        const result = planDeploy({ catalogDir: hub, profileDir: dir, apply: true });
        assert.equal(result.applied, true);
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json')));
        assert.deepEqual(pkg.dsh.profile.bundles, ['core', 'existing', 'plugin-hub-plugin']);
        assert.equal(pkg.dependencies.existing, 'link:./existing-package');
        assert.equal(Object.keys(pkg.dependencies).length, 2);
        assert.equal(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'), patch);
        assert.equal(verifyMounts(dir, ['plugin-hub-plugin'])[0].ok, true);
    }
    finally {
        clean(dir);
    }
});
test('partial deployment is blocked without modifying the profile', () => {
    const dir = fixture();
    try {
        const before = readFileSync(join(dir, 'package.json'), 'utf8');
        const result = planDeploy({ catalogDir: hub, profileDir: dir, only: ['pwsh-persistent'], apply: true });
        assert.equal(result.applied, false);
        assert.ok(result.blockers.some(b => b.code === 'partial-bundle'));
        assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
    }
    finally {
        clean(dir);
    }
});
test('occupied real directory blocks deployment', () => {
    const dir = fixture();
    try {
        mkdirSync(join(dir, 'node_modules', 'plugin-hub-plugin'), { recursive: true });
        assert.equal(planDeploy({ catalogDir: hub, profileDir: dir, apply: true }).applied, false);
    }
    finally {
        clean(dir);
    }
});
test('missing transitive package cannot pass the import gate', async () => {
    const dir = fixture();
    try {
        writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ hub: { name: 'fixture' }, plugins: [] }));
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module', main: 'index.js' }));
        writeFileSync(join(dir, 'index.js'), 'import "plugin-hub-nonexistent-fixture-package"; export function apply() {}\n');
        const results = await loadAll(dir);
        assert.equal(results[0].verdict, 'failed');
        assert.equal(results[0].code, 'ERR_MODULE_NOT_FOUND');
    }
    finally {
        clean(dir);
    }
});
test('missing declared native component fails the import gate', async () => {
    const dir = fixture();
    try {
        writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ hub: { name: 'fixture' }, plugins: [], components: [{ name: 'missing-component', path: 'components/missing' }] }));
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module', main: 'index.js' }));
        writeFileSync(join(dir, 'index.js'), 'export const name = "fixture"; export function apply() {}\n');
        const results = await loadAll(dir);
        assert.equal(results[0].verdict, 'ok');
        assert.equal(results[1].name, 'missing-component');
        assert.equal(results[1].verdict, 'failed');
    }
    finally {
        clean(dir);
    }
});
test('legacy cwd adaptation retains independent owner state', async () => {
    const dir = fixture();
    try {
        mkdirSync(join(dir, 'child'));
        const one = { cwd: dir, session: {} }, two = { cwd: dir, session: {} };
        const cwd = workingDirectoryAdapter();
        await cwd.set(one, 'child');
        assert.equal(await cwd.ensure(one), join(dir, 'child'));
        assert.equal(await cwd.ensure(two), dir);
    }
    finally {
        clean(dir);
    }
});
