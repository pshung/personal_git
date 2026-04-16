#!/usr/bin/env bash
# Usage: run_qemu.sh <ELF_PATH> <VLEN> [--cwd DIR] [--readconfig CFG] [--timeout N] [EXTRA_FLAGS...]
set -uo pipefail

ELF_PATH="${1:?Usage: run_qemu.sh <ELF_PATH> <VLEN> [--cwd DIR] [--readconfig CFG] [--timeout N] [EXTRA_FLAGS...]}"
VLEN="${2:?Usage: run_qemu.sh <ELF_PATH> <VLEN> [--cwd DIR] [--readconfig CFG] [--timeout N] [EXTRA_FLAGS...]}"
shift 2

CWD=""
# Default to AX45MPV config — enables all RISC-V (Zba/Zbb/Zbc/Zbs/Zfh/Zvfh/Zfbfmin/Zvfbfmin/Zvfbfwma)
# and Andes extensions (zvqmac/vdot/vl4/vsih/vpfh/bf16cvt/codense) plus AE350 SoC settings.
# Override with --readconfig or --no-readconfig to disable.
READCONFIG="/home/nick/work/libnn/project/ax45mpv/qemu_cfg/zve64d/ADP-AE350-AX45MPV-1C_dw0_mw1.cfg"
TMOUT=60
EXTRA_FLAGS=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --cwd)           CWD="$2"; shift 2 ;;
        --readconfig)    READCONFIG="$2"; shift 2 ;;
        --no-readconfig) READCONFIG=""; shift ;;
        --timeout)       TMOUT="$2"; shift 2 ;;
        *)            EXTRA_FLAGS+=" $1"; shift ;;
    esac
done

QEMU=/local/nick/qemu_andes/build/qemu-system-riscv64
TRACE=/tmp/qemu_trace.log

QEMU_FLAGS="-M andes_ae350 -cpu andes-ax45mpv,vext_spec=v1.0,vlen=${VLEN} -nographic -semihosting -bios ${ELF_PATH}"
if [ -n "$READCONFIG" ]; then
    QEMU_FLAGS="-readconfig ${READCONFIG} ${QEMU_FLAGS}"
fi

if [ -n "$CWD" ]; then
    cd "$CWD"
fi

timeout "$TMOUT" strace -f -e trace=write -o "$TRACE" \
  $QEMU $QEMU_FLAGS $EXTRA_FLAGS \
  > /dev/null 2>&1
RC=$?

# Extract semihosting output (fd varies: commonly 1 or 9)
grep -E 'write\((1|9),' "$TRACE" | grep '"' \
  | sed 's/^[0-9]* *write([0-9]*, "//; s/",.*//' \
  | sed 's/\\n/\n/g; s/\\t/\t/g; s/\\r//g'

if [ "$RC" -eq 124 ]; then
  echo "[TIMEOUT after 60s]" >&2
fi
exit $RC
