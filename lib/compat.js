export const SUPPORTED_HOST_VERSIONS = Object.freeze([
    '0.2.0-rc.2',
    '0.2.1-alpha.2',
]);
export const DUAL_RANGE = '>=0.2.0-0 <0.3 || >=0.2.1-0 <0.3';
export const HOST_PROVIDED_PREFIX = '@deepseek-ai/';
export function parseVersion(v) {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim());
    if (!m)
        return undefined;
    return {
        major: Number(m[1]),
        minor: m[2] === undefined ? 0 : Number(m[2]),
        patch: m[3] === undefined ? 0 : Number(m[3]),
        prerelease: m[4] === undefined ? [] : m[4].split('.'),
    };
}
function cmpIdentifiers(a, b) {
    const an = /^\d+$/.test(a);
    const bn = /^\d+$/.test(b);
    if (an && bn)
        return Number(a) - Number(b);
    if (an)
        return -1;
    if (bn)
        return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}
function cmpPre(a, b) {
    if (a.length === 0 && b.length === 0)
        return 0;
    if (a.length === 0)
        return 1;
    if (b.length === 0)
        return -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i >= a.length)
            return -1;
        if (i >= b.length)
            return 1;
        const c = cmpIdentifiers(a[i], b[i]);
        if (c !== 0)
            return c;
    }
    return 0;
}
export function compareVersions(a, b) {
    const x = typeof a === 'string' ? parseVersion(a) : a;
    const y = typeof b === 'string' ? parseVersion(b) : b;
    if (!x || !y)
        return 0;
    for (const k of ['major', 'minor', 'patch']) {
        if (x[k] !== y[k])
            return x[k] - y[k];
    }
    return cmpPre(x.prerelease, y.prerelease);
}
function prereleaseAllowed(version, comparators) {
    if (version.prerelease.length === 0)
        return true;
    return comparators.some(c => {
        const s = c.semver;
        if (s.prerelease.length === 0)
            return false;
        return s.major === version.major && s.minor === version.minor && s.patch === version.patch;
    });
}
function parseComparator(raw) {
    const s = String(raw).trim();
    if (s === '' || s === '*' || s === 'x')
        return { op: '>=', semver: parseVersion('0.0.0'), any: true };
    const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(s);
    if (!m)
        return undefined;
    const op = m[1] ?? '=';
    const base = parseVersion(m[2]);
    if (!base)
        return undefined;
    let range = { op, semver: base, any: false };
    if (op === '^') {
        const upper = base.major > 0
            ? `${base.major + 1}.0.0-0`
            : base.minor > 0
                ? `0.${base.minor + 1}.0-0`
                : `0.0.${base.patch + 1}-0`;
        range = { op: '>=', semver: base, upper: parseVersion(upper), any: false };
    }
    else if (op === '~') {
        range = { op: '>=', semver: base, upper: parseVersion(`${base.major}.${base.minor + 1}.0-0`), any: false };
    }
    return range;
}
function comparatorHolds(version, c) {
    if (c.any)
        return true;
    if (c.op === '>=') {
        if (compareVersions(version, c.semver) < 0)
            return false;
        return c.upper ? compareVersions(version, c.upper) < 0 : true;
    }
    const cmp = compareVersions(version, c.semver);
    switch (c.op) {
        case '>': return cmp > 0;
        case '<=': return cmp <= 0;
        case '<': return cmp < 0;
        default: return cmp === 0;
    }
}
export function satisfies(version, range) {
    const v = parseVersion(version);
    if (!v)
        return undefined;
    if (typeof range !== 'string' || range.trim() === '')
        return undefined;
    return range.split('||').some(clause => {
        const raw = clause.trim().split(/\s+/);
        const comparators = raw.map(parseComparator);
        if (comparators.length === 0 || comparators.some(c => c === undefined))
            return false;
        if (!prereleaseAllowed(v, comparators))
            return false;
        return comparators.every(c => comparatorHolds(v, c));
    });
}
export function coversAll(range, versions = SUPPORTED_HOST_VERSIONS) {
    const per = versions.map(host => ({ host, ok: satisfies(host, range) }));
    return { per, all: per.every(x => x.ok === true), any: per.some(x => x.ok === true) };
}
export function auditCompat(pkg, options = {}) {
    const versions = options.versions ?? SUPPORTED_HOST_VERSIONS;
    const range = pkg?.engines?.dsh;
    const name = pkg?.name ?? null;
    const out = { name, range: range ?? null, versions, findings: [] };
    if (range === undefined || range === null || String(range).trim() === '') {
        out.findings.push({
            severity: 'warn',
            code: 'compat-undeclared',
            message: `${name} 没有 engines.dsh —— 无法约束宿主版本；` +
                `本插件的目标是同时支持 ${versions.join(' 与 ')}，未声明的包在两条线上都没有保护`,
        });
        return out;
    }
    const parsed = parseVersion(range);
    if (parsed === undefined && satisfies(versions[0], range) === undefined) {
        out.findings.push({
            severity: 'error',
            code: 'compat-unparsable',
            message: `${name} 的 engines.dsh="${range}" 无法解析`,
        });
        return out;
    }
    const { per, all, any } = coversAll(range, versions);
    out.per = per;
    if (!any) {
        out.findings.push({
            severity: 'error',
            code: 'compat-no-line',
            message: `${name} 声明 engines.dsh="${range}"，一条受支持版本线都接不住：` +
                per.map(p => `${p.host}=${p.ok === false ? '✘' : p.ok === true ? '✔' : '?'}`).join('  ') +
                ' —— 注意预发布语义：区间必须含有与目标版本**同 tuple 且带 prerelease** 的比较器',
        });
    }
    else if (!all) {
        const missed = per.filter(p => p.ok !== true).map(p => p.host);
        out.findings.push({
            severity: 'warn',
            code: 'compat-partial-line',
            message: `${name} 声明 engines.dsh="${range}"，只接住部分版本线；` +
                `未覆盖：${missed.join(', ')}。跨版本线部署时这会在另一条线上变成装不上`,
            missed,
        });
    }
    return out;
}
export function auditSelf(range = DUAL_RANGE, versions = SUPPORTED_HOST_VERSIONS) {
    const { per, all } = coversAll(range, versions);
    return { range, per, ok: all };
}
