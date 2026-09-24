# Environment and tooling notes

- pnpm workspaces: packages/shared (TS source, no build), apps/server (tsx), apps/web (Vite).
- `pnpm.onlyBuiltDependencies` allows install scripts for better-sqlite3, esbuild and
  sherpa-onnx-node.
- Headless screenshots: Playwright with `executablePath: /opt/pw-browsers/chromium` and
  `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL. Google Fonts fail there (cert);
  harmless.
- Don't `pkill -f src/index.ts` from a shell whose command line contains that string; it kills the
  shell itself. Use `ps | grep [s]rc/index.ts` and kill the pid.
- A `timeout N pnpm start` wrapper kills pnpm but can leave the tsx child running on the port
  (EADDRINUSE on the next start).
- In the cloud build sandbox, dndbeyond.com and the OpenAI docs sites were blocked; GitHub and npm
  were reachable.
