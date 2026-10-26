/**
 * Cross-platform ML service launcher.
 * Prefer server-ml/.venv Python; fall back to python3/python on PATH.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const venvPy = path.join(
  root,
  "server-ml",
  ".venv",
  isWin ? "Scripts/python.exe" : "bin/python"
);
const py = existsSync(venvPy) ? venvPy : isWin ? "python" : "python3";
const main = path.join(root, "server-ml", "main.py");

if (!existsSync(main)) {
  console.error(`[dev:ml] missing ${main}`);
  process.exit(1);
}
if (!existsSync(venvPy)) {
  console.warn(
    `[dev:ml] venv not found at ${venvPy}; using PATH interpreter (${py}). ` +
      `Create one with: python3 -m venv server-ml/.venv && server-ml/.venv/bin/pip install -r server-ml/requirements.txt`
  );
}

const child = spawn(py, [main], { stdio: "inherit", cwd: root });
child.on("exit", code => process.exit(code ?? 1));
child.on("error", err => {
  console.error(`[dev:ml] failed to start ${py}:`, err.message);
  process.exit(1);
});
