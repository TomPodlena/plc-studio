/* Minimální typy pro node:test a node:assert — repo nemá přístup k @types/node
   v CI bez instalace; po `pnpm add -D @types/node` lze tento shim smazat. */
declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}
declare module "node:fs" {
  export function readFileSync(p: string | URL, enc: "utf8"): string;
  export function readdirSync(p: string | URL): string[];
}
declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(a: unknown, b: unknown, msg?: string): void;
    deepEqual(a: unknown, b: unknown, msg?: string): void;
    ok(value: unknown, msg?: string): asserts value;
    match(s: string, re: RegExp, msg?: string): void;
  }
  const assert: Assert;
  export default assert;
}
