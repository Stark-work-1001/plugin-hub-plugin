import { randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS, deadline } from "@deepseek-ai/dsh-timeout";
const PREPARE_DIRECTORY = `
import fs from 'node:fs/promises';
import path from 'node:path';
async function main() {
  const [root, destination] = process.argv.slice(1);
  await fs.mkdir(path.dirname(root), { recursive: true });
  let created = false;
  try {
    await fs.mkdir(root);
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await fs.stat(root)).isDirectory()) throw error;
  }
  if (created) await fs.writeFile(path.join(root, '.gitignore'), '*\\n', { flag: 'wx' });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
`;
var __addDisposableResource = function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function")
            throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose)
                throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose)
                throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async)
                inner = dispose;
        }
        if (typeof dispose !== "function")
            throw new TypeError("Object not disposable.");
        if (inner)
            dispose = function () {
                try {
                    inner.call(this);
                }
                catch (e) {
                    return Promise.reject(e);
                }
            };
        env.stack.push({
            value,
            dispose,
            async
        });
    }
    else if (async)
        env.stack.push({ async: true });
    return value;
};
var __disposeResources = (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop())
                try {
                    if (!r.async && s === 1)
                        return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async)
                            return s |= 2, Promise.resolve(result).then(next, function (e) {
                                fail(e);
                                return next();
                            });
                    }
                    else
                        s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            if (s === 1)
                return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError)
                throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
const GIT_ENV = Object.fromEntries([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_CEILING_DIRECTORIES",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_GRAFT_FILE",
    "GIT_REPLACE_REF_BASE",
    "GIT_ATTR_SOURCE"
].map((key) => [key, void 0]));
async function runCommand(ctx, config, policy, cwd, argv, signal, allowedExitCodes = [0], env = {}) {
    const env_1 = {
        stack: [],
        error: void 0,
        hasError: false
    };
    try {
        const timeout = __addDisposableResource(env_1, deadline(signal, config.timeoutMs, "WORKTREE_TIMEOUT"), false);
        timeout.signal.throwIfAborted();
        const command = [await ctx.subprocess.resolveExecutable(argv[0], void 0, timeout.signal), ...argv.slice(1)];
        const wrapped = policy.mode === "danger-full-access" ? command : (await ctx.sandbox.confine(command, {
            ...policy,
            mode: policy.mode
        }, timeout.signal)).argv;
        timeout.signal.throwIfAborted();
        const child = ctx.subprocess.spawn({
            argv: wrapped,
            cwd,
            env: {
                ...GIT_ENV,
                GIT_TERMINAL_PROMPT: "0",
                GIT_LFS_SKIP_SMUDGE: "1",
                ...env
            },
            signal: timeout.signal,
            graceMs: config.graceMs,
            stdio: {
                stdin: "ignore",
                stdout: { maxBytes: config.maxOutputBytes },
                stderr: { maxBytes: config.maxOutputBytes }
            }
        });
        try {
            const outcome = await child.done;
            timeout.signal.throwIfAborted();
            const captured = child.collected;
            const stdout = captured.stdout.readFrom(0);
            const stderr = captured.stderr.readFrom(0);
            if (outcome.exitCode === null || !allowedExitCodes.includes(outcome.exitCode))
                throw new Error(`worktree command failed (${outcome.signal ?? outcome.exitCode}): ${stderr.text.trim()}`);
            if (stdout.lossy)
                throw new Error("worktree command output exceeds maxOutputBytes");
            return {
                stdout: stdout.text,
                exitCode: outcome.exitCode
            };
        }
        finally {
            child.terminate();
            await child.waitForExit();
        }
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
function relativePath(value) {
    return value.length > 0 && !value.includes("\\") && !value.includes(":") && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
var WorktreeService = class extends Service {
    static inject = [
        "workingDirectory",
        "fs",
        "subprocess",
        "sandbox",
        "sandboxPolicy"
    ];
    static Config = z.object({
        directory: z.string().default(".agents/worktrees"),
        namePrefix: z.string().default("worktree-"),
        gitCommand: z.string().default("git"),
        nodeCommand: z.string().default("node"),
        timeoutMs: z.number().default(6e4),
        graceMs: z.number().default(3e3),
        maxOutputBytes: z.number().default(65536)
    });
    config;
    lifetime = new AbortController();
    pending = new Set();
    constructor(ctx, config) {
        super(ctx, "worktrees");
        this.config = config;
        if (!relativePath(this.config.directory))
            throw new Error("worktree: directory must be a relative directory without dot segments");
        if (!relativePath(`${this.config.namePrefix}name`) || this.config.namePrefix.startsWith("-"))
            throw new Error("worktree: namePrefix must produce a relative branch name");
        for (const key of ["gitCommand", "nodeCommand"])
            if (this.config[key].trim().length === 0)
                throw new Error(`worktree: ${key} must not be empty`);
        for (const key of [
            "timeoutMs",
            "graceMs",
            "maxOutputBytes"
        ]) {
            const value = this.config[key];
            if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS)
                throw new Error(`worktree: ${key} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`);
        }
        ctx.effect(() => async () => {
            this.lifetime.abort(new Error("worktree service disposed"));
            await Promise.allSettled(this.pending);
        });
    }
    async create(agent, request = {}, signal) {
        const operationSignal = signal === void 0 ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, signal]);
        operationSignal.throwIfAborted();
        const operation = this.createCheckout(agent, this.resolve(request), operationSignal);
        this.pending.add(operation);
        try {
            return await operation;
        }
        finally {
            this.pending.delete(operation);
        }
    }
    resolve(request) {
        const branch = request.name ?? `${this.config.namePrefix}${randomUUID()}`;
        if (!relativePath(branch) || branch.startsWith("-"))
            throw new Error("worktree name must be a relative Git branch name");
        const revision = request.from ?? "HEAD";
        if (revision.length === 0)
            throw new Error("worktree from must name a local commit, branch, or tag");
        return {
            branch,
            revision
        };
    }
    async createCheckout(agent, { branch, revision }, signal) {
        const cwd = await this.ctx.workingDirectory.ensure(agent, signal);
        const policy = this.ctx.sandboxPolicy.resolve({ session: agent.session });
        const run = (directory, args, allowedExitCodes, env) => runCommand(this.ctx, this.config, policy, directory, [
            this.config.gitCommand,
            "--no-lazy-fetch",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            ...args
        ], signal, allowedExitCodes, env);
        await run(cwd, ["check-ref-format", `refs/heads/${branch}`]);
        const rootOutput = await run(cwd, ["rev-parse", "--show-toplevel"]);
        const rootTarget = await this.ctx.fs.resolve(rootOutput.stdout.replace(/\r?\n$/, ""), {
            cwd,
            signal
        });
        const repositoryRoot = this.ctx.fs.processPath(rootTarget);
        const baseCommit = (await run(repositoryRoot, [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${revision}^{commit}`
        ])).stdout.trim();
        if ((await run(repositoryRoot, [
            "show-ref",
            "--verify",
            "--quiet",
            `refs/heads/${branch}`
        ], [0, 1])).exitCode === 0)
            throw new Error(`worktree branch already exists: ${branch}`);
        const pool = await this.ctx.fs.resolve(this.config.directory, {
            cwd: repositoryRoot,
            signal
        });
        const poolPath = this.ctx.fs.processPath(pool);
        const destination = await this.ctx.fs.resolve(branch, {
            cwd: poolPath,
            signal
        });
        const path = this.ctx.fs.processPath(destination);
        if (await this.ctx.fs.lstat(path, void 0, signal) !== void 0)
            throw new Error(`worktree path already exists: ${path}`);
        try {
            await runCommand(this.ctx, this.config, policy, repositoryRoot, [
                this.config.nodeCommand,
                "--input-type=module",
                "-e",
                PREPARE_DIRECTORY,
                poolPath,
                path
            ], signal);
            await run(repositoryRoot, [
                "--work-tree",
                repositoryRoot,
                "worktree",
                "add",
                "--no-checkout",
                "-b",
                branch,
                "--",
                path,
                baseCommit
            ]);
            const configured = await run(path, [
                "config",
                "--null",
                "--name-only",
                "--get-regexp",
                "^filter\\."
            ], [0, 1]);
            const drivers = new Set();
            for (const key of configured.stdout.split("\0")) {
                const separator = key.lastIndexOf(".");
                if (separator > 7 && [
                    "clean",
                    "smudge",
                    "process",
                    "required"
                ].includes(key.slice(separator + 1)))
                    drivers.add(key.slice(7, separator));
            }
            const overrides = { GIT_CONFIG_COUNT: String(drivers.size * 4) };
            let index = 0;
            for (const driver of drivers)
                for (const attribute of [
                    "clean",
                    "smudge",
                    "process",
                    "required"
                ]) {
                    overrides[`GIT_CONFIG_KEY_${index}`] = `filter.${driver}.${attribute}`;
                    overrides[`GIT_CONFIG_VALUE_${index}`] = attribute === "required" ? "false" : "";
                    index++;
                }
            await run(path, [
                "--work-tree",
                path,
                "reset",
                "--hard",
                "--no-recurse-submodules",
                baseCommit
            ], void 0, overrides);
            return {
                path: await this.ctx.workingDirectory.set(agent, path, signal),
                branch,
                baseCommit,
                repositoryRoot
            };
        }
        catch (error) {
            throw new Error(`Could not finish worktree ${branch} at ${path}. Any created checkout and branch are retained. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }
};
export { WorktreeService, WorktreeService as default };
