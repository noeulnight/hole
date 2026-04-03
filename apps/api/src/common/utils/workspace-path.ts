import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export function findWorkspaceRoot(startDir = process.cwd()): string {
  let currentDir = resolve(startDir);

  while (true) {
    if (existsSync(join(currentDir, 'pnpm-workspace.yaml'))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return resolve(startDir);
    }

    currentDir = parentDir;
  }
}

export function resolveWorkspacePath(
  targetPath: string,
  startDir = process.cwd(),
): string {
  if (isAbsolute(targetPath)) {
    return targetPath;
  }

  return resolve(findWorkspaceRoot(startDir), targetPath);
}
