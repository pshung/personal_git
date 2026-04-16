#!/usr/bin/env python3
"""Analyze a kanata.log file to extract pipeline timing for RVV instructions.

Usage:
    python3 analyze_kanata.py <kanata.log> [options]

Options:
    --pc-range <start>-<end>    Only analyze instructions in PC range (hex, e.g., 10210-10230)
    --function <name>           Filter by function name from disassembly labels
    --rvv-only                  Only show RVV (vector) instructions
    --show-stalls               Highlight stall cycles
    --summary                   Per-instruction-type summary
    --timeline                  Show cycle-by-cycle timeline
    --top <n>                   Show top N longest-latency instructions

Examples:
    python3 analyze_kanata.py kanata.log --pc-range 10210-10230
    python3 analyze_kanata.py kanata.log --rvv-only --summary
    python3 analyze_kanata.py kanata.log --function vadd_loop --timeline
"""

import argparse
import re
import sys
from collections import defaultdict


def parse_kanata(path, pc_start=None, pc_end=None, func_filter=None, rvv_only=False):
    """Parse kanata.log, return list of instruction records."""
    instructions = {}  # id -> record
    current_cycle = 0

    rvv_mnemonics = {
        'vsetvli', 'vsetivli', 'vsetvl',
        'vle8.v', 'vle16.v', 'vle32.v', 'vle64.v',
        'vlse8.v', 'vlse16.v', 'vlse32.v', 'vlse64.v',
        'vse8.v', 'vse16.v', 'vse32.v', 'vse64.v',
        'vsse8.v', 'vsse16.v', 'vsse32.v', 'vsse64.v',
        'vadd.vv', 'vadd.vx', 'vadd.vi', 'vsub.vv', 'vsub.vx',
        'vmul.vv', 'vmul.vx', 'vmacc.vv', 'vmacc.vx',
        'vfadd.vv', 'vfadd.vf', 'vfsub.vv', 'vfmul.vv', 'vfmul.vf',
        'vfmacc.vv', 'vfmacc.vf', 'vfwmacc.vv',
        'vle32.v', 'vse32.v', 'vle8.v', 'vse8.v',
        'vredsum.vs', 'vmv.x.s', 'vmv.s.x', 'vfmv.f.s',
    }

    with open(path, 'r') as f:
        for line in f:
            line = line.rstrip('\n')
            parts = line.split('\t')
            if not parts:
                continue

            code = parts[0]

            if code == 'C' or code == 'C=':
                if len(parts) >= 2:
                    try:
                        current_cycle += int(parts[1])
                    except ValueError:
                        pass

            elif code == 'I':
                if len(parts) >= 4:
                    iid = int(parts[1])
                    instructions[iid] = {
                        'id': iid,
                        'pc': None,
                        'asm': None,
                        'is_rvv': False,
                        'scalar_stages': {},  # stage -> (enter_cycle, exit_cycle)
                        'vpu_stages': {},     # stage -> enter_cycle
                        'vpu_unit': None,
                        'lmul': None,
                        'sew': None,
                        'retire_cycle': None,
                        'flushed': False,
                        'create_cycle': current_cycle,
                    }

            elif code == 'L':
                if len(parts) >= 4:
                    iid = int(parts[1])
                    lane = int(parts[2])
                    text = parts[3].strip()
                    if iid in instructions:
                        if lane == 0 and ':' in text and '0x' in text:
                            # Parse "0x10210: vsetvli a5,a3,e32,m4,ta,ma"
                            m = re.match(r'(0x[0-9a-f]+):\s*(.*)', text)
                            if m:
                                instructions[iid]['pc'] = int(m.group(1), 16)
                                asm = m.group(2).strip()
                                instructions[iid]['asm'] = asm
                                mnemonic = asm.split()[0] if asm else ''
                                if mnemonic.startswith('v') or mnemonic in rvv_mnemonics:
                                    instructions[iid]['is_rvv'] = True
                        elif lane == 1:
                            if text in ('valu', 'vmac', 'vmac2', 'vlsu', 'vsp',
                                        'vpermut', 'vdiv', 'vfmis', 'vfdiv', 'vmask', 'vace'):
                                instructions[iid]['vpu_unit'] = text
                            else:
                                m = re.match(r'\s*lmul:([\d.]+)\s+sew:(\d+)', text)
                                if m:
                                    instructions[iid]['lmul'] = float(m.group(1))
                                    instructions[iid]['sew'] = int(m.group(2))

            elif code == 'S':
                if len(parts) >= 4:
                    iid = int(parts[1])
                    lane = int(parts[2])
                    stage = parts[3].strip()
                    if iid in instructions:
                        if lane == 0:
                            if stage not in instructions[iid]['scalar_stages']:
                                instructions[iid]['scalar_stages'][stage] = current_cycle
                        else:
                            if stage not in instructions[iid]['vpu_stages']:
                                instructions[iid]['vpu_stages'][stage] = current_cycle

            elif code == 'R':
                if len(parts) >= 4:
                    iid = int(parts[1])
                    status = int(parts[3])
                    if iid in instructions:
                        instructions[iid]['retire_cycle'] = current_cycle
                        instructions[iid]['flushed'] = (status == 1)

    # Filter
    result = []
    for iid in sorted(instructions.keys()):
        inst = instructions[iid]
        if inst['flushed']:
            continue
        if inst['pc'] is None:
            continue
        if pc_start is not None and inst['pc'] < pc_start:
            continue
        if pc_end is not None and inst['pc'] > pc_end:
            continue
        if func_filter and func_filter not in (inst.get('asm') or ''):
            # Also check if PC is in the function range (simplified: just filter by asm text)
            pass
        if rvv_only and not inst['is_rvv']:
            continue
        result.append(inst)

    return result


def print_timeline(insts):
    """Print detailed timeline of each instruction."""
    print(f"{'ID':>6} {'PC':>10} {'ASM':<45} {'Scalar Stages':<30} {'VPU Stages':<40} {'Unit':<8} {'LMUL':<6} {'Total':<6}")
    print("-" * 160)
    for inst in insts:
        scalar = ' -> '.join(f"{s}@{c}" for s, c in sorted(inst['scalar_stages'].items(), key=lambda x: x[1]))
        vpu = ' -> '.join(f"{s}@{c}" for s, c in sorted(inst['vpu_stages'].items(), key=lambda x: x[1]))

        total = ''
        if inst['retire_cycle'] and inst['create_cycle']:
            total = str(inst['retire_cycle'] - inst['create_cycle'])

        lmul_str = f"m{inst['lmul']}" if inst['lmul'] else ''
        unit = inst['vpu_unit'] or ''
        pc_str = f"0x{inst['pc']:x}" if inst['pc'] else ''

        print(f"{inst['id']:>6} {pc_str:>10} {(inst['asm'] or ''):45} {scalar:<30} {vpu:<40} {unit:<8} {lmul_str:<6} {total:<6}")


def print_summary(insts):
    """Print per-mnemonic summary of pipeline latencies."""
    stats = defaultdict(lambda: {'count': 0, 'total_latency': 0, 'vq_to_vd': [], 'vd_to_vc': [], 'vc_to_vw': []})

    for inst in insts:
        mnemonic = (inst['asm'] or '').split()[0]
        s = stats[mnemonic]
        s['count'] += 1

        if inst['retire_cycle'] and inst['create_cycle']:
            s['total_latency'] += (inst['retire_cycle'] - inst['create_cycle'])

        vpu = inst['vpu_stages']
        if 'VQ' in vpu and 'VD' in vpu:
            s['vq_to_vd'].append(vpu['VD'] - vpu['VQ'])
        if 'VD' in vpu and 'VC' in vpu:
            s['vd_to_vc'].append(vpu['VC'] - vpu['VD'])
        if 'VC' in vpu:
            vw_stages = [c for st, c in vpu.items() if st.startswith('VW')]
            if vw_stages:
                s['vc_to_vw'].append(max(vw_stages) - vpu['VC'])

    print(f"{'Mnemonic':<30} {'Count':>6} {'Avg Lat':>8} {'VQ->VD':>8} {'VD->VC':>8} {'VC->VW':>8} {'Unit':<8}")
    print("-" * 85)

    # Collect unit info
    unit_map = {}
    for inst in insts:
        mnemonic = (inst['asm'] or '').split()[0]
        if inst['vpu_unit']:
            unit_map[mnemonic] = inst['vpu_unit']

    for mnemonic in sorted(stats.keys()):
        s = stats[mnemonic]
        avg_lat = s['total_latency'] / s['count'] if s['count'] else 0
        avg_vq_vd = sum(s['vq_to_vd']) / len(s['vq_to_vd']) if s['vq_to_vd'] else 0
        avg_vd_vc = sum(s['vd_to_vc']) / len(s['vd_to_vc']) if s['vd_to_vc'] else 0
        avg_vc_vw = sum(s['vc_to_vw']) / len(s['vc_to_vw']) if s['vc_to_vw'] else 0
        unit = unit_map.get(mnemonic, '')

        vq_vd_str = f"{avg_vq_vd:.1f}" if s['vq_to_vd'] else '-'
        vd_vc_str = f"{avg_vd_vc:.1f}" if s['vd_to_vc'] else '-'
        vc_vw_str = f"{avg_vc_vw:.1f}" if s['vc_to_vw'] else '-'

        print(f"{mnemonic:<30} {s['count']:>6} {avg_lat:>7.1f} {vq_vd_str:>8} {vd_vc_str:>8} {vc_vw_str:>8} {unit:<8}")


def print_stalls(insts):
    """Identify and print instructions with pipeline stalls."""
    stalled = []
    for inst in insts:
        # Check scalar stalls (gap between consecutive stages)
        stages_ordered = sorted(inst['scalar_stages'].items(), key=lambda x: x[1])
        max_gap = 0
        stall_at = ''
        for i in range(1, len(stages_ordered)):
            gap = stages_ordered[i][1] - stages_ordered[i-1][1]
            if gap > 1 and gap > max_gap:
                max_gap = gap
                stall_at = f"{stages_ordered[i-1][0]}->{stages_ordered[i][0]}"

        # Check VPU stalls
        vpu_ordered = sorted(inst['vpu_stages'].items(), key=lambda x: x[1])
        for i in range(1, len(vpu_ordered)):
            gap = vpu_ordered[i][1] - vpu_ordered[i-1][1]
            if gap > 2 and gap > max_gap:
                max_gap = gap
                stall_at = f"VPU:{vpu_ordered[i-1][0]}->{vpu_ordered[i][0]}"

        if max_gap > 1:
            stalled.append((inst, max_gap, stall_at))

    stalled.sort(key=lambda x: x[1], reverse=True)

    print(f"{'ID':>6} {'PC':>10} {'ASM':<45} {'Stall':>6} {'Where':<25}")
    print("-" * 100)
    for inst, gap, where in stalled[:30]:
        pc_str = f"0x{inst['pc']:x}" if inst['pc'] else ''
        print(f"{inst['id']:>6} {pc_str:>10} {(inst['asm'] or ''):<45} {gap:>5}c {where:<25}")


def main():
    parser = argparse.ArgumentParser(description='Analyze AX45MPV kanata pipeline log')
    parser.add_argument('kanata_log', help='Path to kanata.log')
    parser.add_argument('--pc-range', help='PC range in hex (e.g., 10210-10230)')
    parser.add_argument('--function', help='Filter by function name in asm')
    parser.add_argument('--rvv-only', action='store_true', help='Only RVV instructions')
    parser.add_argument('--show-stalls', action='store_true', help='Show stall analysis')
    parser.add_argument('--summary', action='store_true', help='Per-mnemonic summary')
    parser.add_argument('--timeline', action='store_true', help='Detailed timeline')
    parser.add_argument('--top', type=int, help='Top N by latency')
    args = parser.parse_args()

    pc_start = pc_end = None
    if args.pc_range:
        parts = args.pc_range.split('-')
        pc_start = int(parts[0], 16)
        pc_end = int(parts[1], 16) if len(parts) > 1 else pc_start

    insts = parse_kanata(args.kanata_log, pc_start, pc_end, args.function, args.rvv_only)
    print(f"Parsed {len(insts)} instructions (after filters)\n")

    if not insts:
        print("No instructions match the filter criteria.")
        return

    if args.top:
        insts.sort(key=lambda i: (i['retire_cycle'] or 0) - (i['create_cycle'] or 0), reverse=True)
        insts = insts[:args.top]

    if args.summary:
        print_summary(insts)
    elif args.show_stalls:
        print_stalls(insts)
    elif args.timeline:
        print_timeline(insts)
    else:
        # Default: summary + stalls
        print("=== Instruction Summary ===\n")
        print_summary(insts)
        print("\n=== Top Stalls ===\n")
        print_stalls(insts)


if __name__ == '__main__':
    main()
