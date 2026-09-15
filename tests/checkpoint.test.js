'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const checkpoint = require('../scripts/lib/checkpoint.js');

test('checkpoint extracts edited files, verification commands, and prompts', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xend-cp-')), 't.jsonl');
  const recs = [
    { type: 'user', message: { role: 'user', content: 'Fix the pagination bug in api/list.py' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/p/api/list.py' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/api/list.py', old_string: 'a', new_string: 'b' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'python3 -m pytest tests/test_list.py -q' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/api/list.py', old_string: 'b', new_string: 'c' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Also add a test for page 0' }] } },
    'not json',
  ];
  fs.writeFileSync(f, recs.map((r) => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n');
  const data = await checkpoint.fromTranscript(f);
  assert.deepStrictEqual(data.edited, [{ file: '/p/api/list.py', edits: 2 }]);
  assert.deepStrictEqual(data.commands, ['python3 -m pytest tests/test_list.py -q']);
  assert.deepStrictEqual(data.prompts, ['Fix the pagination bug in api/list.py', 'Also add a test for page 0']);
  const md = checkpoint.render(data, null);
  assert.ok(md.startsWith('# xend checkpoint'));
  assert.ok(md.includes('- /p/api/list.py (2 edits)'));
  const missing = await checkpoint.fromTranscript('/nonexistent/x.jsonl');
  assert.deepStrictEqual(missing.edited, []);
});
