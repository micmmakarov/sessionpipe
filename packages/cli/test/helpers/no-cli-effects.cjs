// SPDX-License-Identifier: Apache-2.0
// Preloaded into the real CLI process. Record even attempts whose errors the CLI
// catches, and stop them before they can affect the host or reach the network.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const write = fs.writeSync;
const deny = (name) => () => {
  write(2, `Forbidden side effect: ${name}\n`);
  throw new Error(`Forbidden side effect: ${name}`);
};
const replace = (module, names, prefix) => {
  for (const name of names) if (typeof module[name] === "function") module[name] = deny(`${prefix}.${name}`);
};
const mutations = [
  "appendFile",
  "chmod",
  "chown",
  "copyFile",
  "cp",
  "fchmod",
  "fchown",
  "fdatasync",
  "fsync",
  "ftruncate",
  "futimes",
  "lchmod",
  "lchown",
  "link",
  "lutimes",
  "mkdir",
  "mkdtemp",
  "rename",
  "rm",
  "rmdir",
  "symlink",
  "truncate",
  "unlink",
  "utimes",
  "write",
  "writeFile",
  "writev",
];
replace(fs, [...mutations, ...mutations.map((n) => `${n}Sync`), "createWriteStream"], "fs");
replace(fs.promises, mutations, "fs.promises");
for (const [module, names] of [
  [fs, ["open", "openSync"]],
  [fs.promises, ["open"]],
]) {
  for (const name of names) {
    const original = module[name];
    module[name] = (file, flags, ...rest) => {
      if (flags !== "r" && flags !== "rs" && flags !== "sr" && flags !== 0 && flags !== undefined)
        return deny(`fs.${name}(${flags})`)();
      return original.call(module, file, flags, ...rest);
    };
  }
}
replace(
  require("node:child_process"),
  ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"],
  "child_process",
);
replace(require("node:http"), ["request", "get"], "http");
replace(require("node:https"), ["request", "get"], "https");
replace(require("node:net").Socket.prototype, ["connect"], "net.Socket");
replace(require("node:net").Server.prototype, ["listen"], "net.Server");
replace(require("node:tls"), ["connect"], "tls");
replace(require("node:dgram"), ["createSocket"], "dgram");
for (const module of [require("node:dns"), require("node:dns").promises])
  replace(
    module,
    Object.keys(module).filter((k) => /^(lookup|resolve|reverse)/.test(k)),
    "dns",
  );
globalThis.fetch = deny("fetch");
if (globalThis.WebSocket) globalThis.WebSocket = deny("WebSocket");
syncBuiltinESMExports();
