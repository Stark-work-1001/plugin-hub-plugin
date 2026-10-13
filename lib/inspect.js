import { readFileSync, existsSync, statSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { auditCompat, coversAll, SUPPORTED_HOST_VERSIONS } from './compat.js';
export function parseTopLevelRows(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);
    let inInsert = false;
    let insertIndent = -1;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (raw.trim() === '' || raw.trimStart().startsWith('#'))
            continue;
        const indent = raw.length - raw.trimStart().length;
        const trimmed = raw.trim();
        if (indent === 0 && trimmed.startsWith('- ')) {
            const body = trimmed.slice(2);
            inInsert = false;
            if (body.startsWith('insert:')) {
                inInsert = true;
                insertIndent = -1;
                continue;
            }
            const row = { id: scalar(body.slice('id:'.length)), name: undefined, line: i + 1 };
            if (row.id !== undefined)
                rows.push(row);
            continue;
        }
        if (!inInsert && indent === 2 && trimmed.startsWith('name:') && rows.length > 0) {
            rows[rows.length - 1].name ??= scalar(trimmed.slice('name:'.length));
            continue;
        }
        if (inInsert && indent > 0) {
            if (insertIndent === -1) {
                if (!trimmed.startsWith('- ')) {
                    inInsert = false;
                    continue;
                }
                insertIndent = indent;
            }
            if (indent < insertIndent) {
                inInsert = false;
                continue;
            }
            if (indent === insertIndent) {
                const body = trimmed.slice(2);
                if (body.startsWith('id:')) {
                    rows.push({ id: scalar(body.slice('id:'.length)), name: undefined, line: i + 1 });
                }
                continue;
            }
            if (indent === insertIndent + 2 && trimmed.startsWith('name:') && rows.length > 0) {
                rows[rows.length - 1].name ??= scalar(trimmed.slice('name:'.length));
            }
            continue;
        }
    }
    return rows;
}
function scalar(v) {
    const s = String(v).trim().replace(/\s+#.*$/, '').trim();
    if (s === '')
        return undefined;
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))
        return s.slice(1, -1);
    return s;
}
function nearestManifest(startPath) {
    let dir = statSync(startPath, { throwIfNoEntry: false })?.isDirectory() ? startPath : dirname(startPath);
    for (;;) {
        const candidate = join(dir, 'package.json');
        if (existsSync(candidate))
            return candidate;
        const parent = dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
function readJson(p) {
    try {
        return JSON.parse(readFileSync(p, 'utf8'));
    }
    catch {
        return undefined;
    }
}
export function resolveRowPackage(rowName, baseDir, selfName) {
    if (rowName === undefined)
        return { packageName: undefined, resolved: false, kind: 'no-name' };
    if (rowName.startsWith('cordis:'))
        return { packageName: undefined, resolved: false, kind: 'cordis-group' };
    const pathLike = rowName.startsWith('.') || rowName.startsWith('file:') || isAbsolute(rowName);
    if (!pathLike) {
        if (rowName === selfName)
            return { packageName: selfName, resolved: true, kind: 'self' };
        let dir = baseDir;
        for (;;) {
            const candidate = join(dir, 'node_modules', rowName, 'package.json');
            if (existsSync(candidate)) {
                return { packageName: readJson(candidate)?.name ?? rowName, resolved: true, kind: 'node_modules' };
            }
            const parent = dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        if (rowName.startsWith('@deepseek-ai/')) {
            return { packageName: rowName, resolved: true, kind: 'host' };
        }
        return { packageName: rowName, resolved: false, kind: 'unresolved' };
    }
    let asPath = rowName;
    if (asPath.startsWith('file:')) {
        asPath = asPath.slice('file:'.length);
        if (asPath.startsWith('///'))
            asPath = asPath.slice(2);
    }
    asPath = asPath.replace(/^\/([A-Za-z]:)/, '$1');
    const abs = isAbsolute(asPath) ? asPath : resolve(baseDir, asPath);
    const manifest = nearestManifest(abs);
    if (manifest === undefined)
        return { packageName: undefined, resolved: false, kind: 'no-manifest' };
    return { packageName: readJson(manifest)?.name ?? undefined, resolved: true, kind: 'path', manifest };
}
function entryPath(pkg) {
    const dot = pkg?.exports?.['.'];
    if (typeof dot === 'string')
        return dot;
    if (dot && typeof dot === 'object')
        return dot.default ?? dot.import;
    return pkg?.main;
}
export function clientExportPath(pkg) {
    const e = pkg?.exports?.['./client'];
    if (e === undefined)
        return undefined;
    if (typeof e === 'string')
        return e;
    if (typeof e === 'object')
        return e.default ?? e.import;
    return undefined;
}
export const RISK_CLASS = Object.freeze({
    'duplicate-loader-source': 'blocker',
    'stale-link-duplicate': 'blocker',
    'bundle-without-dep': 'blocker',
    'no-bundle': 'blocker',
    'mount-missing': 'blocker',
    'link-target-missing': 'blocker',
    'link-target-drift': 'blocker',
    'bare-host-import': 'startup',
    'declared-dep-not-installed': 'startup',
    'entry-missing': 'startup',
    'no-manifest': 'startup',
    'manifest-unparsable': 'startup',
    'no-entry': 'startup',
    'client-export-missing': 'startup',
    'client-file-missing': 'startup',
    'dangling-profile-path': 'silent',
    'compat-no-line': 'startup',
    'compat-unparsable': 'startup',
    'no-name': 'startup',
    'compat-partial-line': 'cosmetic',
    'compat-undeclared': 'cosmetic',
    'no-engine-dsh': 'cosmetic',
    'engine-range-drift': 'cosmetic',
    'copy-install': 'cosmetic',
    'not-link': 'cosmetic',
    'dep-without-bundle': 'cosmetic',
    'aliased-mount': 'cosmetic',
    'undeclared-mount': 'cosmetic',
    'client-platform': 'cosmetic',
});
export const RISK_ORDER = Object.freeze(['blocker', 'startup', 'silent', 'cosmetic']);
export const RISK_MEANING = Object.freeze({
    blocker: '会导致宿主起不来，或触发 disableAllPlugins() 把整个 profile 回退',
    startup: '会导致本插件 failed to import，宿主能起但这个插件没了',
    silent: '静默失效：不报错、不进日志，事后极难查',
    cosmetic: '声明性问题，当前宿主构建不强制执行',
});
export function riskOf(code) {
    return RISK_CLASS[code] ?? 'cosmetic';
}
export function auditPluginDir(dir, options = {}) {
    const findings = [];
    const add = (severity, code, message, extra = {}) => findings.push({ severity, code, message, ...extra });
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) {
        add('error', 'no-manifest', `${dir} 下没有 package.json，不是插件包`);
        return { dir, name: null, findings, rows: [], ok: false };
    }
    const pkg = readJson(manifestPath);
    if (pkg === undefined) {
        add('error', 'manifest-unparsable', `${manifestPath} 解析失败`);
        return { dir, name: null, findings, rows: [], ok: false };
    }
    const name = pkg.name ?? null;
    if (!name)
        add('error', 'no-name', 'package.json 缺少 name');
    const entry = entryPath(pkg);
    if (!entry)
        add('error', 'no-entry', 'package.json 既没有 main 也没有 exports["."]');
    else if (!existsSync(join(dir, entry.replace(/^\.\//, ''))))
        add('error', 'entry-missing', `入口文件不存在：${entry} —— 这包是源码，没构建过`);
    const bundlePatch = pkg.dsh?.bundle?.patch;
    const patchFiles = bundlePatch === undefined ? [] : (typeof bundlePatch === 'string' ? [bundlePatch] : bundlePatch);
    const owner = dirname(dirname(dir));
    const ownerManifest = readJson(join(owner, 'package.json'));
    const ownerCatalog = readJson(join(owner, 'catalog.json'));
    const internal = pkg.pluginHub?.mount === 'internal' && pkg.pluginHub?.owner === ownerManifest?.name &&
        !!ownerManifest?.dsh?.bundle?.patch &&
        [...(ownerCatalog?.plugins ?? []).flatMap(p => p.unit), ...(ownerCatalog?.adapterDependencies ?? [])].includes(pkg.name);
    const coMounted = internal || options.coMountedBy?.has(pkg.name) === true;
    if (bundlePatch === undefined) {
        if (coMounted) {
            add('info', 'co-mounted', internal ? '本包由插件板内部组合挂载，不作为独立 bundle 登记' :
                '本包被其他 bundle 共载，不需自备装配层');
        }
        else {
            add('error', 'no-bundle', 'package.json 没有 dsh.bundle.patch —— 宿主会把它静默跳过，不报任何错');
        }
    }
    else {
        for (const f of patchFiles) {
            if (!existsSync(join(dir, f)))
                add('error', 'bundle-patch-missing', `dsh.bundle.patch 指向的文件不存在：${f}`);
        }
    }
    const rows = [];
    for (const pf of patchFiles) {
        const p = join(dir, pf);
        if (!existsSync(p))
            continue;
        for (const row of parseTopLevelRows(readFileSync(p, 'utf8'))) {
            const r = resolveRowPackage(row.name, dir, name ?? undefined);
            rows.push({ ...row, patchFile: pf, ...r });
        }
    }
    const byPackage = new Map();
    for (const row of rows) {
        if (!row.resolved || row.packageName === undefined)
            continue;
        if (!byPackage.has(row.packageName))
            byPackage.set(row.packageName, new Map());
        byPackage.get(row.packageName).set(row.name ?? `<无 name，line ${row.line}>`, row);
    }
    for (const [packageName, sources] of byPackage) {
        if (sources.size > 1) {
            add('error', 'duplicate-loader-source', `包 ${packageName} 被 ${sources.size} 条 Loader 行同时解析到，宿主会在 compose 阶段抛 ` +
                `"resolves from multiple active Loader sources" → required 插件 modules 失败 → ` +
                `宿主起不来 → disableAllPlugins() 把 profile 回退`, { packageName, sources: [...sources.keys()] });
        }
    }
    const clientDecl = pkg.dsh?.client;
    if (clientDecl !== undefined) {
        const rel = clientExportPath(pkg);
        if (rel === undefined) {
            add('error', 'client-export-missing', '声明了 dsh.client 但 exports 里没有 "./client"，宿主会抛 declares dsh.client but exports no "./client" bundle');
        }
        else if (!existsSync(join(dir, rel.replace(/^\.\//, '')))) {
            add('error', 'client-file-missing', `exports["./client"] 指向的文件不存在：${rel}`);
        }
        if (clientDecl.platform !== 'web') {
            add('info', 'client-platform', `dsh.client.platform = ${JSON.stringify(clientDecl.platform ?? null)}，非 "web" 不会被客户端模块注册表收录`);
        }
    }
    const versions = options.versions ?? SUPPORTED_HOST_VERSIONS;
    const compat = auditCompat(pkg, { versions });
    findings.push(...compat.findings);
    findings.push(...auditHostImports(dir, pkg));
    const profile = options.profileDir ? readProfile(options.profileDir) : undefined;
    if (profile !== undefined && name !== null) {
        const inDeps = Object.prototype.hasOwnProperty.call(profile.dependencies, name);
        const inBundles = profile.bundles.includes(name);
        if (inBundles && !inDeps)
            add('error', 'bundle-without-dep', `profile 的 bundles 列了 ${name}，但 dependencies 里没有 —— 宿主解析不到包目录`);
        if (inDeps && !inBundles)
            add('warn', 'dep-without-bundle', `profile 装了 ${name}，但 bundles 里没有 —— 装了不会生效`);
        if (inDeps) {
            const spec = profile.dependencies[name];
            const specKind = spec.startsWith('link:') ? 'link' : spec.startsWith('file:') ? 'file(拷贝)' : '版本号';
            if (specKind !== 'link')
                add('warn', 'not-link', `profile 里 ${name} 是 ${specKind} 安装，改源码不即时生效`);
        }
    }
    const ok = !findings.some(f => f.severity === 'error');
    return { dir, name, version: pkg.version ?? null, findings, rows, ok, compat, packageJson: pkg };
}
const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"](@deepseek-ai\/[^'"]+)['"]/g;
const R5_EXEMPT = new Set(['@deepseek-ai/schemastery', '@deepseek-ai/cosmokit']);
export function resolveFrom(fromDir, pkgName) {
    let dir = resolve(fromDir);
    for (;;) {
        const candidate = join(dir, 'node_modules', ...pkgName.split('/'));
        if (existsSync(join(candidate, 'package.json')))
            return candidate;
        const parent = dirname(dir);
        if (parent === dir)
            return undefined;
        dir = parent;
    }
}
export function auditHostImports(dir, pkg) {
    const findings = [];
    const clientFiles = new Set();
    const clientRel = clientExportPath(pkg);
    if (typeof clientRel === 'string') {
        const rel = clientRel.replace(/^\.\//, '');
        clientFiles.add(norm(join(dir, rel)));
        const base = rel.replace(/\.[cm]?js$/, '');
        for (const ext of ['.js', '.mjs', '.cjs'])
            clientFiles.add(norm(join(dir, base + ext)));
    }
    const hits = [];
    for (const sub of ['lib', 'dist', 'src', 'index.js']) {
        const p = join(dir, sub);
        if (!existsSync(p))
            continue;
        collectJs(p, hits, clientFiles);
    }
    for (const { spec, file } of hits) {
        const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (R5_EXEMPT.has(pkgName))
            continue;
        if (resolveFrom(dir, pkgName) !== undefined)
            continue;
        const declared = Object.prototype.hasOwnProperty.call(pkg?.dependencies ?? {}, pkgName)
            || Object.prototype.hasOwnProperty.call(pkg?.peerDependencies ?? {}, pkgName);
        findings.push({
            severity: 'error',
            code: declared ? 'declared-dep-not-installed' : 'bare-host-import',
            message: declared
                ? `宿主半边裸导入 ${pkgName}，它已写进 ${'dependencies/peerDependencies'}，` +
                    '但沿 realpath 向上逐级都找不到它 —— link 安装下宿主也解析不到，插件会 failed to import'
                : `宿主半边裸导入 ${pkgName}，且没有写进 dependencies —— 宿主 app.asar 里的 @deepseek-ai/* ` +
                    '对 link 安装的包不可见，插件会 failed to import。宿主能力一律经 Cordis inject + ctx 取得',
            file,
        });
    }
    return findings;
}
function collectJs(dir, out, clientFiles) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of entries) {
        if (['node_modules', 'vendor', 'tests', 'types', 'typings', '.git'].includes(e.name))
            continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            collectJs(full, out, clientFiles);
            continue;
        }
        if (!/\.(js|mjs|cjs)$/.test(e.name))
            continue;
        if (e.name.endsWith('.d.ts'))
            continue;
        if (clientFiles.has(norm(full)))
            continue;
        let text;
        try {
            text = readFileSync(full, 'utf8');
        }
        catch {
            continue;
        }
        const re = new RegExp(IMPORT_RE.source, 'g');
        let m;
        while ((m = re.exec(text)) !== null) {
            if (out.some(h => h.file === full && h.spec === m[1]))
                continue;
            out.push({ file: full, spec: m[1] });
        }
    }
}
function norm(p) {
    if (!p)
        return p;
    let s = resolve(p);
    if (s.length > 3)
        s = s.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? s.toLowerCase() : s;
}
export function readProfile(profileDir) {
    const j = readJson(join(profileDir, 'package.json'));
    if (j === undefined)
        return undefined;
    return { dependencies: j.dependencies ?? {}, bundles: j.dsh?.profile?.bundles ?? [] };
}
export function listPluginDirs(root) {
    if (!existsSync(root))
        return [];
    return readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
        .map(d => join(root, d.name))
        .filter(d => existsSync(join(d, 'package.json')))
        .sort();
}
export function tally(findings) {
    const bySeverity = { error: 0, warn: 0, info: 0 };
    const byRisk = Object.fromEntries(RISK_ORDER.map(r => [r, 0]));
    for (const f of findings) {
        if (f.severity === 'error')
            bySeverity.error++;
        else if (f.severity === 'warn')
            bySeverity.warn++;
        else
            bySeverity.info++;
        byRisk[riskOf(f.code)]++;
    }
    return { bySeverity, byRisk };
}
export function inspectPluginDir(dir, options = {}) {
    const r = auditPluginDir(dir, options);
    const { bySeverity, byRisk } = tally(r.findings);
    const blockers = r.findings.filter(f => riskOf(f.code) === 'blocker' && f.severity === 'error');
    return {
        ...r,
        totals: bySeverity,
        byRisk,
        blockers,
        willBlockStartup: blockers.length > 0,
        verdict: blockers.length > 0 ? 'blocker'
            : byRisk.startup > 0 ? 'startup'
                : byRisk.silent > 0 ? 'silent'
                    : byRisk.cosmetic > 0 ? 'cosmetic' : 'clean',
    };
}
export function computeCoMounted(dirs) {
    const ownPatches = new Map();
    for (const dir of dirs) {
        const manifest = readJson(join(dir, 'package.json'));
        const self = manifest?.name;
        const set = new Set();
        if (self !== undefined)
            set.add(self);
        const bp = manifest?.dsh?.bundle?.patch;
        if (bp !== undefined) {
            for (const pf of typeof bp === 'string' ? [bp] : bp) {
                const p = join(dir, pf);
                if (existsSync(p)) {
                    for (const m of readFileSync(p, 'utf8').matchAll(/^\s+name:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) {
                        set.add(m[1].trim());
                    }
                }
            }
        }
        ownPatches.set(dir, set);
    }
    const declared = new Map();
    for (const [dir, set] of ownPatches) {
        for (const n of set) {
            if (!declared.has(n))
                declared.set(n, dir);
        }
    }
    const coMounted = new Set();
    for (const dir of dirs) {
        const manifest = readJson(join(dir, 'package.json'));
        const self = manifest?.name;
        if (self === undefined)
            continue;
        if (manifest?.dsh?.bundle?.patch !== undefined)
            continue;
        const by = declared.get(self);
        if (by !== undefined && by !== dir)
            coMounted.add(self);
    }
    return coMounted;
}
export function inspectMany(dirs, options = {}) {
    const coMountedBy = options.coMountedBy ?? computeCoMounted(dirs);
    const results = dirs.map(d => inspectPluginDir(d, { ...options, coMountedBy }));
    const merged = results.flatMap(r => r.findings);
    const { bySeverity, byRisk } = tally(merged);
    return {
        results,
        totals: bySeverity,
        byRisk,
        ok: bySeverity.error === 0,
        willBlockStartup: results.some(r => r.willBlockStartup),
        verdict: results.some(r => r.willBlockStartup) ? 'blocker'
            : byRisk.startup > 0 ? 'startup'
                : byRisk.silent > 0 ? 'silent'
                    : byRisk.cosmetic > 0 ? 'cosmetic' : 'clean',
    };
}
export function simulateComposition(layers, options = {}) {
    const findings = [];
    const ids = new Map();
    const sources = new Map();
    for (const layer of layers) {
        for (const row of layer.rows) {
            const isNew = !ids.has(row.id);
            if (isNew)
                ids.set(row.id, layer.name);
            if (!isNew && !row.fromInsert)
                continue;
            if (!row.resolved || row.packageName === undefined)
                continue;
            const key = `${row.name}@${norm(layer.dir)}`;
            if (!sources.has(row.packageName))
                sources.set(row.packageName, new Map());
            const bucket = sources.get(row.packageName);
            if (!bucket.has(key)) {
                bucket.set(key, { loaderName: row.name, base: layer.dir, id: row.id, patchFile: row.patchFile });
            }
        }
    }
    for (const [packageName, bucket] of sources) {
        if (bucket.size <= 1)
            continue;
        findings.push({
            severity: 'error',
            code: 'duplicate-loader-source',
            message: `包 ${packageName} 在合成后的补丁树里被 ${bucket.size} 个 Loader 源同时解析到` +
                ' —— 宿主 compose 阶段会抛 "resolves from multiple active Loader sources"，' +
                'required 插件 modules 失败 → 宿主起不来 → disableAllPlugins() 清空 profile',
            packageName,
            sources: [...bucket.keys()],
        });
    }
    return { findings, duplicates: [...sources].filter(([, b]) => b.size > 1).map(([n, b]) => ({ packageName: n, sources: [...b.values()] })) };
}
export function readLayer(dir, patchFile, label) {
    const abs = join(dir, patchFile);
    if (!existsSync(abs))
        return { name: label, dir, patchFile, rows: [] };
    const text = readFileSync(abs, 'utf8');
    const pkg = readJson(join(dir, 'package.json'));
    const inserts = insertIds(text);
    const rows = parseTopLevelRows(text).map(row => {
        const r = resolveRowPackage(row.name, dir, pkg?.name ?? undefined);
        return { ...row, ...r, patchFile, fromInsert: inserts.has(row.id) };
    });
    return { name: label, dir, patchFile, rows };
}
function insertIds(text) {
    const ids = new Set();
    const lines = text.split(/\r?\n/);
    let inInsert = false;
    let base = -1;
    for (const raw of lines) {
        if (raw.trim() === '' || raw.trimStart().startsWith('#'))
            continue;
        const indent = raw.length - raw.trimStart().length;
        const trimmed = raw.trim();
        if (indent === 0 && trimmed.startsWith('- ')) {
            inInsert = trimmed.slice(2).startsWith('insert:');
            base = -1;
            continue;
        }
        if (!inInsert || indent === 0)
            continue;
        if (base === -1) {
            if (!trimmed.startsWith('- ')) {
                inInsert = false;
                continue;
            }
            base = indent;
        }
        if (indent === base && trimmed.startsWith('- ')) {
            const body = trimmed.slice(2);
            if (body.startsWith('id:'))
                ids.add(body.slice(3).trim().replace(/^['"]|['"]$/g, ''));
        }
    }
    return ids;
}
export function mountKind(p) {
    let st;
    try {
        st = lstatSync(p);
    }
    catch {
        return 'absent';
    }
    if (st.isSymbolicLink())
        return 'link';
    if (!st.isDirectory())
        return 'file';
    try {
        if (norm(realpathSync(p)) !== norm(p))
            return 'link';
    }
    catch { }
    return 'copy';
}
