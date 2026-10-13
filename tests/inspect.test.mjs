import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTopLevelRows, resolveRowPackage, inspectPluginDir, riskOf, RISK_ORDER, simulateComposition, readLayer, tally, } from '../lib/inspect.js';
function makePlugin(files) {
    const dir = mkdtempSync(join(tmpdir(), 'hub-test-'));
    for (const [rel, content] of Object.entries(files)) {
        const p = join(dir, rel);
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, content);
    }
    return dir;
}
test('parseTopLevelRows：顶层行与 insert 子项都要抽到', () => {
    const text = [
        '# 注释行',
        '- id: ui-theme',
        '  name: "@deepseek-ai/dsh-client-ui-theme"',
        '  config:',
        '    preference: system',
        '- insert:',
        '    - id: mcp-x',
        '      name: "@deepseek-ai/dsh-mcp-client"',
        '      config:',
        '        serverName: x',
    ].join('\n');
    const rows = parseTopLevelRows(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'ui-theme');
    assert.equal(rows[0].name, '@deepseek-ai/dsh-client-ui-theme');
    assert.equal(rows[1].id, 'mcp-x');
    assert.equal(rows[1].name, '@deepseek-ai/dsh-mcp-client');
});
test('parseTopLevelRows：config 内部的缩进行不算顶层行', () => {
    const text = ['- id: a', '  name: x', '  config:', '    nested:', '      - id: not-a-row'].join('\n');
    const rows = parseTopLevelRows(text);
    assert.equal(rows.length, 1, 'config 里嵌套的 id 不该被当成顶层 Loader 行');
});
test('事故夹具：同一个包被两条 Loader 行解析到 → blocker', () => {
    const other = makePlugin({
        'package.json': JSON.stringify({ name: 'fixture-ui', main: 'fixture-entry.js' }),
        'fixture-entry.js': 'export default {}',
    });
    const dir = makePlugin({
        'package.json': JSON.stringify({
            name: 'fixture-ui',
            main: 'index.js',
            dsh: { bundle: { patch: './cordis.patch.yml' } },
        }),
        'index.js': 'export default {}',
        'cordis.patch.yml': [
            '# 裸名行',
            '- id: fixture-ui',
            '  name: "fixture-ui"',
            '# 最近祖先 manifest 行',
            '- id: fixture-ui-declarations',
            `  name: "file:///${other.replace(/\\/g, '/')}/fixture-entry.js"`,
        ].join('\n'),
    });
    const r = inspectPluginDir(dir);
    const f = r.findings.find(x => x.code === 'duplicate-loader-source');
    assert.ok(f, '必须检出 duplicate-loader-source');
    assert.equal(f.severity, 'error');
    assert.equal(f.packageName, 'fixture-ui');
    assert.equal(riskOf(f.code), 'blocker');
    assert.equal(r.willBlockStartup, true, '这必须被判为「会导致宿主起不来」');
});
test('事故夹具：codex + claude-code 同指 dsh-tool-subagent → 合成层才炸', () => {
    const common = {
        'package.json': JSON.stringify({
            name: 'PLACEHOLDER', main: 'index.js',
            dsh: { bundle: { patch: './cordis.patch.yml' } },
        }),
        'index.js': 'export default {}',
    };
    const a = makePlugin({
        ...common,
        'package.json': JSON.stringify({ ...JSON.parse(common['package.json']), name: 'dsh-subagent-codex' }),
        'cordis.patch.yml': "- insert:\n    - id: subagent-codex\n      name: '@deepseek-ai/dsh-subagent-codex'\n    - id: tool-subagent-codex\n      name: '@deepseek-ai/dsh-tool-subagent'\n",
    });
    const b = makePlugin({
        ...common,
        'package.json': JSON.stringify({ ...JSON.parse(common['package.json']), name: 'dsh-subagent-claude-code' }),
        'cordis.patch.yml': "- insert:\n    - id: subagent-claude-code\n      name: '@deepseek-ai/dsh-subagent-claude-code'\n    - id: tool-subagent-claude-code\n      name: '@deepseek-ai/dsh-tool-subagent'\n",
    });
    assert.equal(inspectPluginDir(a).findings.filter(f => f.severity === 'error').length, 0, 'codex 单包应干净');
    assert.equal(inspectPluginDir(b).findings.filter(f => f.severity === 'error').length, 0, 'claude 单包应干净');
    const layers = [readLayer(a, 'cordis.patch.yml', 'codex'), readLayer(b, 'cordis.patch.yml', 'claude')];
    const composed = simulateComposition(layers);
    const f = composed.findings.find(x => x.code === 'duplicate-loader-source');
    assert.ok(f, '合成层必须检出重复 Loader 源');
    assert.equal(f.packageName, '@deepseek-ai/dsh-tool-subagent');
    assert.equal(composed.duplicates.length, 1);
});
test('同层同 baseUrl 的同名行不重复计数（宿主按 (loaderName, baseUrl) 去重）', () => {
    const dir = makePlugin({
        'package.json': JSON.stringify({ name: 'obsidian-suite', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
        'index.js': 'export default {}',
        'cordis.patch.yml': [
            '- insert:',
            '    - id: mcp-a',
            "      name: '@deepseek-ai/dsh-mcp-client'",
            '    - id: mcp-b',
            "      name: '@deepseek-ai/dsh-mcp-client'",
        ].join('\n'),
    });
    const r = inspectPluginDir(dir);
    assert.equal(r.findings.filter(f => f.code === 'duplicate-loader-source').length, 0, '同层同名不同 id 是合法的「同一插件开两个实例」写法，不该误报');
});
test('R2：缺 dsh.bundle.patch → blocker（宿主静默跳过）', () => {
    const dir = makePlugin({
        'package.json': JSON.stringify({ name: 'x', main: 'index.js' }),
        'index.js': 'export default {}',
    });
    const r = inspectPluginDir(dir);
    const f = r.findings.find(x => x.code === 'no-bundle');
    assert.ok(f);
    assert.equal(riskOf('no-bundle'), 'blocker');
});
test('未构建的源码：入口不存在 → startup 级（而不是放过去）', () => {
    const dir = makePlugin({
        'package.json': JSON.stringify({
            name: 'y', main: 'lib/index.js',
            dsh: { bundle: { patch: './cordis.patch.yml' } },
        }),
        'cordis.patch.yml': '- id: y\n  name: "y"\n',
    });
    const r = inspectPluginDir(dir);
    const f = r.findings.find(x => x.code === 'entry-missing');
    assert.ok(f, '入口不存在必须报出来——tsc exit 0 不代表产物在');
    assert.equal(riskOf(f.code), 'startup');
});
test('R5：宿主半边裸导入 @deepseek-ai/* 且未声明 → startup', () => {
    const dir = makePlugin({
        'package.json': JSON.stringify({ name: 'z', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
        'cordis.patch.yml': '- id: z\n  name: "z"\n',
        'lib/index.js': "import { defineTool } from '@deepseek-ai/dsh-tools'\nexport default {}\n",
    });
    const r = inspectPluginDir(dir);
    const f = r.findings.find(x => x.code === 'bare-host-import');
    assert.ok(f, '未声明的裸导入必须报');
    assert.equal(riskOf(f.code), 'startup');
});
test('vendor 目录不参与裸导入扫描（自包含不算裸导入）', () => {
    const dir = makePlugin({
        'package.json': JSON.stringify({ name: 'v', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
        'cordis.patch.yml': '- id: v\n  name: "v"\n',
        'lib/index.js': 'export default {}\n',
        'vendor/thing.js': "import x from '@deepseek-ai/whatever'\n",
    });
    const r = inspectPluginDir(dir);
    assert.equal(r.findings.filter(f => f.code === 'bare-host-import').length, 0);
});
test('tally：三级严重度 × 四级风险都要正确归类', () => {
    const t = tally([
        { severity: 'error', code: 'duplicate-loader-source' },
        { severity: 'error', code: 'no-bundle' },
        { severity: 'warn', code: 'compat-partial-line' },
        { severity: 'info', code: 'client-platform' },
    ]);
    assert.equal(t.bySeverity.error, 2);
    assert.equal(t.bySeverity.warn, 1);
    assert.equal(t.byRisk.blocker, 2);
    assert.equal(t.byRisk.cosmetic, 2);
});
test('未知检查码归到 cosmetic 而不是丢弃', () => {
    assert.equal(riskOf('some-future-check'), 'cosmetic');
    for (const r of RISK_ORDER)
        assert.equal(typeof r, 'string');
});
