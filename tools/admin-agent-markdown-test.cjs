'use strict';

const assert = require('node:assert/strict');
const markdown = require('../src/main/resources/static/js/admin-agent-markdown.js');

const sample = [
  '## 管理结论',
  '',
  '当前有 **1 份**申请待审核。<img src=x onerror=alert(1)>',
  '',
  '| 项目 | 数量 |',
  '| --- | ---: |',
  '| 可领养动物 | **4** |',
  '',
  '### 建议下一步',
  '1. 核对申请材料',
  '2. 由管理员作出最终决定'
].join('\n');

const blocks = markdown.parse(sample);
assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'table', 'heading', 'list']);
assert.equal(blocks[2].headers[0].plain, '项目');
assert.equal(blocks[2].rows[0][1][0].type, 'strong');
assert.equal(blocks[4].ordered, true);
assert.equal(blocks[4].start, 1);
assert.match(blocks[1].parts.map(part => part.text).join(''), /<img src=x onerror=alert\(1\)>/);
assert.ok(blocks.every(block => !Object.prototype.hasOwnProperty.call(block, 'html')));

const bounded = markdown.parse('| A |\n| --- |\n' + Array.from({length: 60}, (_, i) => `| ${i} |`).join('\n'));
assert.equal(bounded[0].rows.length, 30);

const petCareSample = [
  '根据查询，您领养的是**小白（猫咪）**。',
  '',
  '---',
  '',
  '**🥩 让小狗增重不伤肠胃的要点**',
  '',
  '1. **少量多餐**',
  '   - 每天喂 **3~4 次**，单次七八分饱。',
  '',
  '2. **提高食物营养密度**',
  '   - 可少量添加水煮鸡胸肉。',
  '   - 不要喂油腻剩菜。',
  '',
  '3. **定时定量**',
  '   - 15 分钟内吃完收起。',
  '',
  '⚠️ **重要提醒**：不能替代兽医诊断。'
].join('\n');
const petBlocks = markdown.parse(petCareSample);
const petList = petBlocks.find(block => block.type === 'list');
assert.ok(petList, 'pet care numbered list should be parsed');
assert.equal(petList.items.length, 3);
assert.equal(petList.items[0].children.length, 1);
assert.equal(petList.items[1].children.length, 2);
assert.equal(petList.items[0][0].type, 'strong');
assert.ok(petBlocks.every(block => !Object.prototype.hasOwnProperty.call(block, 'html')));

const boundedList = markdown.parse(Array.from({length: 40}, (_, i) => `${i + 1}. item`).join('\n'));
assert.equal(boundedList[0].items.length, 24);

console.log('admin-agent-markdown: PASS');
