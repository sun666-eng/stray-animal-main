/**
 * 全站状态词单一事实源（前端优化 P2）。
 * 背景：同一状态在相邻页面用词不同（vstate=2 在用户端「未通过」、管理端「已驳回」；
 * 动物状态在详情页/申请页各一套），10+ 处内联 map 各写各的。
 * 约定：用户可见状态词只在此定义；新页面禁止再内联状态 map。
 * 术语基线：领养审核=待审核/已通过/未通过；动物=等待领养/申请审核中/已找到新家。
 */
(function (global) {
  'use strict';

  var ADOPT_STATE = Object.freeze({ 0: '待审核', 1: '已通过', 2: '未通过', 3: '其他状态' });
  var ANIMAL_STATE = Object.freeze({ 0: '等待领养', 1: '申请审核中', 2: '已找到新家' });
  var PROOF_STATE = Object.freeze({ 0: '待审核', 1: '已通过', 2: '未通过' });
  var VOLUNTEER_STATE = Object.freeze({ 0: '待审核', 1: '已通过', 2: '未通过' });
  var HELP_STATE = Object.freeze({ 0: '待处理', 1: '处理中', 2: '已完成' });

  function textOf(map, value) {
    var text = map[Number(value)];
    return text === undefined ? '状态未知' : text;
  }

  global.StatusText = Object.freeze({
    adopt: function (v) { return textOf(ADOPT_STATE, v); },
    animal: function (v) { return textOf(ANIMAL_STATE, v); },
    proof: function (v) { return textOf(PROOF_STATE, v); },
    volunteer: function (v) { return textOf(VOLUNTEER_STATE, v); },
    help: function (v) { return textOf(HELP_STATE, v); }
  });
})(typeof window !== 'undefined' ? window : this);
