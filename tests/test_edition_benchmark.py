"""Measurement and release-gate regressions, independent of a GNOME session."""
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('edition_benchmark',ROOT/'scripts/edition_benchmark.py')
bench=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)

class BenchmarkTest(unittest.TestCase):
    def test_resume_preserves_completed_trials_and_alternating_order(self):
        completed=[{'edition':e,'run':r} for r,editions in [(0,['rust','gjs']),(1,['gjs','rust']),(2,['rust','gjs']),(3,['gjs'])] for e in editions]
        self.assertEqual(bench.remaining_trials(completed,5),[(3,'rust'),(4,'rust'),(4,'gjs')])
        with self.assertRaises(ValueError):bench.remaining_trials(completed+[completed[0]],5)
        with self.assertRaises(ValueError):bench.remaining_trials([{'edition':'gjs','run':5}],5)
        with self.assertRaises(ValueError):bench.remaining_trials([{'edition':'unknown','run':0}],5)

    def test_intervals_measure_between_frames_not_paint_duration(self):
        result=bench.frame_summary([0,16667,33334,113334,130001])
        self.assertEqual(result['samples'],4)
        self.assertEqual(result['stallsOver50ms'],1)
        self.assertEqual(result['p95Ms'],80)
        self.assertEqual(result['p99Ms'],80)
        with self.assertRaises(ValueError):bench.frame_summary([2,1])

    def test_gate_counts_repeated_regressions_per_phase(self):
        def row(edition,run,p95,stalls):return {'edition':edition,'run':run,'phases':[{'name':'all','frames':{'p95Ms':p95,'stallsOver50ms':stalls}}]}
        rows=[row(e,i,16,0) for i in range(5) for e in ['rust','gjs']]
        self.assertTrue(bench.evaluate(rows,5)['passed'])
        for r in rows:
            if r['edition']=='gjs' and r['run']<3:r['phases'][0]['frames']['p95Ms']=19
        self.assertFalse(bench.evaluate(rows,5)['passed'])
        for r in rows:
            r['phases'][0]['frames']['p95Ms']=16
            if r['edition']=='gjs' and r['run']<3:r['phases'][0]['frames']['stallsOver50ms']=1
        self.assertFalse(bench.evaluate(rows,5)['passed'])
        with self.assertRaises(ValueError):bench.evaluate(rows[:-1],5)

    def test_memory_samples_exclude_the_transition_after_idle(self):
        def sample(at,name,workers):return {'atUs':at,'phase':name,'shell':{'rssKiB':100,'pssKiB':60},'rust':None,'workers':[{'rssKiB':20,'pssKiB':10}]*workers}
        samples=[sample(10,'idle',0),sample(30,'idle',1),sample(50,'all',1)]
        phases=[{'name':'idle','startUs':0,'endUs':20},{'name':'all','startUs':40,'endUs':60}]
        self.assertEqual(bench.summarize_memory(samples,phases)['idle']['maxWorkers'],0)
        samples[0]['workers']=[{'rssKiB':20,'pssKiB':10}]
        with self.assertRaises(RuntimeError):bench.summarize_memory(samples,phases)

    def test_fixtures_exercise_input_size_without_exceeding_reply_limit(self):
        fixtures=bench.fixtures()
        self.assertEqual(set(fixtures),{'1k','10k','5mib','sparse'})
        self.assertEqual(fixtures['1k'].count(b'BEGIN:VEVENT'),1000)
        self.assertEqual(fixtures['10k'].count(b'BEGIN:VEVENT'),10000)
        self.assertEqual(len(fixtures['5mib']),5*1024*1024)
        # 10k input components, 1k visible results: 10k serialized events would
        # exceed the explicit 512 KiB result contract and test rejection instead.
        self.assertEqual(fixtures['10k'].count(b'DTSTART:20261110'),1000)
        self.assertIn(b'FREQ=SECONDLY',fixtures['sparse'])
if __name__=='__main__':unittest.main()
