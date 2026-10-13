import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLayer, readProfile } from './inspect.js';
export function mountedComposition(hub, profileDir) {
    const layers = [readLayer(hub, 'cordis.patch.yml', 'plugin-hub-plugin')];
    const unavailable = [];
    const profile = profileDir ? readProfile(profileDir) : undefined;
    for (const name of profile?.bundles ?? []) {
        if (name === 'plugin-hub-plugin')
            continue;
        const dir = join(profileDir, 'node_modules', name);
        if (!existsSync(join(dir, 'package.json'))) {
            unavailable.push(name);
            continue;
        }
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const patch = pkg.dsh?.bundle?.patch;
        for (const file of (Array.isArray(patch) ? patch : patch ? [patch] : []))
            layers.push(readLayer(dir, file, name));
    }
    if (profileDir)
        layers.push(readLayer(profileDir, 'cordis.patch.yml', '<profile>'));
    return { layers, unavailable };
}
