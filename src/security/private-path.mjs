import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
// Windows uses protected NTFS DACLs, not POSIX mode bits. Never treat a
// successful chmod() or stat().mode on Windows as proof of confidentiality.
const windowsScript = `
$ErrorActionPreference = 'Stop'
$p = $env:FABRIC_PERMISSION_TARGET
$item = Get-Item -LiteralPath $p -Force
if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not permitted' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $p
if ($env:FABRIC_PERMISSION_OPERATION -eq 'protect') {
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  if ($item.PSIsContainer) {
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  }
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance, [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.AddAccessRule($rule)
  Microsoft.PowerShell.Security\\Set-Acl -LiteralPath $p -AclObject $acl
  $acl = Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $p
}
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (!$acl.AreAccessRulesProtected -or $rules.Count -ne 1) { throw 'Private DACL could not be verified' }
$rule = $rules[0]
if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.IsInherited -or
    $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
    ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
  throw 'Private DACL could not be verified'
}
if ($item.PSIsContainer -and ($rule.InheritanceFlags -band
    ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit)) -ne
    ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit)) {
  throw 'Private directory inheritance could not be verified'
}
@{ protected = $true; currentUserOnly = $true; inheritanceVerified = $true } | ConvertTo-Json -Compress
`;
export function windowsPermissionInvocation(
  target,
  operation,
  env = process.env,
) {
  if (!["protect", "verify"].includes(operation))
    throw new TypeError("Invalid permission operation");
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return {
    file: path.win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      windowsScript,
    ],
    options: {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 65536,
      encoding: "utf8",
      // Do not forward database credentials or application keys into PowerShell.
      env: {
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        FABRIC_PERMISSION_TARGET: target,
        FABRIC_PERMISSION_OPERATION: operation,
      },
    },
  };
}
async function privatePath(target, operation) {
  const absolute = path.resolve(target),
    stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
    throw new Error("Private paths must be regular files or directories.");
  if (process.platform === "win32") {
    try {
      const { file, args, options } = windowsPermissionInvocation(
        absolute,
        operation,
      );
      const { stdout } = await execute(file, args, options);
      const result = JSON.parse(stdout.trim());
      if (
        result.protected !== true ||
        result.currentUserOnly !== true ||
        result.inheritanceVerified !== true
      )
        throw new Error("Unverified ACL");
    } catch {
      throw new Error(
        "Private Windows filesystem permissions could not be established or verified.",
      );
    }
  } else {
    const mode = stat.isDirectory() ? 0o700 : 0o600;
    if (operation === "protect") await fs.chmod(absolute, mode);
    if (((await fs.stat(absolute)).mode & 0o777) !== mode)
      throw new Error("Private filesystem permissions could not be verified.");
  }
}
export const protectPrivatePath = (target) => privatePath(target, "protect");
export const verifyPrivatePath = (target) => privatePath(target, "verify");
