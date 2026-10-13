import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { embeddedStates } from './embedded.js';
export async function captureRuntime(ctx, file, application) {
    const registry = ctx.get('cordisInspect');
    const providers = registry?.list() ?? [];
    const agents = ctx.get('agents')?.list() ?? [];
    const evidence = { time: new Date().toISOString(), pid: process.pid, application, providers, queries: {}, backends: ctx.get('terminals')?.listBackends(),
        bundle: (await ctx.get('pluginManager')?.listBundles())?.find(b => b.name === 'plugin-hub-plugin'),
        nativeComponents: (await ctx.get('pluginManager')?.listPlugins())?.filter(p => p.moduleName.startsWith('plugin-hub-component-') || p.moduleName === 'plugin-hub-plugin/core'),
        agents: agents.map(a => ({ id: a.id, status: a.status, queuedTurns: a.inbox?.nextTurn?.length, queuedSteps: a.inbox?.nextStep?.length })),
        embedded: embeddedStates(ctx),
        services: Object.fromEntries(['subagents', 'terminals', 'workingDirectory', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy'].map(k => [k, !!ctx.get(k)])),
        children: [...(ctx.fiber.children ?? [])].map(f => ({ name: f.runtime?.name ?? f.runtime?.constructor?.name, state: f.state, error: f.error?.message })),
        subagentProviders: ['spawn', 'fork', 'plugin-hub-codex', 'plugin-hub-claude-code'].map(name => {
            const p = ctx.get('subagents')?.getProvider(name);
            return { name, registered: !!p, capabilities: p?.capabilities };
        }),
        entries: [...ctx.loader.entries()].map(e => ({ id: e.id, options: { id: e.options.id, name: e.options.name, disabled: e.options.disabled }, state: e.fiber?.state, error: e.fiber?._error?.message })),
    };
    if (registry)
        for (const id of ['Config', 'Service', 'Tool']) {
            const provider = providers.find(p => p.platform === 'host' && p.id === id) ?? providers.find(p => p.id === id);
            if (!provider)
                continue;
            const method = provider.methods[0].name;
            try {
                evidence.queries[id] = await registry.query('host', id, method, id === 'Config' ? { name: 'plugin-hub-plugin/core', limit: 100 } : undefined, undefined, AbortSignal.timeout(10000));
            }
            catch (error) {
                evidence.queries[id] = { error: error.message };
            }
        }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
    return evidence;
}
