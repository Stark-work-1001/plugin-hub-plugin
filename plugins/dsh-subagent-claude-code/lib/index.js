import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { NO_START_CAPABILITIES, assertPositiveFinite, assertUsableCwd, settleRunResult, subprocessRunHandle } from "../../../vendor/dsh-subagent-out-of-process.mjs";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brandString } from "@deepseek-ai/dsh-brand";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { EventEmitter } from "node:events";
function thrown$1(value) {
    return value instanceof Error ? value : new Error(String(value));
}
function sdkEnvironmentOverlay(env) {
    const overlay = { ...env };
    for (const name of Object.keys(scrubbedParentEnv()))
        if (!(name in env))
            overlay[name] = void 0;
    return overlay;
}
function claudeSpawnSpec(options, graceMs) {
    if (options.cwd === void 0 || options.cwd.length === 0)
        throw new Error("subagent-claude-code: SDK spawn request omitted its workspace");
    return {
        argv: [options.command, ...options.args],
        cwd: options.cwd,
        stdio: {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "inherit"
        },
        graceMs,
        signal: options.signal,
        env: sdkEnvironmentOverlay(options.env)
    };
}
var ManagedClaudeCodeProcess = class {
    child;
    stdin;
    stdout;
    events = new EventEmitter();
    outcomeValue;
    killRequested = false;
    constructor(child) {
        this.child = child;
        this.stdin = child.stdin;
        this.stdout = child.stdout;
        this.events.on("error", () => { });
        child.done.then((outcome) => {
            this.outcomeValue = outcome;
            this.events.emit("exit", outcome.exitCode, outcome.signal);
        }, (error) => {
            this.events.emit("error", thrown$1(error));
        });
    }
    get killed() {
        return this.killRequested;
    }
    get exitCode() {
        return this.outcomeValue?.exitCode ?? null;
    }
    get signalCode() {
        return this.outcomeValue?.signal ?? null;
    }
    get outcome() {
        return this.outcomeValue;
    }
    kill(_signal) {
        if (this.killRequested || this.outcomeValue !== void 0)
            return false;
        this.killRequested = true;
        this.child.terminate();
        return true;
    }
    on(event, listener) {
        this.events.on(event, listener);
    }
    once(event, listener) {
        this.events.once(event, listener);
    }
    off(event, listener) {
        this.events.off(event, listener);
    }
};
const DEFAULT_DISPOSE_GRACE_MS = 3e3;
const CLAUDE_CODE_PERMISSION_MODES = [
    "dontAsk",
    "acceptEdits",
    "auto",
    "plan",
    "bypassPermissions"
];
const DEFAULT_CLAUDE_CODE_PERMISSION_MODE = "dontAsk";
const SUPPORTED_UNATTENDED_DIALOG_KINDS = ["refusal_fallback_prompt"];
function failureDiagnostic(facts) {
    const fields = [
        "product: Claude Code",
        `stage: ${facts.stage}`,
        `category: ${facts.category}`
    ];
    const exitCode = facts.outcome?.exitCode;
    if (exitCode !== null && exitCode !== void 0)
        fields.push(`exit code: ${exitCode}`);
    const signal = facts.outcome?.signal;
    if (signal !== null && signal !== void 0)
        fields.push(`signal: ${signal}`);
    return `Product subagent failure (${fields.join("; ")})`;
}
var ClaudeCodeFailure = class extends Error {
    facts;
    constructor(facts, cause) {
        super(`subagent-claude-code: ${failureDiagnostic(facts)}`, cause === void 0 ? void 0 : { cause });
        this.facts = facts;
        this.name = "ClaudeCodeFailure";
    }
};
function sdkFailureCategory(subtype) {
    switch (subtype) {
        case "error_max_turns":
        case "error_max_budget_usd":
        case "error_max_structured_output_retries": return "limit";
        case "error_during_execution": return "product-error";
        default: return "unknown";
    }
}
function claudeCodeStartupFailure(cause) {
    return new ClaudeCodeFailure({
        stage: "query-start",
        category: "unknown"
    }, cause);
}
function unattendedDiagnostic(mode, request, decision, reason) {
    return `Claude Code unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`;
}
function thrown(value) {
    return value instanceof Error ? value : new Error(String(value));
}
function isAborted(signal) {
    return signal.aborted;
}
function textTask(prompt) {
    if (prompt.length === 0)
        throw new Error("subagent-claude-code: the one-shot task must contain only text blocks");
    const texts = [];
    for (const block of prompt) {
        if (block.type !== "text")
            throw new Error("subagent-claude-code: the one-shot task must contain only text blocks");
        texts.push(block.text);
    }
    if (texts.every((text) => text.trim().length === 0))
        throw new Error("subagent-claude-code: the one-shot task must not be empty");
    return texts.join("");
}
function successfulResult(message) {
    if (message.subtype !== "success") {
        const category = sdkFailureCategory(message.subtype);
        const detail = category === "unknown" ? void 0 : message.errors.join("; ");
        throw new ClaudeCodeFailure({
            stage: "query-run",
            category
        }, detail === void 0 || detail.length === 0 ? void 0 : new Error(detail));
    }
    if (message.is_error || message.result.trim().length === 0)
        throw new ClaudeCodeFailure({
            stage: "query-run",
            category: "invalid-result"
        });
    return message.result;
}
async function consumeClaudeQuery(query, onPermissionDenied, onResult) {
    let answer;
    for await (const message of query) {
        if (message.type === "system" && message.subtype === "permission_denied") {
            onPermissionDenied?.();
            continue;
        }
        if (message.type !== "result")
            continue;
        onResult?.();
        answer = successfulResult(message);
    }
    if (answer === void 0)
        throw new ClaudeCodeFailure({
            stage: "query-run",
            category: "invalid-result"
        });
    return {
        output: [{
                type: "text",
                text: answer
            }],
        stopReason: "completed"
    };
}
async function disposeClaudeCodeChild(query, child) {
    const failures = [];
    let outcome;
    child.done.then((value) => {
        outcome = value;
    }, () => { });
    try {
        query?.close();
    }
    catch (error) {
        failures.push(thrown(error));
    }
    child.terminate();
    try {
        await child.waitForExit();
    }
    catch (error) {
        failures.push(thrown(error));
    }
    const firstFailure = failures[0];
    if (firstFailure !== void 0)
        throw new ClaudeCodeFailure({
            stage: "teardown",
            category: "unknown",
            outcome
        }, failures.length === 1 ? firstFailure : new AggregateError(failures, "Claude Code teardown failures"));
    await child.done.catch(() => { });
}
function claudeQueryOptions(spec, controller, capture, captureDiagnostic) {
    return {
        abortController: controller,
        cwd: spec.cwd,
        ...spec.model === void 0 ? {} : { model: spec.model },
        env: {
            ...scrubbedParentEnv(),
            ...spec.env
        },
        persistSession: false,
        disallowedTools: spec.permissionMode === "plan" ? ["AskUserQuestion", "ExitPlanMode"] : ["AskUserQuestion"],
        permissionMode: spec.permissionMode,
        ...spec.permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : { canUseTool: () => {
                captureDiagnostic(unattendedDiagnostic(spec.permissionMode, "tool permission", "denied", "the provider does not request human approval"));
                return Promise.resolve({
                    behavior: "deny",
                    message: "This unattended Claude Code subagent cannot request human approval."
                });
            } },
        onElicitation: () => {
            captureDiagnostic(unattendedDiagnostic(spec.permissionMode, "MCP elicitation", "declined", "the provider does not collect interactive MCP input"));
            return Promise.resolve({ action: "decline" });
        },
        onUserDialog: () => {
            captureDiagnostic(unattendedDiagnostic(spec.permissionMode, "user dialog", "cancelled", "the provider does not render blocking dialogs"));
            return Promise.resolve({ behavior: "cancelled" });
        },
        supportedDialogKinds: SUPPORTED_UNATTENDED_DIALOG_KINDS,
        spawnClaudeCodeProcess: (options) => {
            const child = spec.spawn(claudeSpawnSpec(options, spec.disposeGraceMs));
            const process = new ManagedClaudeCodeProcess(child);
            capture(child, process);
            return process;
        }
    };
}
async function startClaudeCodeRun(request, spec) {
    const prompt = textTask(request.prompt);
    if (request.signal.aborted)
        throw new Error("subagent-claude-code: request was aborted before SDK startup");
    const controller = new AbortController();
    const requestCancel = () => {
        if (!controller.signal.aborted)
            controller.abort(new Error("subagent-claude-code: run cancelled locally"));
    };
    const onAbort = () => {
        requestCancel();
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    const reportFailure = (error) => {
        try {
            spec.onError?.(error, "error");
        }
        catch { }
    };
    let child;
    let childFailure;
    let childProcessFailure;
    let query$1;
    let managedProcess;
    let diagnostic;
    const capturePermissionDiagnostic = (value) => {
        diagnostic = value;
    };
    const prependFailureDiagnostic = (facts) => {
        const failure = failureDiagnostic(facts);
        diagnostic = diagnostic === void 0 ? failure : `${failure}\n${diagnostic}`;
    };
    const captureChild = (captured, process) => {
        child = captured;
        managedProcess = process;
        childProcessFailure = captured.done.then(() => new Promise(() => { }), (error) => {
            childFailure = thrown(error);
            throw childFailure;
        });
        childProcessFailure.catch(() => { });
    };
    try {
        query$1 = query({
            prompt,
            options: claudeQueryOptions(spec, controller, captureChild, capturePermissionDiagnostic)
        });
        if (child === void 0 || childProcessFailure === void 0)
            throw new Error("subagent-claude-code: official SDK did not publish a controllable Claude Code process");
        if (isAborted(controller.signal))
            throw new Error("subagent-claude-code: request was aborted before SDK startup");
    }
    catch (error) {
        request.signal.removeEventListener("abort", onAbort);
        const cancelledBeforeCleanup = controller.signal.aborted;
        await Promise.resolve();
        const startupFacts = {
            stage: "query-start",
            category: "unknown",
            outcome: managedProcess?.outcome
        };
        const startupFailure = (cause = childFailure ?? error) => new ClaudeCodeFailure(startupFacts, thrown(cause));
        requestCancel();
        if (child !== void 0) {
            try {
                await disposeClaudeCodeChild(query$1, child);
            }
            catch (disposeError) {
                const failure = startupFailure();
                const cleanupFailure = thrown(disposeError);
                const aggregate = new AggregateError([failure, cleanupFailure], `${failure.message}; ${cleanupFailure.message}`);
                reportFailure(aggregate);
                throw aggregate;
            }
            if (cancelledBeforeCleanup || isAborted(request.signal))
                throw new Error("subagent-claude-code: request was aborted before SDK startup");
            const failure = startupFailure();
            reportFailure(failure);
            throw failure;
        }
        else if (query$1 !== void 0)
            try {
                query$1.close();
            }
            catch (disposeError) {
                const failure = startupFailure();
                const cleanupFailure = new ClaudeCodeFailure({
                    stage: "teardown",
                    category: "unknown"
                }, thrown(disposeError));
                const aggregate = new AggregateError([failure, cleanupFailure], `${failure.message}; ${cleanupFailure.message}`);
                reportFailure(aggregate);
                throw aggregate;
            }
        if (cancelledBeforeCleanup || isAborted(request.signal))
            throw new Error("subagent-claude-code: request was aborted before SDK startup");
        const failure = startupFailure();
        reportFailure(failure);
        throw failure;
    }
    const publishedQuery = query$1;
    const publishedChild = child;
    const publishedProcessFailure = childProcessFailure;
    let receivedResult = false;
    const result = settleRunResult({
        attempt: async () => {
            try {
                return await Promise.race([consumeClaudeQuery(publishedQuery, () => {
                        capturePermissionDiagnostic(unattendedDiagnostic(spec.permissionMode, "tool permission", "denied", "Claude Code denied the request before an interactive prompt"));
                    }, () => {
                        receivedResult = true;
                    }), publishedProcessFailure]);
            }
            catch (error) {
                const processOutcome = managedProcess?.outcome;
                let facts;
                if (error instanceof ClaudeCodeFailure)
                    facts = {
                        ...error.facts,
                        outcome: processOutcome
                    };
                else if (processOutcome !== void 0 && !receivedResult)
                    facts = {
                        stage: "process",
                        category: "process",
                        outcome: processOutcome
                    };
                else
                    facts = {
                        stage: "query-run",
                        category: "unknown",
                        outcome: processOutcome
                    };
                prependFailureDiagnostic(facts);
                throw error instanceof ClaudeCodeFailure ? error : new ClaudeCodeFailure(facts, thrown(error));
            }
        },
        collectOutput: () => [],
        collectDiagnostic: () => diagnostic,
        cancelled: () => controller.signal.aborted,
        onError: spec.onError,
        signal: request.signal,
        onAbort
    });
    return subprocessRunHandle({
        id: brandString(randomUUID()),
        result,
        signal: request.signal,
        onAbort,
        requestCancel,
        teardown: async () => {
            try {
                await disposeClaudeCodeChild(publishedQuery, publishedChild);
            }
            catch (error) {
                const failure = thrown(error);
                reportFailure(failure);
                throw failure;
            }
        }
    });
}
const name = "subagent-claude-code";
const inject = ["subagents", "subprocess"];
const DEFAULT_PROVIDER_NAME = "claude-code";
const Config = z.object({
    providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
    model: z.string().min(1),
    env: z.dict(z.string()).default({}),
    permissionMode: z.union([...CLAUDE_CODE_PERMISSION_MODES]).default(DEFAULT_CLAUDE_CODE_PERMISSION_MODE),
    disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS)
});
var ClaudeCodeProvider = class {
    name;
    ctx;
    config;
    capabilities = NO_START_CAPABILITIES;
    inheritsParentContext = false;
    constructor(name, ctx, config) {
        this.name = name;
        this.ctx = ctx;
        this.config = config;
    }
    async start(request) {
        let cwd;
        try {
            cwd = assertUsableCwd("subagent-claude-code", "child cwd", request.cwd);
        }
        catch (error) {
            if (request.signal.aborted)
                throw new Error("subagent-claude-code: request was aborted before SDK startup");
            const failure = claudeCodeStartupFailure(error);
            this.ctx.logger.warn(`subagent-claude-code "${this.name}": child start failed: %o`, failure);
            throw failure;
        }
        return startClaudeCodeRun(request, {
            cwd,
            ...this.config.model === void 0 ? {} : { model: this.config.model },
            permissionMode: this.config.permissionMode,
            env: this.config.env,
            disposeGraceMs: this.config.disposeGraceMs,
            spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
            onError: (error, stopReason) => {
                this.ctx.logger.warn(`subagent-claude-code "${this.name}": child run failed (${stopReason}): %o`, error);
            }
        });
    }
};
function apply(ctx, config) {
    const resolved = {
        providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
        ...config.model === void 0 ? {} : { model: config.model },
        env: config.env,
        permissionMode: config.permissionMode ?? "dontAsk",
        disposeGraceMs: config.disposeGraceMs
    };
    assertPositiveFinite("subagent-claude-code", "disposeGraceMs", resolved.disposeGraceMs);
    if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS)
        throw new Error(`subagent-claude-code: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
    ctx.subagents.registerProvider(new ClaudeCodeProvider(resolved.providerName, ctx, resolved));
}
export { Config, apply, inject, name };
