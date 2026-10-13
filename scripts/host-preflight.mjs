import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { captureRuntime } from '../lib/runtime-evidence.js';
import { embeddedContext } from '../lib/embedded.js';
import { functionalAcceptance } from './functional-acceptance.mjs';
import { componentAcceptance } from './component-acceptance.mjs';
const runtime = process.argv[2];
const profileDir = resolve(process.argv[3]);
const output = resolve(process.argv[4]);
const anchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json');
const { loadProfileDirectory, loadLayeredEnv } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
const { runProfile } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js')));
let application;
try {
    const profile = loadProfileDirectory('dsh', profileDir, anchor);
    application = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop', resolvedProfile: { profile, installAnchor: anchor }, patchFiles: [], args: ['--no-open', '--port', '0'] });
    const ctx = application.ctx;
    const hub = [...ctx.loader.entries()].find(e => e.options.id === 'plugin-hub');
    await new Promise(r => setTimeout(r, 1000));
    const result = await captureRuntime(embeddedContext(hub?.fiber?.ctx ?? ctx), output);
    if (process.argv.includes('--components')) {
        const tests = await componentAcceptance(embeddedContext(hub?.fiber?.ctx ?? ctx), output + '.components.json');
        if (tests.error)
            process.exitCode = 1;
    }
    if (process.argv.includes('--functional')) {
        const tests = await functionalAcceptance(embeddedContext(hub?.fiber?.ctx ?? ctx), output + '.functional.json', process.argv.includes('--online'));
        if (tests.error || tests.cases.some(c => !c.ok))
            process.exitCode = 1;
    }
    console.log(JSON.stringify({ booted: true, pid: process.pid, queries: Object.keys(result.queries), backends: result.backends }));
}
catch (error) {
    writeFileSync(output, JSON.stringify({ booted: false, error: error.stack }, null, 2));
    console.error(error);
    process.exitCode = 1;
}
finally {
    await application?.shutdown.shutdown(process.exitCode ?? 0);
}
