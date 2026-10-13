import { defineTool } from '@deepseek-ai/dsh-tools';
import { inspectMany, simulateComposition, RISK_MEANING, RISK_ORDER, riskOf } from './inspect.js';
import { SUPPORTED_HOST_VERSIONS } from './compat.js';
import { planDeploy, findStaleMounts } from './deploy.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareEmbedded } from './embedded.js';
import { embeddedContext } from './embedded.js';
import { captureRuntime } from './runtime-evidence.js';
import z from '@deepseek-ai/schemastery';
import { mountedComposition } from './composition.js';
export const name = 'plugin-hub-plugin';
export const inject = ['tools'];
const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, '..');
export const Config = z.object({
    pluginRoot: z.string().default(HUB),
    profileDir: z.string().required(false),
    supportedHostVersions: z.array(z.string()).default(SUPPORTED_HOST_VERSIONS),
    evidenceFile: z.string().required(false),
});
const DEFAULTS = {
    pluginRoot: HUB,
    profileDir: null,
    supportedHostVersions: SUPPORTED_HOST_VERSIONS,
};
const ICON = { error: '✖', warn: '▲', info: '·', ok: '✔' };
const SCAN_OUTPUT = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            report: { type: 'string' },
            willBlockStartup: { type: 'boolean' },
            verdict: { type: 'string' },
            errorCount: { type: 'number' },
            warningCount: { type: 'number' },
        },
    },
    render: (_args, value) => [{ type: 'text', text: value.report }],
};
const DEPLOY_OUTPUT = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            report: { type: 'string' },
            stepCount: { type: 'number' },
            blockerCount: { type: 'number' },
            applied: { type: 'boolean' },
        },
    },
    render: (_args, value) => [{ type: 'text', text: value.report }],
};
function readCatalog() {
    const p = join(HUB, 'catalog.json');
    if (!existsSync(p))
        return undefined;
    try {
        return JSON.parse(readFileSync(p, 'utf8'));
    }
    catch {
        return undefined;
    }
}
export async function apply(ctx, suppliedConfig = {}) {
    const config = { ...DEFAULTS, ...suppliedConfig };
    const scanner = defineTool({
        name: 'plugin_hub_scan',
        description: "检查插件板 catalog 登记模块的入口、依赖、宿主版本范围与装配风险。",
        parameters: {
            only: {
                type: 'array',
                items: { type: 'string' },
                description: '只体检这些插件 id（见 catalog.json）。省略则体检全部。',
            },
            profileDir: {
                type: 'string',
                description: 'profile 目录绝对路径。给了才会核对 dependencies / bundles 装配一致性。',
            },
        },
        output: SCAN_OUTPUT,
        isConcurrencySafe: () => true,
        execute(args) {
            try {
                return scanResult(config, args);
            }
            catch (e) {
                return { report: `体检失败：${e?.stack ?? e}`, willBlockStartup: true, verdict: 'error', errorCount: 1, warningCount: 0 };
            }
        },
    });
    const composer = defineTool({
        name: 'plugin_hub_compose',
        description: "检查可读 bundle 层和 profile 覆盖中的重复活动 Loader 源；静态检查后仍需真实宿主验证。",
        parameters: {
            profileDir: {
                type: 'string',
                description: 'profile 目录绝对路径。给了则把 profile 顶层覆盖也算进合成树。',
            },
        },
        output: SCAN_OUTPUT,
        isConcurrencySafe: () => true,
        execute(args) {
            try {
                return composeResult(config, args);
            }
            catch (e) {
                return { report: `合成体检失败：${e?.stack ?? e}`, willBlockStartup: true, verdict: 'error', errorCount: 1, warningCount: 0 };
            }
        },
    });
    const deployer = defineTool({
        name: 'plugin_hub_deploy',
        description: "生成本体 symbolic-link 部署计划。默认只读；显式 apply 后先备份，保留已有字段并增加本体 dependency、bundle 和链接，拒绝覆盖其他目标。",
        parameters: {
            only: {
                type: 'array',
                items: { type: 'string' },
                description: '只处理这些插件 id。省略则处理全部。',
            },
            profileDir: { type: 'string', description: '目标 profile 目录绝对路径。' },
            apply: {
                type: 'boolean',
                description: 'true 才真正写入 profile。默认 false（只出计划）。执行前会自动备份 profile。',
            },
        },
        output: DEPLOY_OUTPUT,
        execute(args) {
            try {
                const profileDir = args.profileDir ?? config.profileDir;
                if (!profileDir) {
                    return { report: `${ICON.error} 未配置 profileDir，无法生成部署计划`, stepCount: 0, blockerCount: 1, applied: false };
                }
                const res = planDeploy({
                    catalogDir: HUB,
                    profileDir,
                    only: args.only,
                    apply: args.apply === true,
                });
                return {
                    report: formatDeploy(res, profileDir),
                    stepCount: res.plan.reduce((n, p) => n + p.steps.length, 0),
                    blockerCount: res.blockers.length,
                    applied: res.applied,
                };
            }
            catch (e) {
                return { report: `部署计划失败：${e?.stack ?? e}`, stepCount: 0, blockerCount: 1, applied: false };
            }
        },
    });
    const unregister = [
        ctx.tools.register(scanner),
        ctx.tools.register(composer),
        ctx.tools.register(deployer),
    ];
    ctx.logger?.debug?.('plugin-hub-plugin: plugin_hub_scan / plugin_hub_compose / plugin_hub_deploy 已注册');
    await prepareEmbedded(ctx);
    if (config.evidenceFile)
        ctx.effect(() => {
            const timer = setTimeout(async () => {
                try {
                    await captureRuntime(embeddedContext(ctx), config.evidenceFile);
                }
                catch (error) {
                    ctx.logger.warn('Plugin hub evidence failed: ' + error.message);
                }
            }, 1500);
            return () => clearTimeout(timer);
        }, 'plugin-hub acceptance evidence');
    return () => { for (const off of unregister)
        off(); };
}
function catalogPluginDirs(catalog, only) {
    if (catalog === undefined)
        return [];
    const wanted = only === undefined ? catalog.plugins : catalog.plugins.filter(p => only.includes(p.id));
    const dirs = [{ dir: HUB, name: 'plugin-hub-plugin', id: 'hub' }];
    for (const entry of wanted) {
        for (const pkgName of entry.unit) {
            const leaf = pkgName.replace(/^@[^/]+\//, '');
            const dir = join(HUB, 'plugins', leaf);
            if (existsSync(join(dir, 'package.json')))
                dirs.push({ dir, name: pkgName, id: entry.id });
            else
                dirs.push({ dir, name: pkgName, id: entry.id, missing: true });
        }
    }
    for (const name of catalog.adapterDependencies ?? []) {
        const dir = join(HUB, 'plugins', name.replace(/^@[^/]+\//, ''));
        dirs.push({ dir, name, id: 'adapter', missing: !existsSync(join(dir, 'package.json')) });
    }
    return dirs;
}
function scanResult(config, args) {
    const catalog = readCatalog();
    if (catalog === undefined) {
        return { report: `${ICON.error} 读不到 catalog.json`, willBlockStartup: false, verdict: 'error', errorCount: 1, warningCount: 0 };
    }
    const entries = catalogPluginDirs(catalog, args.only);
    const present = entries.filter(e => !e.missing).map(e => e.dir);
    const missing = entries.filter(e => e.missing);
    const profileDir = args.profileDir ?? config.profileDir;
    const res = inspectMany(present, { profileDir, versions: config.supportedHostVersions });
    const lines = [];
    lines.push(`插件板 ${catalog.hub?.displayName ?? ''} · catalog 登记 ${entries.length} 个包`);
    lines.push(`受支持宿主版本线：${(config.supportedHostVersions ?? []).join('  ·  ')}`);
    lines.push('');
    if (missing.length > 0) {
        lines.push(`${ICON.warn} 以下包还没构建/提取（先跑 npm run build）：`);
        for (const m of missing)
            lines.push(`  · ${m.name} → ${m.dir}`);
        lines.push('');
    }
    for (const r of res.results) {
        const mark = r.verdict === 'clean' ? ICON.ok : r.willBlockStartup ? ICON.error : r.findings.some(f => f.severity === 'error') ? ICON.error : ICON.warn;
        lines.push(`${mark} ${r.name} ${r.version ?? ''} — ${verdictLabel(r.verdict)}`);
        for (const f of r.findings) {
            lines.push(`    ${ICON[f.severity] ?? '?'} [${riskOf(f.code)}/${f.code}] ${f.message}`);
        }
    }
    lines.push('');
    lines.push(`风险分诊：${RISK_ORDER.map(r => `${r}=${res.byRisk[r]}`).join(' · ')}`);
    lines.push(`合计：${ICON.error} ${res.totals.error} · ${ICON.warn} ${res.totals.warn}`);
    lines.push('');
    lines.push(res.willBlockStartup
        ? `${ICON.error} 存在 blocker：装上去会让宿主起不来或连带清空 profile。不要挂载。`
        : res.ok
            ? `${ICON.ok} 无 error，可进入部署计划阶段（仍然不会自动写 profile）`
            : `${ICON.warn} 无 blocker，但有 error/warn 项，详见上方`);
    return {
        report: lines.join('\n'),
        willBlockStartup: res.willBlockStartup || missing.length > 0,
        verdict: missing.length ? 'startup' : res.verdict,
        errorCount: res.totals.error + missing.length,
        warningCount: res.totals.warn,
    };
}
function composeResult(config, args) {
    const catalog = readCatalog();
    if (catalog === undefined) {
        return { report: `${ICON.error} 读不到 catalog.json`, willBlockStartup: false, verdict: 'error', errorCount: 1, warningCount: 0 };
    }
    const profileDir = args.profileDir ?? config.profileDir;
    const { layers, unavailable } = mountedComposition(HUB, profileDir);
    const composed = simulateComposition(layers);
    const lines = [];
    lines.push(`合成 ${layers.length} 个装配层：${layers.map(l => l.name).join(' · ')}`);
    lines.push('');
    if (unavailable.length)
        lines.push(`独立扫描未读取宿主内置层：${unavailable.join(', ')}。完整组合须由真实宿主预启动验证。`);
    if (composed.findings.length === 0) {
        lines.push(`${ICON.ok} 无重复 Loader 源`);
        if (profileDir)
            lines.push(`（profile 覆盖：${profileDir}）`);
    }
    else {
        for (const f of composed.findings)
            lines.push(`${ICON.error} [${f.code}] ${f.message}`);
    }
    if (profileDir) {
        const stale = findStaleMounts(profileDir);
        if (stale.length > 0) {
            lines.push('');
            lines.push(`${ICON.warn} profile 里 profile 未声明的挂载残留（会让「一个包一条 Loader 行」失去唯一性）：`);
            for (const s of stale)
                lines.push(`  · ${s.entry} → ${s.pkgName} @ ${s.realpath}`);
        }
    }
    const errors = composed.findings.filter(f => f.severity === 'error').length;
    return {
        report: lines.join('\n'),
        willBlockStartup: errors > 0,
        verdict: errors > 0 ? 'blocker' : 'clean',
        errorCount: errors,
        warningCount: unavailable.length,
    };
}
function formatDeploy(res, profileDir) {
    const lines = [`部署目标 profile：${profileDir}`, ''];
    if (res.blockers.length > 0) {
        for (const b of res.blockers)
            lines.push(`${ICON.error} [${b.code}] ${b.message}`);
        lines.push('');
        lines.push(`${ICON.error} 有阻断项，未写入任何东西。先把上面的包构建出来。`);
        return lines.join('\n');
    }
    for (const item of res.plan) {
        lines.push(`${item.pkgName}（${item.id}）`);
        for (const s of item.steps) {
            const mark = s.kind === 'noop' ? ICON.info : ICON.warn;
            lines.push(`  ${mark} [${s.kind}] ${s.what}`);
        }
    }
    lines.push('');
    for (const f of res.findings)
        lines.push(`${ICON.warn} [${f.code}] ${f.message}`);
    lines.push('');
    lines.push(res.applied
        ? `${ICON.ok} 已执行。profile 已备份到插件板 .backups/。仍需你择机重启宿主才生效。`
        : `${ICON.info} 以上是**计划**，尚未写入任何东西。要真正执行请显式传 apply=true。`);
    return lines.join('\n');
}
function verdictLabel(v) {
    switch (v) {
        case 'clean': return `${ICON.ok} 干净`;
        case 'cosmetic': return `${ICON.warn} 仅有声明性问题`;
        case 'silent': return `${ICON.warn} 有静默失效风险`;
        case 'startup': return `${ICON.error} 会导致插件 failed to import`;
        case 'blocker': return `${ICON.error} 会导致宿主起不来 / profile 被回退`;
        default: return v;
    }
}
export { RISK_MEANING };
