#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMany, simulateComposition, readLayer, riskOf, RISK_ORDER } from '../lib/inspect.js';
import { SUPPORTED_HOST_VERSIONS, DUAL_RANGE } from '../lib/compat.js';
import { findStaleMounts, verifyMounts } from '../lib/deploy.js';
import { mountedComposition } from '../lib/composition.js';
const HUB = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
const profileDir = val('--profile');
const catalog = JSON.parse(readFileSync(join(HUB, 'catalog.json'), 'utf8'));
const entries = [];
entries.push({ dir: HUB, name: catalog.hub.name, id: 'hub', built: existsSync(join(HUB, 'lib/index.js')) });
for (const p of catalog.plugins) {
    for (const pkgName of p.unit) {
        const dir = join(HUB, 'plugins', pkgName.replace(/^@[^/]+\//, ''));
        entries.push({ dir, name: pkgName, id: p.id, built: existsSync(join(dir, 'lib', 'index.js')) });
    }
}
for (const name of catalog.adapterDependencies ?? []) {
    const dir = join(HUB, 'plugins', name.replace(/^@[^/]+\//, ''));
    entries.push({ dir, name, id: 'adapter', built: existsSync(join(dir, 'lib/index.js')) });
}
const present = entries.filter(e => e.built).map(e => e.dir);
const missing = entries.filter(e => !e.built);
const res = inspectMany(present, { profileDir, versions: SUPPORTED_HOST_VERSIONS });
const { layers, unavailable } = mountedComposition(HUB, profileDir);
const composed = layers.length > 0 ? simulateComposition(layers) : { findings: [], duplicates: [] };
const stale = profileDir === undefined ? [] : findStaleMounts(profileDir);
if (has('--json')) {
    console.log(JSON.stringify({
        hub: catalog.hub,
        supportedHostVersions: SUPPORTED_HOST_VERSIONS,
        enginesDsh: DUAL_RANGE,
        entries: entries.map(e => ({ ...e, ok: inspectMany([e.dir], { profileDir }).results[0] })),
        totals: res.totals,
        byRisk: res.byRisk,
        willBlockStartup: res.willBlockStartup,
        composition: composed.findings,
        unavailableLayers: unavailable,
        staleMounts: stale,
    }, null, 2));
    process.exit(missing.length > 0 || res.totals.error > 0 || composed.findings.length > 0 ? 1 : 0);
}
const ICON = { error: '✖', warn: '▲', info: '·', ok: '✔' };
const L = [];
L.push(`插件板 · ${catalog.hub.displayName}  (${HUB})`);
L.push(`catalog 登记 ${entries.length} 个包 · 受支持宿主版本线：${SUPPORTED_HOST_VERSIONS.join('  ·  ')}`);
L.push(`engines.dsh = ${DUAL_RANGE}`);
L.push('');
if (missing.length > 0) {
    L.push(`${ICON.warn} 未构建 ${missing.length} 个：${missing.map(m => m.name.replace('@deepseek-ai/', '')).join(', ')}`);
    L.push('  → 跑 node scripts/build-targets.mjs');
    L.push('');
}
for (const r of res.results) {
    const mark = r.verdict === 'clean' ? ICON.ok : r.findings.some(f => f.severity === 'error') ? ICON.error : ICON.warn;
    L.push(`${mark} ${r.name}  ${r.version ?? ''}`);
    for (const f of r.findings)
        L.push(`    ${ICON[f.severity] ?? '?'} [${riskOf(f.code)}] ${f.code}: ${f.message}`);
}
L.push('');
L.push('── 跨作用域合成（组合层，单包全绿也不等于安全） ──');
if (layers.length === 0)
    L.push(`${ICON.info} 没有可合成的补丁层`);
else if (composed.findings.length === 0)
    L.push(`${ICON.ok} ${layers.length} 层，无重复 Loader 源`);
else
    for (const f of composed.findings)
        L.push(`${ICON.error} ${f.code}: ${f.message}`);
if (unavailable.length)
    L.push(`· 未读取宿主内置层：${unavailable.join(', ')}；完整组合需要真实宿主预启动证据。`);
if (profileDir !== undefined) {
    L.push('');
    L.push(`── profile: ${profileDir} ──`);
    L.push(stale.length === 0 ? `${ICON.ok} 无未声明的挂载残留` : `${ICON.warn} ${stale.length} 个陈旧挂载：`);
    for (const s of stale)
        L.push(`  · ${s.entry} → ${s.pkgName}`);
    const v = verifyMounts(profileDir, [catalog.hub.name]);
    for (const m of v)
        L.push(`  ${m.ok ? ICON.ok : ICON.info} 挂载 ${m.name}: ${m.kind}${m.realpath ? ` → ${m.realpath}` : ''}`);
}
L.push('');
L.push(`风险分诊：${RISK_ORDER.map(r => `${r}=${res.byRisk[r]}`).join('  ')}`);
L.push(`合计：${ICON.error} ${res.totals.error}  ${ICON.warn} ${res.totals.warn}  ${ICON.info} ${res.totals.info}`);
console.log(L.join('\n'));
const blockers = res.willBlockStartup || composed.findings.some(f => f.severity === 'error');
console.log('');
console.log(blockers
    ? `${ICON.error} 存在 blocker —— 挂上去会导致宿主起不来或连带清空 profile`
    : res.totals.error > 0
        ? `${ICON.warn} 无 blocker，但有 error 项`
        : `${ICON.ok} 无阻断项`);
process.exit(missing.length > 0 || res.totals.error > 0 || composed.findings.some(f => f.severity === 'error') ? 1 : 0);
