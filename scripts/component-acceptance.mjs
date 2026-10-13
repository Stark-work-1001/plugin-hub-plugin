import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
export async function componentAcceptance(ctx, file) {
    const manager = ctx.get('pluginManager');
    const groups = [
        { name: 'shell', tools: ['plugin_hub_pwsh', 'plugin_hub_bash'] },
        { name: 'worktree', tools: ['plugin_hub_create_worktree'] },
        { name: 'codex', tools: ['subagent_codex'], provider: 'plugin-hub-codex' },
        { name: 'claude', tools: ['subagent_claude_code'], provider: 'plugin-hub-claude-code' },
    ];
    const result = { time: new Date().toISOString(), cases: [] };
    const check = disabled => {
        for (const group of groups) {
            for (const tool of group.tools)
                assert.equal(!!ctx.get('tools').get(tool), group.name !== disabled, tool);
            if (group.provider)
                assert.equal(!!ctx.get('subagents').getProvider(group.provider), group.name !== disabled, group.provider);
        }
    };
    const initial = await manager.listPlugins();
    const others = initial.filter(p => !p.moduleName.startsWith('plugin-hub-')).map(p => [p.entryId, p.fiberPhase]);
    try {
        const bundle = (await manager.listBundles()).find(b => b.name === 'plugin-hub-plugin');
        assert.equal(bundle.rows.length, 5);
        check();
        for (const group of groups) {
            const row = initial.find(p => p.moduleName === 'plugin-hub-component-' + group.name);
            assert.equal(row.fiberPhase, 'active');
            const off = await manager.setPluginEnabled(row.entryId, false);
            assert.equal(off.application, 'applied');
            check(group.name);
            const on = await manager.setPluginEnabled(row.entryId, true);
            assert.equal(on.application, 'applied');
            check();
            const current = await manager.listPlugins();
            assert.deepEqual(current.filter(p => !p.moduleName.startsWith('plugin-hub-')).map(p => [p.entryId, p.fiberPhase]), others);
            result.cases.push({ name: group.name + ' native disable/enable, independent behavior', ok: true, off, on });
            writeFileSync(file, JSON.stringify(result, null, 2));
        }
        const core = initial.find(p => p.moduleName === 'plugin-hub-plugin/core');
        const off = await manager.setPluginEnabled(core.entryId, false);
        result.coreOff = off;
        writeFileSync(file, JSON.stringify(result, null, 2));
        assert.equal(off.application, 'applied');
        check();
        assert.equal(!!ctx.get('tools').get('plugin_hub_scan'), false);
        const on = await manager.setPluginEnabled(core.entryId, true);
        assert.equal(on.application, 'applied');
        check();
        assert.equal(!!ctx.get('tools').get('plugin_hub_scan'), true);
        result.cases.push({ name: 'core inspection disable/enable keeps four features active', ok: true, off, on });
    }
    catch (error) {
        result.error = error.stack;
    }
    writeFileSync(file, JSON.stringify(result, null, 2));
    return result;
}
