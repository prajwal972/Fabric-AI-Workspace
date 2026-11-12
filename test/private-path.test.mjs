import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  protectPrivatePath,
  verifyPrivatePath,
  windowsPermissionInvocation,
} from "../src/security/private-path.mjs";
test("private files and directories use verified platform-native permissions", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-private-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await protectPrivatePath(dir);
  await verifyPrivatePath(dir);
  const file = path.join(dir, "payload");
  await fs.writeFile(file, "fixture");
  await protectPrivatePath(file);
  await verifyPrivatePath(file);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await fs.chmod(file, 0o644);
    await assert.rejects(verifyPrivatePath(file));
  } else {
    // Real Windows negative case: grant the Users group read access, then
    // verify that our privacy check refuses it. This targets only a fixture.
    const command = path.win32.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "icacls.exe",
    );
    const widened = spawnSync(command, [file, "/grant", "*S-1-5-32-545:(R)"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    assert.equal(
      widened.status,
      0,
      "The Windows fixture ACL could not be changed.",
    );
    await assert.rejects(
      verifyPrivatePath(file),
      /Private Windows filesystem permissions/,
    );
    await protectPrivatePath(file);
    await verifyPrivatePath(file);
  }
});
test("Windows permission paths travel through environment values, not executable script interpolation", () => {
  const target = "C:\\Fixtures\\name with ' quotes; $(arbitrary-command).dump";
  const call = windowsPermissionInvocation(target, "protect", {
    SystemRoot: "C:\\Windows",
    DATABASE_URL: "must-not-forward",
    FABRIC_MASTER_KEY: "must-not-forward",
  });
  assert.equal(
    call.file,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.equal(call.options.env.FABRIC_PERMISSION_TARGET, target);
  assert.equal(call.options.env.DATABASE_URL, undefined);
  assert.equal(call.options.env.FABRIC_MASTER_KEY, undefined);
  assert.ok(!call.args.includes(target));
  assert.ok(!call.args.at(-1).includes(target));
  assert.match(call.args.at(-1), /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(call.args.at(-1), /RemoveAccessRuleSpecific/);
  assert.match(call.args.at(-1), /GetAccessRules/);
  assert.equal(call.options.timeout, 15000);
  assert.equal(call.options.windowsHide, true);
  assert.throws(() => windowsPermissionInvocation(target, "unknown"));
});
