"""Pure fixture generation and paired frame-interval release gates."""
import math

def remaining_trials(rows,runs):
    order=[(run,edition) for run in range(runs) for edition in (['rust','gjs'] if run%2==0 else ['gjs','rust'])]
    completed=[(row['run'],row['edition']) for row in rows]
    if len(set(completed))!=len(completed) or any(pair not in order for pair in completed):raise ValueError('Invalid completed trials')
    if completed!=order[:len(completed)]:raise ValueError('Completed trials are not an alternating prefix')
    return [pair for pair in order if pair not in completed]

def frame_summary(timestamps_us):
    gaps=[(b-a)/1000 for a,b in zip(timestamps_us,timestamps_us[1:])]
    if not gaps or any(gap<=0 for gap in gaps):raise ValueError('Need increasing compositor frame timestamps')
    ordered=sorted(gaps)
    return {'samples':len(gaps),'p95Ms':ordered[math.ceil(len(gaps)*.95)-1],
            'p99Ms':ordered[math.ceil(len(gaps)*.99)-1],'maximumMs':max(gaps),
            'stallsOver50ms':sum(gap>50 for gap in gaps)}

def evaluate(rows,runs):
    pairs={(row['edition'],row['run']):row for row in rows}
    if len(rows)!=runs*2 or len(pairs)!=runs*2:raise ValueError('Incomplete or duplicate paired trials')
    names=[phase['name'] for phase in rows[0]['phases']]
    if any([p['name'] for p in row['phases']]!=names for row in rows):raise ValueError('Mismatched phases')
    phases=[]
    for index,name in enumerate(names):
        p95_bad=stalls_bad=0;changes=[]
        for run in range(runs):
            if ('rust',run) not in pairs or ('gjs',run) not in pairs:raise ValueError('Missing edition/run')
            rust=pairs['rust',run]['phases'][index]['frames'];gjs=pairs['gjs',run]['phases'][index]['frames']
            delta=gjs['p95Ms']-rust['p95Ms'];limit=max(2,rust['p95Ms']*.1)
            p95_bad+=delta>=limit;stalls_bad+=gjs['stallsOver50ms']>rust['stallsOver50ms']
            changes.append({'run':run,'p95IncreaseMs':delta,'p95LimitMs':limit,'newStalls':gjs['stallsOver50ms']-rust['stallsOver50ms']})
        phases.append({'name':name,'p95Regressions':p95_bad,'stallRegressions':stalls_bad,'pairs':changes,'passed':p95_bad<3 and stalls_bad<3})
    return {'passed':all(phase['passed'] for phase in phases),'releaseEligibleRuns':runs>=5,'phases':phases}

def fixtures():
    head=b'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n';tail=b'END:VCALENDAR\r\n'
    def event(i,date):return f'BEGIN:VEVENT\r\nUID:e{i}\r\nDTSTART:{date}T090000Z\r\nDTEND:{date}T100000Z\r\nSUMMARY:Event {i}\r\nEND:VEVENT\r\n'.encode()
    small=head+b''.join(event(i,'20261110') for i in range(1000))+tail
    large=head+b''.join(event(i,'20261110' if i<1000 else '20000101') for i in range(10000))+tail
    prefix=head+b'BEGIN:VEVENT\r\nUID:large\r\nDTSTART:20261110T090000Z\r\nSUMMARY:Large input\r\nDESCRIPTION:'
    suffix=b'\r\nEND:VEVENT\r\n'+tail
    exact=prefix+b'a'*(5*1024*1024-len(prefix)-len(suffix))+suffix
    sparse=head+b'BEGIN:VEVENT\r\nUID:sparse\r\nDTSTART:20240229T000000Z\r\nRRULE:FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=0;BYMINUTE=0;BYSECOND=0;UNTIL=20261231T235959Z\r\nEND:VEVENT\r\n'+tail
    return {'1k':small,'10k':large,'5mib':exact,'sparse':sparse}

def summarize_memory(samples,phases):
    result={}
    for name in ['idle','all']:
        bounds=next(phase for phase in phases if phase['name']==name)
        rows=[s for s in samples if bounds['startUs']<=s['atUs']<=bounds['endUs'] and s['shell']]
        if not rows:raise RuntimeError(f'No external memory samples for {name}')
        result[name]={'samples':len(rows),'maxWorkers':max(len(s['workers']) for s in rows)}
        for unit in ['rssKiB','pssKiB']:
            result[name][unit]={'shellMin':min(s['shell'][unit] for s in rows),'shellPeak':max(s['shell'][unit] for s in rows),'rustPeak':max((s['rust'] or {}).get(unit,0) for s in rows),'workerPeak':max((max((v[unit] for v in s['workers']),default=0) for s in rows),default=0),'combinedPeak':max(s['shell'][unit]+(s['rust'] or {}).get(unit,0)+sum(w[unit] for w in s['workers']) for s in rows)}
    for unit in ['rssKiB','pssKiB']:
        result['all'][unit]['shellIncreaseOverIdleKiB']=max(0,result['all'][unit]['shellPeak']-result['idle'][unit]['shellMin'])
    if result['idle']['maxWorkers']:raise RuntimeError('Idle calendar subprocess detected')
    return result

