import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const hub = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(hub, p), 'utf8');
const write = (p, s) => writeFileSync(join(hub, p), s);
const dual = '>=0.2.0-0 <0.3 || >=0.2.1-0 <0.3';
for (const dir of readdirSync(join(hub, 'plugins'))) {
    const path = 'plugins/' + dir + '/package.json';
    const pkg = JSON.parse(read(path));
    pkg.engines = { ...pkg.engines, dsh: dual };
    pkg.pluginHub = { owner: 'plugin-hub-plugin', mount: 'internal' };
    if (pkg.dsh?.bundle)
        delete pkg.dsh.bundle;
    if (pkg.peerDependencies)
        for (const name of Object.keys(pkg.peerDependencies)) {
            if (name.startsWith('@deepseek-ai/'))
                delete pkg.peerDependencies[name];
        }
    write(path, JSON.stringify(pkg, null, 2) + '\n');
}
for (const shell of ['pwsh', 'bash']) {
    const path = 'plugins/dsh-tool-' + shell + '-persistent/lib/index.js';
    let s = read(path).replace('name: "' + shell + '",', 'name: config.toolName,');
    if (!s.includes('toolName: z.string()'))
        s = s.replace('const Config = z.object({', 'const Config = z.object({\n\ttoolName: z.string().default("plugin_hub_' + shell + '"),');
    if (!s.includes('toolName: config.toolName ??'))
        s = s.replace('const resolved = {\n\t\tbackendType:', 'const resolved = {\n\t\ttoolName: config.toolName ?? "plugin_hub_' + shell + '",\n\t\tbackendType:');
    write(path, s);
}
const worktree = 'plugins/dsh-experimental-tool-worktree/lib/index.js';
write(worktree, read(worktree).replace('function apply(ctx) {', 'function apply(ctx, config = {}) {').replace('name: "create_worktree",', 'name: config.toolName ?? "plugin_hub_create_worktree",'));
for (const dir of ['dsh-subagent-codex', 'dsh-subagent-claude-code']) {
    const path = 'plugins/' + dir + '/lib/index.js';
    write(path, read(path).replace(/from "@deepseek-ai\/dsh-subagent";/g, 'from "../../../vendor/dsh-subagent-out-of-process.mjs";'));
}
write('plugins/dsh-tool-subagent/lib/index.js', '// Compatibility entry; the core runtime remains host-owned.\nexport { name, inject, apply } from "../../../adapters/subagent-tool.js"\n');
const codex = 'plugins/dsh-subagent-codex/lib/index.js';
let s = read(codex);
if (!s.includes('Codex advertised no default model')) {
    s = s.replace('await this.guarded(this.transport.flush(), signal);', `await this.guarded(this.transport.flush(), signal);
        if (this.model === void 0) {
            const catalog = object(await this.guarded(this.transport.request("model/list", {}, signal), signal), "model/list response");
            const selected = catalog.data?.find(model => model.isDefault);
            if (!selected?.model) throw new Error("Codex advertised no default model; configure provider model explicitly");
            this.model = selected.model;
        }`);
}
write(codex, s);
console.log('Adapted seven embedded modules; deployment owns one bundle. No profile files changed.');
