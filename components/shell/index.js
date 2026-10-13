import { mountComponent } from "../../lib/embedded.js";
export const name = "plugin-hub-component-shell";
export const inject = [];
export function apply(ctx) { return mountComponent(ctx, "shell"); }
