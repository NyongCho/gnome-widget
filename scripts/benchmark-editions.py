#!/usr/bin/env python3
"""Alternate isolated Rust/public GNOME trials; no live feeds or settings."""
import argparse,hashlib,json,os,platform,subprocess,sys,threading,time
from pathlib import Path
from edition_benchmark import fixtures,frame_summary,evaluate,summarize_memory,remaining_trials
ROOT=Path(__file__).resolve().parent.parent

def power():
    try:return subprocess.check_output(['powerprofilesctl','get'],text=True,stderr=subprocess.DEVNULL).strip()
    except (OSError,subprocess.SubprocessError):return 'unavailable'

def resource(pid):
    try:
        text=Path(f'/proc/{pid}/smaps_rollup').read_text();values={}
        for line in text.splitlines():
            if line.startswith(('Rss:','Pss:')):key,value,*_=line.split();values[key[:-1].lower()+'KiB']=int(value)
        return values
    except (OSError,ValueError):return None

def runtime_fingerprint(rust):
    paths=[rust,*(ROOT/path for path in ['tests/gnome/edition-benchmark.js','tests/gnome/benchmark-io.js','tests/gnome/helpers.js','scripts/test-gnome.py','scripts/gnome-test-env.py'])]
    for directory in [ROOT/'extension/dist',ROOT/'extension/dist-gjs']:
        paths.extend(path for path in directory.rglob('*') if path.is_file() and ('tests' not in path.relative_to(directory).parts or path.name=='benchmark.js'))
    return {str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}

def sample_resources(directory,stop,samples):
    while not stop.wait(.05):
        try:
            pids=json.loads((directory/'pids.json').read_text());phase=json.loads((directory/'phase.json').read_text())['name']
            shell=pids['shellPid'];children=Path(f'/proc/{shell}/task/{shell}/children').read_text().split()
            workers=[]
            for child in children:
                try:
                    if b'calendar-worker.js' in Path(f'/proc/{child}/cmdline').read_bytes():workers.append(int(child))
                except OSError:pass
            samples.append({'atUs':time.monotonic_ns()//1000,'phase':phase,'shell':resource(shell),'rust':resource(pids['rustPid']) if pids['rustPid'] else None,'workers':[row for pid in workers if (row:=resource(pid)) is not None]})
        except (OSError,ValueError,KeyError):pass


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--runs',type=int,default=5);parser.add_argument('--output',type=Path,default=ROOT/'outputs/verification/edition-performance');parser.add_argument('--smoke',action='store_true');parser.add_argument('--skip-build',action='store_true');parser.add_argument('--resume',action='store_true',help='resume unchanged artifacts after a pre-measurement startup failure');args=parser.parse_args()
    if args.runs<1:parser.error('--runs must be positive')
    if args.resume and not args.skip_build:parser.error('--resume requires --skip-build to keep the reference binaries fixed')
    output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    target=Path(os.environ.get('CARGO_TARGET_DIR',ROOT/'daemon/target'));rust=target/'release/examples/edition-benchmark'
    if not args.skip_build:
        for edition in ['rust','gjs']:subprocess.run(['./scripts/dev','npm','--prefix','extension','run','build','--','--edition',edition,'--tests'],cwd=ROOT,check=True)
        subprocess.run(['./scripts/dev','cargo','build','--locked','--release','--manifest-path','daemon/Cargo.toml','--example','edition-benchmark'],cwd=ROOT,check=True)
    initial_power=power();environment={'kernel':platform.release(),'machine':platform.machine(),'powerProfile':initial_power,'shell':subprocess.check_output(['gnome-shell','--version'],text=True).strip(),'processor':Path('/proc/cpuinfo').read_text().split('model name\t: ',1)[-1].splitlines()[0], 'warmupSeconds':1 if args.smoke else 30,'phaseSeconds':28 if args.smoke else 120,'smoke':args.smoke,'memorySamplingMs':50,'clock':'CLOCK_MONOTONIC / GNOME stagePaintStart interval, not paint duration','rustBuild':'release'}
    environment['cpuGovernors']=sorted({p.read_text().strip() for p in Path('/sys/devices/system/cpu').glob('cpu[0-9]*/cpufreq/scaling_governor')})
    try:environment['gpu']=subprocess.check_output(['nvidia-smi','--query-gpu=name,driver_version','--format=csv,noheader'],text=True,stderr=subprocess.DEVNULL).strip()
    except (OSError,subprocess.SubprocessError):environment['gpu']='See GNOME log; nvidia-smi unavailable'
    environment['runtimeFingerprint']=runtime_fingerprint(rust);rows=[]
    if args.resume:
        previous=json.loads((output/'environment.json').read_text())
        for key in ['kernel','machine','powerProfile','shell','processor','warmupSeconds','phaseSeconds','smoke','cpuGovernors','gpu','runtimeFingerprint']:
            if previous[key]!=environment[key]:raise RuntimeError(f'Resume environment changed: {key}')
        rows=json.loads((output/'results.json').read_text())
    else:
        if (output/'results.json').exists():raise RuntimeError('Existing completed trials: use --resume or a fresh output directory')
        (output/'environment.json').write_text(json.dumps(environment,indent=2)+'\n')
    for run,edition in remaining_trials(rows,args.runs):
        if power()!=initial_power:raise RuntimeError('Power profile changed; discard the comparison')
        trial=output/f'run-{run+1}-{edition}'
        if trial.exists():
            report=trial/'screenshots'/edition/'edition-benchmark/benchmark.json'
            if not args.resume or report.exists() and json.loads(report.read_text()).get('phases'):
                raise RuntimeError('Cannot silently replace a trial with measured phases')
            failures=output/'failed-startups';failures.mkdir(exist_ok=True)
            trial.rename(failures/f'{trial.name}-{time.time_ns()}')
        data=trial/'fixtures';data.mkdir(parents=True,exist_ok=True)
        for name,value in fixtures().items():(data/f'{name}.ics').write_bytes(value)
        (data/'selection.txt').write_text('1k')
        epoch=int(time.time());weather={'current':{'temperature_2m':16,'weather_code':2},'hourly':{'time':[epoch+3600*(i+1) for i in range(7)],'temperature_2m':[16-i for i in range(7)],'precipitation_probability':[i*10 for i in range(7)]}}
        (data/'weather.json').write_text(json.dumps(weather))
        env=os.environ|{'LIQUID_GNOME_WORK':str(trial),'LIQUID_BENCH_FIXTURES':str(data),'LIQUID_BENCH_WARMUP':str(environment['warmupSeconds']),'LIQUID_BENCH_DURATION':str(environment['phaseSeconds']),'LIQUID_BENCH_RUN':str(run),'LIQUID_BENCH_RUST':str(rust)}
        directory=trial/'screenshots'/edition/'edition-benchmark';directory.mkdir(parents=True,exist_ok=True)
        samples=[];stop=threading.Event();sampler=threading.Thread(target=sample_resources,args=(directory,stop,samples),daemon=True);sampler.start()
        print(f'START pair {run+1}/{args.runs} {edition}',flush=True)
        try:
            with (trial/'gnome.log').open('w') as log:
                process=subprocess.Popen(['./scripts/test-gnome.py','--edition',edition,'--edition-benchmark'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
                while True:
                    try:code=process.wait(timeout=30);break
                    except subprocess.TimeoutExpired:
                        if power()!=initial_power:process.terminate();process.wait(timeout=15);raise RuntimeError('Power profile changed during trial')
                        text=(trial/'gnome.log').read_text();lines=[line for line in text.splitlines() if 'EDITION_BENCH' in line]
                        print(lines[-1] if lines else f'Waiting for {edition} compositor...',flush=True)
            if code:raise RuntimeError(f'GNOME {edition} trial failed; see {trial}/gnome.log')
        finally:
            stop.set();sampler.join()
            (trial/'resources.json').write_text(json.dumps(samples,separators=(',',':'))+'\n')
        row=json.loads((directory/'benchmark.json').read_text())
        for phase in row['phases']:phase['frames']=frame_summary(phase['frameTimestampsUs'])
        row['memory']=summarize_memory(samples,row['phases']);rows.append(row)
        (trial/'result.json').write_text(json.dumps(row,indent=2)+'\n')
        (output/'results.json').write_text(json.dumps(rows,indent=2)+'\n')
        print(f"DONE {edition}: "+', '.join(f"{p['name']} p95={p['frames']['p95Ms']:.2f}ms p99={p['frames']['p99Ms']:.2f}ms stalls={p['frames']['stallsOver50ms']}" for p in row['phases']),flush=True)
    gate=evaluate(rows,args.runs);gate['releaseEligibleRuns']=gate['releaseEligibleRuns'] and not args.smoke
    (output/'gate.json').write_text(json.dumps(gate,indent=2)+'\n');print(json.dumps(gate),flush=True)
    return int(not gate['passed'])
if __name__=='__main__':sys.exit(main())
