import path from "node:path";
import { fileURLToPath } from "node:url";
export function isMainModule(
  url,
  argv = process.argv,
  platform = process.platform,
) {
  if (!argv[1]) return false;
  try {
    const windows = platform === "win32",
      paths = windows ? path.win32 : path;
    const modulePath = paths.resolve(fileURLToPath(url, { windows }));
    const argumentPath = paths.resolve(argv[1]);
    return windows
      ? modulePath.toLowerCase() === argumentPath.toLowerCase()
      : modulePath === argumentPath;
  } catch {
    return false;
  }
}
