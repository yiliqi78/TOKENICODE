#!/usr/bin/env python3
"""
分析测试报告，汇总每个 suite 的通过率和失败模式。

用法:
  python3 .test/scripts/analyze-reports.py .test/runs/2026-04-11-full-issue-regression
  python3 .test/scripts/analyze-reports.py   # 默认扫描最新的 runs/ 子目录
"""
import json
import glob
import os
import sys
from collections import defaultdict

def analyze():
    # 确定要分析的目录
    if len(sys.argv) > 1:
        base = sys.argv[1]
    else:
        # 默认：找 .test/runs/ 下最新的子目录
        script_dir = os.path.dirname(os.path.abspath(__file__))
        runs_dir = os.path.join(script_dir, '..', 'runs')
        if os.path.isdir(runs_dir):
            subdirs = sorted([d for d in os.listdir(runs_dir) if os.path.isdir(os.path.join(runs_dir, d))])
            if subdirs:
                base = os.path.join(runs_dir, subdirs[-1])
            else:
                print("No run directories found in", runs_dir)
                return
        else:
            print("runs/ directory not found")
            return

    print(f"Analyzing: {base}")
    print()
    report_files = sorted(glob.glob(os.path.join(base, '*/run-*.json')))

    if not report_files:
        print("No reports found.")
        return

    suite_stats = defaultdict(lambda: {
        'total_runs': 0,
        'total_tests': 0,
        'total_passed': 0,
        'total_failed': 0,
        'total_skipped': 0,
        'failure_map': defaultdict(int),  # test_name -> fail_count
        'error_patterns': defaultdict(int),  # error_msg -> count
    })

    for f in report_files:
        # 从路径中提取 suite 名：.../interrupt-recovery/run-001.json → interrupt-recovery
        suite_name = os.path.basename(os.path.dirname(f))
        try:
            with open(f, 'r') as fh:
                report = json.load(fh)
        except (json.JSONDecodeError, IOError):
            continue

        meta = report.get('meta', {})
        stats = suite_stats[suite_name]
        stats['total_runs'] += 1
        stats['total_tests'] += meta.get('totalTests', 0)
        stats['total_passed'] += meta.get('passed', 0)
        stats['total_failed'] += meta.get('failed', 0)
        stats['total_skipped'] += meta.get('skipped', 0)

        for issue in report.get('issues', []):
            test_name = issue.get('test', 'unknown')
            error = issue.get('error', '')
            issue_type = issue.get('type', '')

            if issue_type == 'test_failure':
                stats['failure_map'][test_name] += 1
                # Categorize error
                if 'Timeout waiting for JS execution' in error:
                    stats['error_patterns']['JS执行超时(应用无响应)'] += 1
                elif 'timeout' in error.lower() or 'killed after' in error.lower():
                    stats['error_patterns']['命令超时'] += 1
                elif 'assert' in error.lower():
                    stats['error_patterns']['断言失败'] += 1
                else:
                    stats['error_patterns'][error[:80]] += 1

    # 输出汇总
    print("=" * 70)
    print("  TOKENICODE 全量测试汇总报告")
    print("=" * 70)
    print()

    grand_total = 0
    grand_passed = 0
    grand_failed = 0

    for suite_name in sorted(suite_stats.keys()):
        stats = suite_stats[suite_name]
        runs = stats['total_runs']
        total = stats['total_tests']
        passed = stats['total_passed']
        failed = stats['total_failed']
        skipped = stats['total_skipped']
        rate = (passed / total * 100) if total > 0 else 0

        grand_total += total
        grand_passed += passed
        grand_failed += failed

        print(f"┌─ {suite_name}")
        print(f"│  轮数: {runs}  测试总数: {total}  通过: {passed}  失败: {failed}  跳过: {skipped}")
        print(f"│  通过率: {rate:.1f}%")

        if stats['failure_map']:
            print(f"│  失败测试:")
            for test_name, count in sorted(stats['failure_map'].items(), key=lambda x: -x[1]):
                print(f"│    - {test_name}: {count}次失败 / {runs}轮")

        if stats['error_patterns']:
            print(f"│  错误模式:")
            for pattern, count in sorted(stats['error_patterns'].items(), key=lambda x: -x[1]):
                print(f"│    - {pattern}: {count}次")

        print(f"└─")
        print()

    grand_rate = (grand_passed / grand_total * 100) if grand_total > 0 else 0
    print("=" * 70)
    print(f"  总计: {grand_total} 测试, {grand_passed} 通过, {grand_failed} 失败")
    print(f"  整体通过率: {grand_rate:.1f}%")
    print("=" * 70)

    # 识别间歇性 bug
    print()
    print("--- 间歇性失败（部分轮通过部分轮失败）---")
    for suite_name in sorted(suite_stats.keys()):
        stats = suite_stats[suite_name]
        runs = stats['total_runs']
        for test_name, fail_count in stats['failure_map'].items():
            if 0 < fail_count < runs:
                print(f"  {suite_name} / {test_name}: {fail_count}/{runs} 轮失败 ({fail_count/runs*100:.0f}%)")

    print()
    print("--- 稳定失败（每轮都失败）---")
    for suite_name in sorted(suite_stats.keys()):
        stats = suite_stats[suite_name]
        runs = stats['total_runs']
        for test_name, fail_count in stats['failure_map'].items():
            if fail_count >= runs and runs > 1:
                print(f"  {suite_name} / {test_name}: 全部 {runs} 轮都失败")

if __name__ == '__main__':
    analyze()
