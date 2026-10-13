import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
export async function functionalAcceptance(ctx, file, online = false) {
    const repo = resolve('.work/acceptance-repo-' + process.pid);
    mkdirSync(repo, { recursive: true });
    const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
    git(['init', '-q']);
    writeFileSync(repo + '/fixture.txt', 'hub fixture\n');
    git(['add', 'fixture.txt']);
    git(['-c', 'user.name=Hub Acceptance', '-c', 'user.email=hub-test@example.invalid', 'commit', '-qm', 'fixture']);
    const result = { time: new Date().toISOString(), repo, cases: [] };
    let handle;
    try {
        handle = await ctx.get('agents').create({ sessionId: 'session-' + randomUUID(), meta: { cwd: repo }, agentOptions: {} });
        const agent = handle.agent ?? handle;
        const execute = async (name, args) => {
            const tool = ctx.get('tools').get(name, agent);
            if (!tool)
                throw new Error('Missing tool: ' + name);
            return await tool.execute(args, { agent, signal: AbortSignal.timeout(60000), callId: 'hub-acceptance-' + randomUUID() });
        };
        const test = async (name, action) => {
            try {
                const value = await action();
                result.cases.push({ name, ok: true, value });
            }
            catch (error) {
                result.cases.push({ name, ok: false, error: error.stack });
            }
            writeFileSync(file, JSON.stringify(result, null, 2));
        };
        await test('PowerShell persistence', async () => {
            await execute('plugin_hub_pwsh', { command: '$hub_acceptance = 731; Write-Output HUB_PWSH_START' });
            const output = await execute('plugin_hub_pwsh', { command: 'Write-Output $hub_acceptance' });
            if (!output.includes('731'))
                throw new Error('PowerShell state was not retained: ' + output);
            return output;
        });
        await test('Bash persistence', async () => {
            await execute('plugin_hub_bash', { command: 'HUB_ACCEPTANCE=917; echo HUB_BASH_START' });
            const output = await execute('plugin_hub_bash', { command: 'echo "$HUB_ACCEPTANCE"' });
            if (!output.includes('917'))
                throw new Error('Bash state was not retained: ' + output);
            return output;
        });
        await test('Git worktree', () => execute('plugin_hub_create_worktree', { name: 'hub-acceptance-' + process.pid }));
        await test('Codex provider registration', () => {
            const provider = ctx.get('subagents').getProvider('plugin-hub-codex');
            if (!provider || typeof provider.start !== 'function')
                throw new Error('Codex provider missing');
            return { name: provider.name, capabilities: provider.capabilities };
        });
        await test('Claude provider registration', () => {
            const provider = ctx.get('subagents').getProvider('plugin-hub-claude-code');
            if (!provider || typeof provider.start !== 'function')
                throw new Error('Claude provider missing');
            return { name: provider.name, capabilities: provider.capabilities };
        });
        if (online)
            for (const name of ['subagent_codex', 'subagent_claude_code']) {
                await test(name + ' minimal online prompt', async () => {
                    const isolatedOnlineCwd = mkdtempSync(resolve(tmpdir(), 'plugin-hub-online-'));
                    const value = await execute(name, { description: 'Plugin acceptance check', prompt: 'Reply with exactly HUB_OK. Do not use tools or read files.', cwd: isolatedOnlineCwd });
                    if (value.stopReason === 'error' || !JSON.stringify(value.output).includes('HUB_OK'))
                        throw new Error(JSON.stringify(value));
                    return value;
                });
            }
    }
    catch (error) {
        result.error = error.stack;
    }
    finally {
        await handle?.dispose?.();
        writeFileSync(file, JSON.stringify(result, null, 2));
    }
    return result;
}
