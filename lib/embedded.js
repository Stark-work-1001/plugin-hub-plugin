import * as pwsh from '../plugins/dsh-tool-pwsh-persistent/lib/index.js';
import * as bash from '../plugins/dsh-tool-bash-persistent/lib/index.js';
import Worktrees from '../plugins/dsh-experimental-worktree/lib/index.js';
import * as worktreeTool from '../plugins/dsh-experimental-tool-worktree/lib/index.js';
import * as codex from '../plugins/dsh-subagent-codex/lib/index.js';
import * as claude from '../plugins/dsh-subagent-claude-code/lib/index.js';
import * as delegation from '../adapters/subagent-tool.js';
import * as backends from '../adapters/shell-backends.js';
import { workingDirectoryAdapter } from '../adapters/working-directory.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const contexts = new WeakMap();
const cwdByRoot = new WeakMap();
export const embeddedContext = ctx => {
    const shell = [...ctx.loader.entries()].find(e => e.options.id === 'plugin-hub-shell');
    return contexts.get(shell?.fiber) ?? contexts.get(ctx.fiber) ?? ctx;
};
export function embeddedStates(ctx) {
    return [backends, pwsh, bash, Worktrees, worktreeTool, codex, claude, delegation].map(m => ({
        name: m.name,
        fibers: [...(ctx.registry.get(m)?.fibers ?? [])].map(f => ({
            state: f.state, error: f._error?.message,
            services: Object.fromEntries((m.inject ?? []).map(k => [k, !!f.ctx.get(k)])),
        })),
    }));
}
export async function prepareEmbedded(owner) {
    contexts.set(owner.fiber, owner);
}
async function componentContext(owner, group) {
    let shared = owner.isolate('worktrees');
    if (!shared.get('workingDirectory')) {
        shared = shared.isolate('workingDirectory');
        let cwd = cwdByRoot.get(owner.root);
        if (!cwd) {
            cwd = workingDirectoryAdapter();
            cwdByRoot.set(owner.root, cwd);
        }
        await shared.plugin({ name: 'plugin-hub-working-directory', apply(child) { child.provide('workingDirectory', cwd); } });
    }
    if (group === 'shell' && !shared.get('terminals')) {
        shared = shared.isolate('terminals');
        const terminal = await import(pathToFileURL(createRequire(shared.profileContext.installAnchor).resolve('@deepseek-ai/dsh-terminal')).href);
        await shared.plugin(terminal.default);
    }
    contexts.set(owner.fiber, shared);
    return shared;
}
export async function mountComponent(owner, group) {
    const ctx = await componentContext(owner, group);
    const install = async (plugin, config) => {
        const fiber = await ctx.plugin(plugin, config);
        if (fiber.state !== 2)
            throw new Error(group + ': component dependency is unavailable for ' + plugin.name);
    };
    if (group === 'shell') {
        await install(backends);
        await install(pwsh, { toolName: 'plugin_hub_pwsh', backendType: process.platform === 'win32' ? 'plugin-hub-pwsh' : 'shell', timeoutMs: 300000, maxOutputChars: 16000 });
        await install(bash, { toolName: 'plugin_hub_bash', backendType: process.platform === 'win32' ? 'plugin-hub-bash' : 'shell', timeoutMs: 300000, maxOutputChars: 16000 });
    }
    else if (group === 'worktree') {
        await install(Worktrees);
        await install(worktreeTool, { toolName: 'plugin_hub_create_worktree' });
    }
    else if (group === 'codex') {
        await install(codex, { providerName: 'plugin-hub-codex' });
        await install(delegation, { provider: 'plugin-hub-codex', toolName: 'subagent_codex' });
    }
    else if (group === 'claude') {
        await install(claude, { providerName: 'plugin-hub-claude-code' });
        await install(delegation, { provider: 'plugin-hub-claude-code', toolName: 'subagent_claude_code' });
    }
    else
        throw new Error('Unknown hub component: ' + group);
}
