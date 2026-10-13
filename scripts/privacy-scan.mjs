import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['.git', '.work', '.backups', 'results']);
const patterns = [
    ['machine-workspace', /[A-Za-z]:[\\/](?:[^\s"'<>]*[\\/])?(?:\.agent-core|\.agent-download|dsh-desktop)(?:[\\/]|\b)/i],
    ['windows-user-home', /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+[\\/]/i],
    ['private-session-id', /(?:dsh-session-session-|session-)[0-9a-f]{8}-[0-9a-f-]{27,}/i],
    ['credential-value', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{25,})\b/],
];
const findings = [];
let checked = 0;
function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, e.name);
        if (skip.has(e.name) || e.isSymbolicLink() || e.name.endsWith('.zip'))
            continue;
        if (e.isDirectory()) {
            walk(file);
            continue;
        }
        if (/^\.env(?:\.|$)/.test(e.name) || ['auth.json', 'credentials.json', '.npmrc'].includes(e.name))
            findings.push({ file: relative(root, file), kind: 'private-file' });
        if (!/\.(?:[cm]?js|json|md|ya?ml|txt|svg|d\.ts)$/.test(e.name))
            continue;
        checked++;
        const text = readFileSync(file, 'utf8');
        for (const [kind, pattern] of patterns)
            if (pattern.test(text))
                findings.push({ file: relative(root, file), kind });
    }
}
walk(root);
console.log(JSON.stringify({ checked, findings }, null, 2));
process.exitCode = findings.length ? 1 : 0;
