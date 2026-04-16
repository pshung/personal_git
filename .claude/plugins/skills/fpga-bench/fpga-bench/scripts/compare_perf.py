#!/usr/bin/env python3
"""Compare performance.csv files from two FPGA benchmark runs.

Usage:
    python3 compare_perf.py <baseline_csv> <new_csv> [options]

Options:
    --group <name>      Filter by function group (e.g., convolution, activation)
    --function <name>   Filter by function name substring
    --threshold <pct>   Only show changes above this % (default: 0)
    --sort <field>      Sort by: delta_cycle, delta_inst, cycle, name (default: delta_cycle)
    --top <n>           Show only top N results
    --regression        Only show regressions (slower)
    --improvement       Only show improvements (faster)
    --summary           Show per-group summary only
    --csv               Output in CSV format

Examples:
    # Compare two runs, show all changes
    python3 compare_perf.py baseline/performance.csv new/performance.csv

    # Show only convolution regressions > 5%
    python3 compare_perf.py old.csv new.csv --group convolution --regression --threshold 5

    # Top 10 biggest cycle improvements
    python3 compare_perf.py old.csv new.csv --improvement --sort delta_cycle --top 10

    # Per-group summary
    python3 compare_perf.py old.csv new.csv --summary
"""

import argparse
import csv
import sys
from collections import defaultdict


def read_perf_csv(path):
    """Read performance.csv, return dict of (group, function) -> (inst, cycle)."""
    data = {}
    with open(path, 'r') as f:
        reader = csv.reader(f)
        header = next(reader)  # skip header
        for row in reader:
            if len(row) < 4:
                continue
            group = row[0].strip()
            func = row[1].strip()
            inst_str = row[2].strip()
            cycle_str = row[3].strip()
            if inst_str == 'x' or cycle_str == 'x':
                continue
            try:
                inst = int(inst_str)
                cycle = int(cycle_str)
                data[(group, func)] = (inst, cycle)
            except ValueError:
                continue
    return data


def compare(baseline, new, args):
    """Compare two datasets and produce results."""
    results = []
    all_keys = set(baseline.keys()) | set(new.keys())

    for key in all_keys:
        group, func = key

        if args.group and args.group.lower() not in group.lower():
            continue
        if args.function and args.function.lower() not in func.lower():
            continue

        if key in baseline and key in new:
            b_inst, b_cycle = baseline[key]
            n_inst, n_cycle = new[key]
            if b_cycle == 0:
                continue
            delta_cycle = n_cycle - b_cycle
            delta_pct = (delta_cycle / b_cycle) * 100
            delta_inst = n_inst - b_inst
            delta_inst_pct = (delta_inst / b_inst * 100) if b_inst != 0 else 0

            if abs(delta_pct) < args.threshold:
                continue
            if args.regression and delta_pct <= 0:
                continue
            if args.improvement and delta_pct >= 0:
                continue

            results.append({
                'group': group,
                'function': func,
                'base_inst': b_inst,
                'new_inst': n_inst,
                'delta_inst': delta_inst,
                'delta_inst_pct': delta_inst_pct,
                'base_cycle': b_cycle,
                'new_cycle': n_cycle,
                'delta_cycle': delta_cycle,
                'delta_pct': delta_pct,
                'status': 'common',
            })
        elif key in new:
            n_inst, n_cycle = new[key]
            results.append({
                'group': group, 'function': func,
                'base_inst': 0, 'new_inst': n_inst, 'delta_inst': n_inst, 'delta_inst_pct': 0,
                'base_cycle': 0, 'new_cycle': n_cycle, 'delta_cycle': n_cycle, 'delta_pct': 0,
                'status': 'new',
            })
        else:
            b_inst, b_cycle = baseline[key]
            results.append({
                'group': group, 'function': func,
                'base_inst': b_inst, 'new_inst': 0, 'delta_inst': -b_inst, 'delta_inst_pct': 0,
                'base_cycle': b_cycle, 'new_cycle': 0, 'delta_cycle': -b_cycle, 'delta_pct': 0,
                'status': 'removed',
            })

    # Sort
    sort_key = {
        'delta_cycle': lambda r: abs(r['delta_cycle']),
        'delta_inst': lambda r: abs(r['delta_inst']),
        'cycle': lambda r: r['new_cycle'],
        'name': lambda r: (r['group'], r['function']),
    }.get(args.sort, lambda r: abs(r['delta_cycle']))

    reverse = args.sort != 'name'
    results.sort(key=sort_key, reverse=reverse)

    if args.top:
        results = results[:args.top]

    return results


def print_summary(results):
    """Print per-group summary."""
    groups = defaultdict(lambda: {'count': 0, 'improved': 0, 'regressed': 0,
                                   'total_base_cycle': 0, 'total_new_cycle': 0})
    for r in results:
        if r['status'] != 'common':
            continue
        g = groups[r['group']]
        g['count'] += 1
        g['total_base_cycle'] += r['base_cycle']
        g['total_new_cycle'] += r['new_cycle']
        if r['delta_pct'] < -1:
            g['improved'] += 1
        elif r['delta_pct'] > 1:
            g['regressed'] += 1

    print(f"{'Group':<20} {'Count':>6} {'Improved':>9} {'Regressed':>10} {'Base Cycles':>14} {'New Cycles':>14} {'Delta%':>8}")
    print("-" * 85)
    total_base = total_new = 0
    for group in sorted(groups.keys()):
        g = groups[group]
        delta = ((g['total_new_cycle'] - g['total_base_cycle']) / g['total_base_cycle'] * 100) if g['total_base_cycle'] else 0
        print(f"{group:<20} {g['count']:>6} {g['improved']:>9} {g['regressed']:>10} {g['total_base_cycle']:>14,} {g['total_new_cycle']:>14,} {delta:>+7.1f}%")
        total_base += g['total_base_cycle']
        total_new += g['total_new_cycle']

    print("-" * 85)
    total_delta = ((total_new - total_base) / total_base * 100) if total_base else 0
    print(f"{'TOTAL':<20} {sum(g['count'] for g in groups.values()):>6} "
          f"{sum(g['improved'] for g in groups.values()):>9} "
          f"{sum(g['regressed'] for g in groups.values()):>10} "
          f"{total_base:>14,} {total_new:>14,} {total_delta:>+7.1f}%")


def print_table(results):
    """Print results as formatted table."""
    print(f"{'Group':<18} {'Function':<45} {'Base Cyc':>10} {'New Cyc':>10} {'Delta':>10} {'%':>8} {'Base Inst':>10} {'New Inst':>10}")
    print("-" * 130)
    for r in results:
        status = ""
        if r['status'] == 'new':
            status = " [NEW]"
        elif r['status'] == 'removed':
            status = " [GONE]"

        sign = "+" if r['delta_pct'] > 0 else ""
        print(f"{r['group']:<18} {r['function']:<45} {r['base_cycle']:>10,} {r['new_cycle']:>10,} "
              f"{r['delta_cycle']:>+10,} {sign}{r['delta_pct']:>6.1f}% {r['base_inst']:>10,} {r['new_inst']:>10,}{status}")


def print_csv_output(results):
    """Print results as CSV."""
    w = csv.writer(sys.stdout)
    w.writerow(['group', 'function', 'base_cycle', 'new_cycle', 'delta_cycle', 'delta_pct',
                'base_inst', 'new_inst', 'delta_inst', 'status'])
    for r in results:
        w.writerow([r['group'], r['function'], r['base_cycle'], r['new_cycle'],
                     r['delta_cycle'], f"{r['delta_pct']:.2f}",
                     r['base_inst'], r['new_inst'], r['delta_inst'], r['status']])


def main():
    parser = argparse.ArgumentParser(description='Compare FPGA benchmark runs')
    parser.add_argument('baseline', help='Baseline performance.csv')
    parser.add_argument('new', help='New performance.csv')
    parser.add_argument('--group', help='Filter by group name')
    parser.add_argument('--function', help='Filter by function name substring')
    parser.add_argument('--threshold', type=float, default=0, help='Min %% change to show')
    parser.add_argument('--sort', default='delta_cycle',
                        choices=['delta_cycle', 'delta_inst', 'cycle', 'name'])
    parser.add_argument('--top', type=int, help='Show only top N results')
    parser.add_argument('--regression', action='store_true', help='Only show regressions')
    parser.add_argument('--improvement', action='store_true', help='Only show improvements')
    parser.add_argument('--summary', action='store_true', help='Per-group summary only')
    parser.add_argument('--csv', action='store_true', help='CSV output')
    args = parser.parse_args()

    baseline = read_perf_csv(args.baseline)
    new = read_perf_csv(args.new)

    print(f"Baseline: {args.baseline} ({len(baseline)} functions)")
    print(f"New:      {args.new} ({len(new)} functions)")
    print()

    results = compare(baseline, new, args)

    if args.summary:
        print_summary(results)
    elif args.csv:
        print_csv_output(results)
    else:
        print_table(results)
        print()
        # Quick stats
        common = [r for r in results if r['status'] == 'common']
        improved = sum(1 for r in common if r['delta_pct'] < -1)
        regressed = sum(1 for r in common if r['delta_pct'] > 1)
        unchanged = len(common) - improved - regressed
        print(f"Improved: {improved}  Regressed: {regressed}  Unchanged (within 1%%): {unchanged}")


if __name__ == '__main__':
    main()
