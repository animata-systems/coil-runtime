import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

  it('run с файлом и --dialect → not implemented + exit 0', async () => {
    const result = await run('run', 'test.coil', '--dialect', 'x.json');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('not implemented');
  });

  it('--dialect перед файлом → тоже работает', async () => {
    const result = await run('run', '--dialect', 'x.json', 'test.coil');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('not implemented');
  });
});
