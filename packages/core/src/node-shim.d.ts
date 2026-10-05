/* Minimální typy pro node:test a node:assert — repo nemá přístup k @types/node
   v CI bez instalace; po `pnpm add -D @types/node` lze tento shim smazat. */
declare module "node:test" {
  export function test(name: string, fn: (t: { skip(msg?: string): void }) => void | Promise<void>): void;
}
declare module "node:fs" {
  export function readFileSync(p: string | URL, enc: "utf8"): string;
  export function readdirSync(p: string | URL): string[];
  export function writeFileSync(p: string, data: string): void;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }): void;
}
declare module "node:child_process" {
  export function execFileSync(file: string, args: string[], opts: { encoding: "utf8" }): string;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare const process: { env: Record<string, string | undefined> };
declare module "node:crypto" {
  export function createHash(alg: string): { update(s: string, enc?: string): { digest(enc: "hex"): string } };
}
declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(a: unknown, b: unknown, msg?: string): void;
    deepEqual(a: unknown, b: unknown, msg?: string): void;
    ok(value: unknown, msg?: string): asserts value;
    match(s: string, re: RegExp, msg?: string): void;
    doesNotMatch(s: string, re: RegExp, msg?: string): void;
    notEqual(a: unknown, b: unknown, msg?: string): void;
    throws(fn: () => unknown, expected?: RegExp, msg?: string): void;
  }
  const assert: Assert;
  export default assert;
}
