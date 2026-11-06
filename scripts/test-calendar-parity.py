#!/usr/bin/env python3
"""Run the real Rust/GJS engines against frozen, synthetic calendar expectations."""
import argparse,copy,datetime,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
FIXTURES=ROOT/'tests/fixtures/calendar-parity'
def canonical(row):
    row=copy.deepcopy(row)
    for event in row.get('data',{}).get('events',[]):
        if not event['allDay']:
            for field in ['start','end','occurrenceKey']:
                event[field]=datetime.datetime.fromisoformat(event[field].replace('Z','+00:00')).astimezone(datetime.timezone.utc).isoformat()
    return row
def run(engine,cases):
    if engine=='rust':
        subprocess.run(['./scripts/dev','cargo','build','--locked','--quiet','--manifest-path','daemon/Cargo.toml','--example','calendar-parity'],cwd=ROOT,check=True)
        target=Path(os.environ.get('CARGO_TARGET_DIR',str(ROOT/'daemon/target')))
        inputs=copy.deepcopy(cases)
        for case in inputs:
            if isinstance(case['ics'],dict):case['ics']=case['ics']['repeat']*case['ics']['count']
        result=subprocess.run([str(target/'debug/examples/calendar-parity')],input=''.join(json.dumps(case)+'\n' for case in inputs),capture_output=True,text=True,timeout=90,check=True)
    else:
        subprocess.run([str(ROOT/'scripts/dev'),'node','scripts/build-calendar-tests.mjs'],cwd=ROOT/'extension',check=True)
        result=subprocess.run(['gjs','-m',str(ROOT/'extension/dist/tests/calendarEngine.js'),str(FIXTURES/'cases.json')],capture_output=True,text=True,timeout=90)
        if result.returncode:
            print(result.stderr[-2000:],file=sys.stderr)
    return [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--engine',choices=['rust','gjs','both'],default='both');args=parser.parse_args()
    cases=json.loads((FIXTURES/'cases.json').read_text());expected=json.loads((FIXTURES/'expected.json').read_text())
    failed=0
    for engine in ['rust','gjs'] if args.engine=='both' else [args.engine]:
        rows=run(engine,cases);lookup={row['name']:row for row in rows}
        passed=0
        for record in expected:
            wanted=record.get('variants',{}).get(engine,{key:value for key,value in record.items() if key!='variants'})
            actual=lookup.get(wanted['name'])
            if actual is not None and canonical(actual)==canonical(wanted):passed+=1
            else:
                failed+=1;print(f"FAIL {engine} {wanted['name']}: expected {str(wanted)[:220]}, got {str(actual)[:220]}")
        print(f'{engine}: {passed}/{len(expected)} calendar cases passed')
        if engine=='gjs':
            for name in ['sparse','impossible']:
                try:
                    probe=subprocess.run(['gjs','-m',str(ROOT/'extension/dist/tests/calendarBudget.js'),name],capture_output=True,text=True,timeout=2)
                    print(probe.stdout.strip())
                    if probe.returncode:failed+=1
                except subprocess.TimeoutExpired:
                    failed+=1;print(f'FAIL {name}: internal budget did not stop the standalone process')
    return int(failed>0)
if __name__=='__main__':sys.exit(main())
