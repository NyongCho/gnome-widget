"""Synthetic-only cases exercising existing Rust test expectations."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
cases=[]
def add(name,ics,month='2026-11',zone='Asia/Seoul',now='2026-11-03T12:00:00+09:00'):
    cases.append(dict(name=name,ics=ics,context=dict(month=month,timeZone=zone,weekStart=1),now=now))
for path in sorted((ROOT/'tests/fixtures/calendar').glob('*.ics')):
    args={}
    if path.stem=='dst':args=dict(month='2026-10',zone='America/New_York')
    if path.stem=='gap-start':args=dict(month='2026-03',zone='America/New_York',now='2026-03-01T00:00:00-05:00')
    if path.stem=='midnight-gap':args=dict(month='2026-09',zone='America/Santiago',now='2026-09-01T00:00:00-04:00')
    add(path.stem,path.read_text(),**args)
def event(name,body,**args):
    add(name,f'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:boundary\r\n{body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',**args)
event('grid-end','DTSTART;VALUE=DATE:20261207\nDTEND;VALUE=DATE:20261208')
event('before-grid','DTSTART;VALUE=DATE:20261025\nDTEND;VALUE=DATE:20261026')
event('last-grid-day','DTSTART;VALUE=DATE:20261206\nDTEND;VALUE=DATE:20261207')
event('invalid-date','DTSTART:20261131T090000Z')
event('period-rdate','DTSTART:20261103T090000Z\nRDATE;VALUE=PERIOD:20261104T090000Z/20261104T100000Z')
event('invalid-rule','DTSTART:20261103T090000Z\nRRULE:FREQ=NONEXISTENT')
event('unbounded-daily','DTSTART:20261101T090000Z\nRRULE:FREQ=DAILY')
event('deduplicate','DTSTART:20261101T090000Z\nRRULE:FREQ=DAILY;COUNT=4\nRDATE:20261102T090000Z,20261102T090000Z\nEXDATE:20261103T090000Z,20261104T090000Z')
event('recurring-gap','DTSTART;TZID=America/New_York:20260307T023000\nDURATION:PT1H\nRRULE:FREQ=DAILY;COUNT=3',month='2026-03',zone='America/New_York',now='2026-03-01T00:00:00-05:00')
event('ambiguous-first','DTSTART;TZID=America/New_York:20261101T013000\nDURATION:PT1H')
event('utc-until','DTSTART;TZID=America/New_York:20261101T090000\nRRULE:FREQ=DAILY;UNTIL=20261103T140000Z')
event('historical-budget','DTSTART:20200101T000000Z\nRRULE:FREQ=SECONDLY')
event('folded-text','DTSTART:20261104T090000Z\nDTEND:20261104T100000Z\nSUMMARY:\n Folded title\nDESCRIPTION:\nLOCATION: ')
event('empty-description','DTSTART:20261104T090000Z\nDESCRIPTION:')
event('empty-start','DTSTART:\nSUMMARY:invalid')
event('exrule','DTSTART:20261101T090000Z\nRRULE:FREQ=DAILY;COUNT=3\nEXRULE:FREQ=DAILY;COUNT=1')
out=HERE/'results';out.mkdir(exist_ok=True)
(out/'cases.json').write_text(json.dumps(cases,ensure_ascii=False))
(out/'oracle-input.jsonl').write_text(''.join(json.dumps(case)+'\n' for case in cases))
print(f'{len(cases)} synthetic differential cases')
