#!/usr/bin/env node
// `clipspeed` — the ClipSpeed command line for agents and scripts (see src/cli.js).
'use strict';
require('../src/cli').main().then((code) => process.exit(code || 0), (e) => { process.stderr.write(String((e && e.message) || e) + '\n'); process.exit(1); });
