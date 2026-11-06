#!/usr/bin/env python3
"""Exercise the public edition on a private bus with synthetic data only."""
import argparse,ctypes,gzip,http.server,json,os,select,struct,subprocess,sys,tempfile,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
HEADER={'version':1,'jobId':'test','sourceId':'synthetic','generation':1,'context':{'month':'2026-11','timeZone':'UTC','weekStart':1},'now':'2026-11-03T00:00:00Z'}
ICS=b'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nDTSTART:20261104T030000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
def frame(data):
    if not isinstance(data,bytes):data=json.dumps(data).encode()
    return struct.pack('>I',len(data))+data

def read_exact(stream,n,timeout=3):
    deadline=time.monotonic()+timeout;parts=[]
    while n:
        remaining=deadline-time.monotonic()
        if remaining<=0 or not select.select([stream],[],[],remaining)[0]:raise AssertionError('protocol read timeout')
        part=os.read(stream.fileno(),n)
        if not part:raise AssertionError('truncated frame')
        parts.append(part);n-=len(part)
    return b''.join(parts)
def read_frame(stream,timeout=3):
    size=struct.unpack('>I',read_exact(stream,4,timeout))[0]
    assert 0<size<=512*1024,size
    return json.loads(read_exact(stream,size,timeout))
def worker():
    return subprocess.Popen(['gjs','-m',str(ROOT/'extension/dist/tests/calendar-worker.js')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
def finish(child,payload=None):
    if payload is not None:child.stdin.write(payload)
    child.stdin.close();result=read_frame(child.stdout,11);assert child.wait(timeout=2)==0
    assert child.stdout.read()==b'';assert child.stderr.read()==b'';return result

def worker_suite():
    subprocess.run(['gjs','-m',str(ROOT/'extension/dist/tests/worker.js'),str(ROOT/'extension/dist/tests')],check=True,timeout=45)
    # The lease is owned by the child, not by either parent.
    first=worker();assert read_frame(first.stdout)['state']=='ready'
    contender=worker();assert read_frame(contender.stdout)['state']=='busy';assert contender.wait(timeout=1)==0
    first.stdin.close();assert first.wait(timeout=1)!=0
    print('PASS ready/busy race and EOF before input')
    # At exactly 5 MiB, a valid large description remains accepted.
    prefix=ICS.replace(b'END:VEVENT\r\nEND:VCALENDAR\r\n',b'DESCRIPTION:')
    suffix=b'\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    exact=prefix+b'a'*(5*1024*1024-len(prefix)-len(suffix))+suffix
    for label,payload,code in [
        ('exact input limit',frame(HEADER)+frame(exact),None),
        ('input over limit',frame(HEADER)+struct.pack('>I',5*1024*1024+1),'PAYLOAD_TOO_LARGE'),
        ('invalid UTF-8',frame(HEADER)+frame(b'\xc3\x28'),'INVALID_DATA'),
        ('truncated raw frame',frame(HEADER)+struct.pack('>I',10)+b'x','INVALID_DATA'),
        ('extra input frame',frame(HEADER)+frame(ICS)+b'X','INVALID_DATA'),
    ]:
        child=worker();assert read_frame(child.stdout)['state']=='ready';reply=finish(child,payload)
        assert reply.get('errorCode')==code,(label,reply);print('PASS',label)
    for size in [16*1024,16*1024+1]:
        child=worker();assert read_frame(child.stdout)['state']=='ready'
        raw=json.dumps(HEADER).encode();raw+=b' '*(size-len(raw))
        try:
            child.stdin.write(frame(raw)+frame(ICS));child.stdin.close()
            if size==16*1024:assert read_frame(child.stdout)['ok'] is True
        except BrokenPipeError:assert size>16*1024
        exitcode=child.wait(timeout=2);assert (exitcode==0)==(size==16*1024)
    print('PASS 16 KiB header boundary')
    # Adopt orphaned test grandchildren so the harness proves exit and reaps them.
    assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
    orphan_parent=r'''
import json,os,struct,subprocess,sys,time
child=subprocess.Popen(['gjs','-m',sys.argv[1]],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
size=struct.unpack('>I',child.stdout.read(4))[0]
assert json.loads(child.stdout.read(size))['state']=='ready'
if sys.argv[2]=='compute':
 header=json.loads(sys.argv[3]);raw=json.dumps(header).encode()
 events=''.join('BEGIN:VEVENT\nUID:budget-'+str(i)+'\nDTSTART:20240229T000000Z\nRRULE:FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=0;BYMINUTE=0;BYSECOND=0;UNTIL=20261231T235959Z\nEND:VEVENT\n' for i in range(100))
 data=('BEGIN:VCALENDAR\nVERSION:2.0\n'+events+'END:VCALENDAR\n').encode()
 child.stdin.write(struct.pack('>I',len(raw))+raw+struct.pack('>I',len(data))+data);child.stdin.close()
print(child.pid,flush=True)
time.sleep(60)
'''
    for mode in ['input','compute']:
        parent=subprocess.Popen([sys.executable,'-c',orphan_parent,str(ROOT/'extension/dist/tests/calendar-worker.js'),mode,json.dumps(HEADER)],stdout=subprocess.PIPE,text=True)
        pid=int(parent.stdout.readline());time.sleep(.1);start=time.monotonic();parent.kill();parent.wait()
        if mode=='compute':
            contender=worker();assert read_frame(contender.stdout)['state']=='busy';assert contender.wait(timeout=1)==0
        deadline=start+11
        while True:
            exited,status=os.waitpid(pid,os.WNOHANG)
            if exited:break
            assert time.monotonic()<deadline,'orphan worker survives parent death'
            time.sleep(.05)
        print(f'PASS SIGKILL parent during {mode}: child exit+reap in {time.monotonic()-start:.3f}s')
    # A held-open pipe without a parent watchdog is bounded by the worker itself.
    child=worker();start=time.monotonic();assert read_frame(child.stdout)['state']=='ready'
    assert child.wait(timeout=11)!=0;assert time.monotonic()-start<11;child.stdin.close()
    print('PASS internal 9 second deadline while awaiting input')

def io_suite():
    entry=str(ROOT/'extension/dist/tests/leaseHolder.js')
    holder=subprocess.Popen(['gjs','-m',entry,'hold'],stdout=subprocess.PIPE,text=True)
    assert holder.stdout.readline().strip()=='acquired'
    waiter=subprocess.Popen(['gjs','-m',entry,'wait'],stdout=subprocess.PIPE,text=True)
    time.sleep(.15);assert waiter.poll() is None,'second process must wait for lock'
    holder.kill();holder.wait();assert waiter.wait(timeout=2)==0
    assert waiter.stdout.read().strip()=='acquired'
    print('PASS ConfigLock owner death releases another process')
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path=='/slow':time.sleep(.3)
            body=gzip.compress(b'a'*10000) if self.path=='/compressed' else b'ok'
            self.send_response(302 if self.path=='/redirect' else 200)
            if self.path=='/compressed':self.send_header('Content-Encoding','gzip')
            if self.path=='/redirect':self.send_header('Location','/ok')
            self.send_header('Content-Length',str(len(body)));self.end_headers()
            try:self.wfile.write(body)
            except BrokenPipeError:pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='liquid-io-') as tmp:
        root=Path(tmp);(root/'unsafe').mkdir(mode=0o700);(root/'unsafe/symlink').symlink_to('/dev/null');os.mkfifo(root/'unsafe/fifo')
        keyring=subprocess.Popen(['gnome-keyring-daemon','--unlock','--foreground','--components=secrets',f'--control-directory={tmp}/keyring'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        keyring.stdin.write(b'synthetic-test-password\n');keyring.stdin.close()
        try:
            subprocess.run(['gjs','-m',str(ROOT/'extension/dist/tests/io.js'),tmp,f'http://127.0.0.1:{server.server_port}'],check=True,timeout=35)
        finally:
            keyring.terminate();keyring.wait(timeout=3);server.shutdown()

def weather_suite():
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path in ['/offline','/limited']:
                self.server.mode=503 if self.path=='/offline' else 429;status=200;body=b'ok'
            else:
                status=self.server.mode;body=(ROOT/'tests/fixtures/weather'/('locations.json' if self.path=='/search' else 'forecast.json')).read_bytes()
            self.send_response(status);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.mode=200
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:subprocess.run(['gjs','-m',str(ROOT/'extension/dist/tests/weather.js'),f'http://127.0.0.1:{server.server_port}'],check=True,timeout=15)
    finally:server.shutdown()

def system_network_suite():
    with tempfile.TemporaryDirectory(prefix='liquid-linux-') as tmp:
        root=Path(tmp)
        def put(path,value):
            target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(value)
        put('proc/stat',(ROOT/'tests/fixtures/system/stat-first.txt').read_text());put('stat-next.txt',(ROOT/'tests/fixtures/system/stat-next.txt').read_text())
        put('proc/meminfo',(ROOT/'tests/fixtures/system/meminfo.txt').read_text());put('proc/net/route',(ROOT/'tests/fixtures/network/route.txt').read_text());put('proc/net/ipv6_route','')
        put('sys/class/hwmon/hwmon0/name','coretemp');put('sys/class/hwmon/hwmon0/temp1_label','Package id 0');put('sys/class/hwmon/hwmon0/temp1_input','38000')
        for name in ['enp5s0','tailscale0','lo']:
            for counter in ['rx_bytes','tx_bytes']:put(f'sys/class/net/{name}/statistics/{counter}',str(2**60))
        put('proc/oversize','too long');os.mkfifo(root/'proc/fifo')
        subprocess.run(['gjs','-m',str(ROOT/'extension/dist/tests/systemNetwork.js'),tmp],check=True,timeout=15)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--suite',choices=['worker','io','local-session','weather','system-network'],default='worker');parser.add_argument('--private',action='store_true');args=parser.parse_args()
    if not args.private:
        subprocess.run([str(ROOT/'scripts/dev'),'npm','--prefix','extension','run','generate'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
        subprocess.run([str(ROOT/'scripts/dev'),'node','scripts/build-calendar-tests.mjs'],cwd=ROOT/'extension',check=True)
        with tempfile.TemporaryDirectory(prefix='liquid-public-test-') as tmp:
            env={**os.environ,'GIO_USE_VFS':'local','XDG_CONFIG_HOME':tmp+'/config','XDG_CACHE_HOME':tmp+'/cache','XDG_DATA_HOME':tmp+'/data'}
            return subprocess.run(['dbus-run-session','--',sys.executable,__file__,'--private','--suite',args.suite],env=env).returncode
    if args.suite=='local-session':
        subprocess.run(['gjs','-m',str(ROOT/'extension/dist/tests/localSession.js'),str(ROOT/'extension/dist/tests')],check=True,timeout=15)
    elif args.suite=='weather':weather_suite()
    elif args.suite=='system-network':system_network_suite()
    else:(worker_suite if args.suite=='worker' else io_suite)()
    return 0
if __name__=='__main__':sys.exit(main())
