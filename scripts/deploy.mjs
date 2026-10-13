#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDeploy, verifyMounts } from '../lib/deploy.js';
const HUB = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const val = f => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
const only = (val('--only') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const profileDir = val('--profile');
if (profileDir === undefined) {
    console.error('用法：node scripts/deploy.mjs --profile <profileDir> [--apply] [--only id1,id2]');
    process.exit(2);
}
const res = planDeploy({ catalogDir: HUB, profileDir, only: only.length > 0 ? only : undefined, apply: argv.includes('--apply') });
const ICON = { error: '✖', warn: '▲', info: '·', ok: '✔' };
const L = [];
L.push(`部署目标：${profileDir}`);
L.push(res.applied ? '模式：执行' : '模式：只出计划（加 --apply 才写入）');
L.push('');
if (res.blockers.length > 0) {
    for (const b of res.blockers)
        L.push(`${ICON.error} [${b.code}] ${b.message}`);
    L.push('');
    L.push(`${ICON.error} 有阻断项，未写入任何东西。先跑 node scripts/build-targets.mjs。`);
    console.log(L.join('\n'));
    process.exit(1);
}
for (const item of res.plan) {
    L.push(`${item.pkgName}（${item.id}）`);
    for (const s of item.steps) {
        L.push(`  ${s.kind === 'noop' ? ICON.info : ICON.warn} [${s.kind}] ${s.what}`);
    }
}
for (const f of res.findings)
    L.push(`${ICON.warn} [${f.code}] ${f.message}`);
L.push('');
if (res.applied) {
    L.push(`${ICON.ok} 已执行。profile 已备份到 <hub>/.backups/`);
    L.push('① 用宿主 pnpm 离线更新锁文件：install --offline --lockfile-only --ignore-scripts');
    L.push('② 跑 node scripts/inspect.mjs --profile ' + profileDir + ' 确认无 blocker');
    L.push('③ 重启宿主并通过 Cordis Inspect 核查配置、工具和组件状态');
    L.push('   （没有新 crash 日志 / 没有新 .bak）');
}
else {
    L.push(`${ICON.info} 以上是计划，未写入任何东西`);
    const v = verifyMounts(profileDir, res.plan.map(p => p.pkgName));
    L.push('');
    L.push('当前挂载状态：');
    for (const m of v)
        L.push(`  ${m.ok ? ICON.ok : ICON.info} ${m.name}: ${m.kind}`);
}
console.log(L.join('\n'));
