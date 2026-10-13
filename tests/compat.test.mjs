import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUAL_RANGE, SUPPORTED_HOST_VERSIONS, satisfies, coversAll, auditCompat, auditSelf, compareVersions, parseVersion, } from '../lib/compat.js';
test('satisfies: 单线区间的预发布语义（node-semver 规则）', () => {
    assert.equal(satisfies('0.2.1-alpha.2', '>=0.2.1-0 <0.3'), true);
    assert.equal(satisfies('0.2.1-alpha.2', '>=0.2.0-0 <0.3'), false);
    assert.equal(satisfies('0.2.0', '>=0.2.0-0 <0.3'), true);
});
test('双版本区间：OR 写法同时接住 0.2.0-rc.2 与 0.2.1-alpha.2', () => {
    for (const v of SUPPORTED_HOST_VERSIONS) {
        assert.equal(satisfies(v, DUAL_RANGE), true, `DUAL_RANGE 应接住 ${v}`);
    }
});
test('双版本区间：AND 写法会丢掉 0.2.0 线（防回归）', () => {
    const wrong = '>=0.2.0-0 <0.3 >=0.2.1-0 <0.3';
    assert.equal(satisfies('0.2.1-alpha.2', wrong), true);
    assert.equal(satisfies('0.2.0-rc.2', wrong), false);
    assert.equal(coversAll(wrong).all, false);
    assert.equal(coversAll(wrong).any, true);
    assert.equal(coversAll(DUAL_RANGE).all, true);
    assert.equal(satisfies('0.2.0-rc.2', DUAL_RANGE), true);
    assert.equal(satisfies('0.2.1-alpha.2', DUAL_RANGE), true);
});
test('双版本区间：两条线的正式版本与 rc/beta 都被接住', () => {
    for (const v of ['0.2.0', '0.2.0-rc.2', '0.2.0-rc.9', '0.2.1-0', '0.2.1-alpha.2', '0.2.1', '0.2.9']) {
        assert.equal(satisfies(v, DUAL_RANGE), true, `DUAL_RANGE 应接住 ${v}`);
    }
    assert.equal(satisfies('0.3.0', DUAL_RANGE), false);
    assert.equal(satisfies('0.1.9', DUAL_RANGE), false);
});
test('compareVersions: prerelease 小于正式版本', () => {
    assert.ok(compareVersions('0.2.1-alpha.2', '0.2.1') < 0);
    assert.ok(compareVersions('0.2.0-rc.2', '0.2.1-alpha.2') < 0);
    assert.equal(compareVersions('0.2.1-alpha.2', '0.2.1-alpha.2'), 0);
    assert.ok(compareVersions('0.2.1-alpha.2', '0.2.1-alpha.10') < 0);
});
test('回归：上界 <0.3 必须真的生效，不能被静默丢弃', () => {
    assert.equal(satisfies('0.3.0', '>=0.2.1-0 <0.3'), false);
    assert.equal(satisfies('0.3.0', DUAL_RANGE), false);
    assert.equal(satisfies('0.2.9', DUAL_RANGE), true);
    assert.equal(satisfies('0.2.99', '>=0.2.1-0 <0.3'), true);
    assert.equal(satisfies('0.3.0', '<0.3'), false);
    assert.equal(satisfies('0.2.99', '<0.3'), true);
});
test('回归：解析不了的比较器必须失败关闭，不得让区间变宽', () => {
    assert.equal(satisfies('0.3.0', '>=0.2.1-0 <0.3.x'), false);
    assert.equal(satisfies('0.9.9', '>=0.2.1-0 <nonsense'), false);
    assert.equal(satisfies('9.9.9', '*'), true);
    assert.equal(satisfies('9.9.9', '>=0.2.1-0 x'), true);
    assert.equal(satisfies('9.9.9', '>=0.2.1-0 <*'), false);
});
test('parseVersion: 部分版本补 0', () => {
    assert.deepEqual(pick(parseVersion('1')), [1, 0, 0, []]);
    assert.deepEqual(pick(parseVersion('1.2')), [1, 2, 0, []]);
    assert.deepEqual(pick(parseVersion('1.2.3')), [1, 2, 3, []]);
    assert.deepEqual(pick(parseVersion('1.2.3-rc.1')), [1, 2, 3, ['rc', '1']]);
    assert.equal(parseVersion('not-a-version'), undefined);
});
function pick(v) {
    return v === undefined ? undefined : [v.major, v.minor, v.patch, v.prerelease];
}
test('coversAll: 只覆盖一条线算 any=true 但 all=false', () => {
    const only021 = coversAll('>=0.2.1-0 <0.3');
    assert.equal(only021.any, true);
    assert.equal(only021.all, false);
    const both = coversAll(DUAL_RANGE);
    assert.equal(both.all, true);
});
test('auditCompat 分档：未声明/单线/全线', () => {
    const none = auditCompat({ name: 'x' });
    assert.equal(none.findings[0].severity, 'warn');
    assert.equal(none.findings[0].code, 'compat-undeclared');
    const partial = auditCompat({ name: 'y', engines: { dsh: '>=0.2.1-0 <0.3' } });
    const pf = partial.findings.find(f => f.code === 'compat-partial-line');
    assert.equal(pf.severity, 'warn');
    assert.deepEqual(pf.missed, ['0.2.0-rc.2']);
    const none2 = auditCompat({ name: 'z', engines: { dsh: '>=0.1.7-rc.1 <0.3' } });
    const nf = none2.findings.find(f => f.code === 'compat-no-line');
    assert.equal(nf.severity, 'error');
    const ok = auditCompat({ name: 'w', engines: { dsh: DUAL_RANGE } });
    assert.equal(ok.findings.filter(f => f.severity !== 'info').length, 0);
});
test('auditSelf：本插件自身区间覆盖全部受支持版本线', () => {
    const s = auditSelf();
    assert.equal(s.ok, true, `自身区间未覆盖全部版本线：${JSON.stringify(s.per)}`);
    assert.equal(s.per.length, SUPPORTED_HOST_VERSIONS.length);
});
