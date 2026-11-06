"""Reproduce a feasibility report; a completed report is not a product PASS."""
from pathlib import Path
import os,subprocess,sys
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
def run(args,**kwargs):subprocess.run(args,cwd=ROOT,check=True,**kwargs)
run(['./scripts/dev','npm','ci','--prefix',str(HERE),'--ignore-scripts','--no-audit','--no-fund'])
run([sys.executable,str(HERE/'make-cases.py')])
with (HERE/'results/oracle-input.jsonl').open() as source,(HERE/'results/oracle.jsonl').open('w') as target:
    run(['./scripts/dev','cargo','run','--locked','--quiet','--manifest-path',str(HERE/'oracle/Cargo.toml')],stdin=source,stdout=target,env=os.environ|{'CARGO_TARGET_DIR':str(ROOT/'daemon/target')})
with (HERE/'results/standalone-run.log').open('w') as log:
    run(['gjs','-m',str(HERE/'run.js')],stdout=log,stderr=subprocess.STDOUT)
run([sys.executable,str(HERE/'single-calls.py')])
if '--shell' in sys.argv:
    with (HERE/'results/shell-run.log').open('w') as log:run([sys.executable,str(HERE/'run-shell.py')],stdout=log,stderr=subprocess.STDOUT)
print(f'Reports: {HERE}/results (inspect correctness and latency; report generation is not acceptance)')
