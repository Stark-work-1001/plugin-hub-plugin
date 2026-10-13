import { resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
export function workingDirectoryAdapter() {
    const current = new WeakMap();
    const key = owner => owner.session ?? owner;
    const initial = owner => owner.cwd ?? owner.session?.header?.cwd ?? owner.options?.cwd;
    return {
        get(owner) { return current.get(key(owner)) ?? initial(owner); },
        async ensure(owner, signal) {
            signal?.throwIfAborted();
            const path = this.get(owner);
            if (typeof path !== 'string' || !isAbsolute(path))
                throw new Error('Agent has no absolute working directory');
            if (!(await stat(path)).isDirectory())
                throw new Error(`Working directory is not a directory: ${path}`);
            return path;
        },
        async set(owner, path, signal) {
            const next = resolve(await this.ensure(owner, signal), path);
            if (!(await stat(next)).isDirectory())
                throw new Error(`Working directory is not a directory: ${next}`);
            signal?.throwIfAborted();
            current.set(key(owner), next);
            return next;
        },
    };
}
