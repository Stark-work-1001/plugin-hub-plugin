import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolve } from 'node:path';
export const name = 'plugin-hub-subagent-tool';
export const inject = ['tools', 'subagents', 'workingDirectory'];
export function apply(ctx, config) {
    if (ctx.tools.get(config.toolName))
        throw new Error(`Tool already exists: ${config.toolName}`);
    ctx.tools.register(defineTool({
        name: config.toolName,
        description: 'Delegate a self-contained task to an external subagent. Provide the complete task and collect its final output. The provider owns its model and permission settings.',
        parameters: {
            prompt: { type: 'string', required: true, description: 'Complete task for the external subagent.' },
            description: { type: 'string', required: true, description: 'Short task label.' },
            cwd: { type: 'string', description: 'Optional child working directory.' },
        },
        output: {
            schema: { type: 'object', additionalProperties: false, properties: {
                    kind: { type: 'string' }, runId: { type: 'string' }, output: { type: 'array', items: { type: 'json' } },
                    stopReason: { type: 'string' }, diagnostic: { type: 'string' }, subagentId: { type: 'string' },
                } },
            render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            if (!exec.agent)
                throw new Error('External delegation requires an Agent session');
            const parent = exec.agent;
            const cwd = resolve(await ctx.workingDirectory.ensure(parent, exec.signal), args.cwd ?? '.');
            const request = { parent, cwd, label: args.description, prompt: [{ type: 'text', text: args.prompt }], signal: exec.signal };
            if (typeof ctx.subagents.startActivation === 'function') {
                const run = await ctx.subagents.startActivation({ provider: config.provider, label: args.description, request, signal: exec.signal, delivery: 'parent' });
                return { kind: 'activation', subagentId: run.childId };
            }
            const run = await ctx.subagents.start(config.provider, request);
            try {
                return { kind: 'foreground', runId: run.id, ...await run.result };
            }
            finally {
                await run.dispose();
            }
        },
    }));
}
