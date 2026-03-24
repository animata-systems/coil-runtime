import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { writeFile, unlink } from 'node:fs/promises';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'dist', 'cli', 'index.js');

function run(...args: string[]) {
  return exec('node', [CLI, ...args]).then(
    ({ stdout, stderr }) => ({ stdout, stderr, code: 0 }),
    (err: any) => ({ stdout: err.stdout as string, stderr: err.stderr as string, code: err.code as number }),
  );
}

describe('CLI: coil run', () => {
  it('без аргументов → usage + exit 1', async () => {
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Usage:');
  });

  it('неизвестная команда → usage + exit 1', async () => {
    const result = await run('unknown');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Usage:');
  });

  it('run без файла → error: file not specified', async () => {
    const result = await run('run');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('file not specified');
  });

  it('run с файлом без --dialect → error: dialect not specified', async () => {
    const result = await run('run', 'test.coil');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('dialect not specified');
  });

  it('--dialect без пути → error: dialect path missing', async () => {
    const result = await run('run', 'test.coil', '--dialect');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('dialect path missing');
  });

  it('run с несуществующим файлом → error + exit 1', async () => {
    const result = await run('run', 'nonexistent.coil', '--dialect', 'x.json');
    expect(result.code).not.toBe(0);
  });

  it('run с несуществующим диалектом → error + exit 1', async () => {
    const result = await run('run', 'test.coil', '--dialect', 'nonexistent.json');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('error');
  });

  it('скрипт без EXIT → exit code != 0, сообщение exit-required в stderr', async () => {
    const require = createRequire(import.meta.url);
    const dialectPath = join(dirname(require.resolve('coil/dialects/SPEC.md')), 'en-standard', 'en-standard.json');
    const tmpScript = '/tmp/no-exit.coil';
    await writeFile(tmpScript, 'RECEIVE name\nEND');
    try {
      const result = await run('run', tmpScript, '--dialect', dialectPath);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('exit-required');
    } finally {
      await unlink(tmpScript);
    }
  });

  it('валидный скрипт без RECEIVE → exit 0 + stdout', async () => {
    const require = createRequire(import.meta.url);
    const dialectPath = join(dirname(require.resolve('coil/dialects/SPEC.md')), 'en-standard', 'en-standard.json');
    const tmpScript = '/tmp/hello-coil.coil';
    await writeFile(tmpScript, 'SEND\n<< Hello from COIL! >>\nEND\nEXIT');
    try {
      const result = await run('run', tmpScript, '--dialect', dialectPath);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Hello from COIL!');
    } finally {
      await unlink(tmpScript);
    }
  });
});
