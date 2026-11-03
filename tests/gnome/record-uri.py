#!/usr/bin/env python3
"""Temporary default URI handler for the isolated GNOME test session only."""
import json
import os
import sys
from pathlib import Path
with (Path(os.environ['LIQUID_TEST_OUTPUT']) / 'opened-uris.jsonl').open('a') as output:
    output.write(json.dumps(sys.argv[1:]) + '\n')
