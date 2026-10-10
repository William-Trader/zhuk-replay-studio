#!/usr/bin/env node
/*!
 * scripts/check.mjs - zhuk-replay-studio key build/tooling logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-7C68506F
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 工业级质量门（离线、零依赖）：静态约束 + 架构边界。
 *  用法：node scripts/check.mjs   退出码非 0 即失败（可挂到 CI/pre-commit）。 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));   // 仓库根（用 fileURLToPath：路径含中文时 pathname 会被百分号编码）
const SRC = join(ROOT, 'src');
const WARN_LINES = 800;      // 单文件告警阈值
const FAIL_LINES = 2000;     // 单文件硬上限（超过必须先拆分）
/** 已知超限文件：只允许缩小，不允许新增（改造路线图 P2 会把 App.tsx 拆到阈值内）。 */
const SIZE_DEBT = new Set(['src/App.tsx']);
/** 允许出现 any 的位置（第三方库适配层，需注释说明）。 */
const ANY_ALLOW = new Set(['src/bridge.ts']);

const walk = (dir) => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

const files = walk(SRC).filter(path => /\.(ts|tsx)$/.test(path));
const problems = [];
const warnings = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;

  if (lines > FAIL_LINES) problems.push(`${rel}: ${lines} 行，超过硬上限 ${FAIL_LINES}（必须先拆分）`);
  else if (lines > WARN_LINES && !SIZE_DEBT.has(rel)) problems.push(`${rel}: ${lines} 行，超过 ${WARN_LINES} 行且不在债务清单里（新增大文件不被允许）`);
  else if (lines > WARN_LINES) warnings.push(`${rel}: ${lines} 行（在债务清单，路线图 P2 拆分）`);
  if (SIZE_DEBT.has(rel) && lines <= WARN_LINES) warnings.push(`${rel}: 已降到阈值内，请从 SIZE_DEBT 移除`);

  if (/\bconsole\.(log|debug)\(/.test(text)) problems.push(`${rel}: 残留 console.log/debug`);
  if (/\bany\b/.test(text) && !ANY_ALLOW.has(rel)) problems.push(`${rel}: 出现 any（如需保留请加入 ANY_ALLOW 并注释原因）`);
  const todos = text.match(/TODO|FIXME|XXX/g);
  if (todos) warnings.push(`${rel}: ${todos.length} 处 TODO/FIXME`);

  // 架构边界：领域层不得依赖 UI 层
  if (rel.startsWith('src/domain/') && /from '(\.\.\/)+(components|App)/.test(text)) {
    problems.push(`${rel}: 领域层不得依赖 UI 层（components/App）`);
  }
}

console.log(`检查 ${files.length} 个源文件`);
for (const line of warnings) console.log(`  warn  ${line}`);
for (const line of problems) console.log(`  FAIL  ${line}`);
if (problems.length) { console.error(`\n质量门未通过：${problems.length} 项`); process.exit(1); }
console.log('\n质量门通过');
