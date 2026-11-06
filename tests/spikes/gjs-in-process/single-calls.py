"""Bound potentially nonterminating library calls outside the user's Shell."""
from pathlib import Path
import json,subprocess
HERE=Path(__file__).resolve().parent
rules=[
    'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=0;BYMINUTE=0;BYSECOND=0',
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=YEARLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYSETPOS=-1',
]
rows=[]
for rule in rules:
    try:
        result=subprocess.run(['gjs','-m',str(HERE/'iterator-single-call.js'),rule],capture_output=True,text=True,timeout=4)
        row=json.loads(result.stdout.strip().splitlines()[-1]) if result.returncode==0 else dict(rule=rule,error=result.stderr[-300:])
    except subprocess.TimeoutExpired as error:
        output=error.stdout.decode() if isinstance(error.stdout,bytes) else error.stdout
        row=dict(rule=rule,timeoutSeconds=4,completedCalls=output)
    rows.append(row)
    print(json.dumps(row))
(HERE/'results/single-call.json').write_text(json.dumps(rows,indent=2))
