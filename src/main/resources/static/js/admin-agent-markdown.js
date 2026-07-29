(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AdminAgentMarkdown = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MAX_SOURCE = 20000;
  var MAX_BLOCKS = 80;
  var MAX_TABLE_ROWS = 30;
  var MAX_TABLE_COLUMNS = 8;
  var MAX_LIST_ITEMS = 24;
  var MAX_LIST_CHILDREN = 12;

  function inline(value) {
    var text = String(value == null ? '' : value);
    var result = [];
    var cursor = 0;
    var token = /(\*\*([^*\n]{1,400})\*\*|__([^_\n]{1,400})__|`([^`\n]{1,240})`)/g;
    var match;
    while ((match = token.exec(text)) !== null) {
      if (match.index > cursor) result.push({ type: 'text', text: text.slice(cursor, match.index) });
      if (match[4] != null) result.push({ type: 'code', text: match[4] });
      else result.push({ type: 'strong', text: match[2] != null ? match[2] : match[3] });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) result.push({ type: 'text', text: text.slice(cursor) });
    if (!result.length) result.push({ type: 'text', text: text });
    return result;
  }

  function plain(parts) {
    return (parts || []).map(function (part) { return part.text || ''; }).join('').trim();
  }

  function tableCells(line) {
    var value = String(line || '').trim();
    if (value.charAt(0) === '|') value = value.slice(1);
    if (value.charAt(value.length - 1) === '|') value = value.slice(0, -1);
    return value.split('|').slice(0, MAX_TABLE_COLUMNS).map(function (cell) { return cell.trim(); });
  }

  function isTableDivider(line) {
    var cells = tableCells(line);
    return cells.length > 0 && cells.every(function (cell) { return /^:?-{3,}:?$/.test(cell); });
  }

  function isStart(lines, index) {
    var line = (lines[index] || '').trim();
    if (!line) return true;
    if (/^#{1,4}\s+/.test(line) || /^([-*_])\1{2,}$/.test(line)) return true;
    if (/^(?:[-+*]\s+|\d+[.)]\s+|>\s?)/.test(line)) return true;
    return index + 1 < lines.length && line.indexOf('|') >= 0 && isTableDivider(lines[index + 1]);
  }

  function parse(raw) {
    var source = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').slice(0, MAX_SOURCE);
    var lines = source.split('\n');
    var blocks = [];
    var index = 0;
    while (index < lines.length && blocks.length < MAX_BLOCKS) {
      var line = lines[index].trim();
      if (!line) { index += 1; continue; }
      var heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        blocks.push({ type: 'heading', level: heading[1].length, parts: inline(heading[2]) });
        index += 1;
        continue;
      }
      if (/^([-*_])\1{2,}$/.test(line)) {
        blocks.push({ type: 'divider' });
        index += 1;
        continue;
      }
      if (index + 1 < lines.length && line.indexOf('|') >= 0 && isTableDivider(lines[index + 1])) {
        var headerValues = tableCells(line);
        var headers = headerValues.map(function (cell) {
          var parts = inline(cell);
          return { parts: parts, plain: plain(parts) || '项目' };
        });
        var rows = [];
        index += 2;
        while (index < lines.length && rows.length < MAX_TABLE_ROWS) {
          var rowLine = lines[index].trim();
          if (!rowLine || rowLine.indexOf('|') < 0) break;
          var values = tableCells(rowLine);
          while (values.length < headers.length) values.push('');
          rows.push(values.slice(0, headers.length).map(inline));
          index += 1;
        }
        blocks.push({ type: 'table', headers: headers, rows: rows });
        continue;
      }
      var listMatch = line.match(/^([-+*])\s+(.+)$/) || line.match(/^(\d+)[.)]\s+(.+)$/);
      if (listMatch) {
        var ordered = /^\d/.test(listMatch[1]);
        var start = ordered ? Math.max(1, parseInt(listMatch[1], 10) || 1) : 1;
        var items = [];
        while (index < lines.length && items.length < MAX_LIST_ITEMS) {
          var candidate = lines[index];
          var itemMatch = ordered
            ? candidate.match(/^\s{0,3}\d+[.)]\s+(.+)$/)
            : candidate.match(/^\s{0,3}[-+*]\s+(.+)$/);
          if (!itemMatch) break;
          var itemParts = inline(itemMatch[1]);
          itemParts.children = [];
          items.push(itemParts);
          index += 1;

          // A short blank line between steps is common in LLM Markdown. Keep it
          // inside the same list and attach indented bullets to the current step.
          while (index < lines.length) {
            var nested = lines[index].match(/^\s{2,}[-+*]\s+(.+)$/);
            if (nested) {
              if (itemParts.children.length < MAX_LIST_CHILDREN) itemParts.children.push(inline(nested[1]));
              index += 1;
              continue;
            }
            if (!lines[index].trim()) {
              var lookahead = index + 1;
              while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
              var nextRoot = lookahead < lines.length && (ordered
                ? /^\s{0,3}\d+[.)]\s+/.test(lines[lookahead])
                : /^\s{0,3}[-+*]\s+/.test(lines[lookahead]));
              var nextChild = lookahead < lines.length && /^\s{2,}[-+*]\s+/.test(lines[lookahead]);
              if (nextRoot || nextChild) { index = lookahead; continue; }
            }
            break;
          }
        }
        blocks.push({ type: 'list', ordered: ordered, start: start, items: items });
        continue;
      }
      if (/^>\s?/.test(line)) {
        var quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          quote.push(lines[index].trim().replace(/^>\s?/, ''));
          index += 1;
        }
        blocks.push({ type: 'quote', parts: inline(quote.join(' ')) });
        continue;
      }
      var paragraph = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isStart(lines, index)) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ type: 'paragraph', parts: inline(paragraph.join(' ')) });
    }
    return blocks.length ? blocks : [{ type: 'paragraph', parts: inline('暂无可显示内容。') }];
  }

  return Object.freeze({ parse: parse, inline: inline });
});
