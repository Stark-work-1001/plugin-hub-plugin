import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
export const name = 'plugin-hub-shell-backends';
export const inject = ['terminals', 'subprocess', 'sandbox', 'sandboxPolicy'];
export async function apply(ctx) {
    const anchor = ctx.profileContext?.installAnchor;
    if (!anchor)
        throw new Error('Host profile install anchor is unavailable');
    const backend = await import(pathToFileURL(createRequire(anchor).resolve('@deepseek-ai/dsh-terminal-bash')).href);
    if (process.platform === 'win32') {
        await ctx.plugin(backend, { backendType: 'plugin-hub-pwsh', shellDialect: 'pwsh' });
        const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
const candidates = [process.env.PLUGIN_HUB_BASH_PATH, ...roots.flatMap(root => [join(root, 'Git', 'bin', 'bash.exe'), join(root, 'Git', 'usr', 'bin', 'bash.exe')])].filter(Boolean);
const path = candidates.find(existsSync);
        if (path)
            await ctx.plugin(backend, { backendType: 'plugin-hub-bash', shellDialect: 'bash', shellPath: path });
        else
            ctx.logger.warn('Git Bash is unavailable; plugin_hub_bash requires a Bash PTY backend');
    }
}
