export interface HookInstallOptions {
  projectRoot: string;
  globalHooksDir: string;
  hookExt: string;        // .sh or .ps1
  isWindows: boolean;
}

export interface HookInstallResult {
  installed: string[];
  skipped: string[];
  errors: string[];
}

export interface HookGenerator {
  install(opts: HookInstallOptions): HookInstallResult;
  uninstall(projectRoot: string): void;
}

/**
 * Wrap a hook script path for the current platform.
 * Windows needs powershell invocation; Unix uses the path directly.
 */
export function hookCommand(hookPath: string, isWindows: boolean): string {
  return isWindows
    ? `powershell -ExecutionPolicy Bypass -File "${hookPath}"`
    : hookPath;
}
