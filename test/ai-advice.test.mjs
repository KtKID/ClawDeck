/**
 * AI Advice 模块测试
 *
 * 运行: node test/ai-advice.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 导入被测模块
import { getPriorityInfo, limitAdvices, PRIORITY_CONFIG, MAX_ADVICE_COUNT } from '../ui/ai-advice-types.js';

// ============================================================
// Tests
// ============================================================

describe('AI Advice Types', () => {
  describe('getPriorityInfo', () => {
    it('优先级5应返回高优先级', () => {
      const result = getPriorityInfo(5);
      assert.strictEqual(result.label, '高优先级');
      assert.strictEqual(result.className, 'high');
    });

    it('优先级4应返回中优先级', () => {
      const result = getPriorityInfo(4);
      assert.strictEqual(result.label, '中优先级');
      assert.strictEqual(result.className, 'medium');
    });

    it('优先级3应返回中优先级', () => {
      const result = getPriorityInfo(3);
      assert.strictEqual(result.label, '中优先级');
      assert.strictEqual(result.className, 'medium');
    });

    it('优先级2应返回低优先级', () => {
      const result = getPriorityInfo(2);
      assert.strictEqual(result.label, '低优先级');
      assert.strictEqual(result.className, 'low');
    });

    it('优先级1应返回低优先级', () => {
      const result = getPriorityInfo(1);
      assert.strictEqual(result.label, '低优先级');
      assert.strictEqual(result.className, 'low');
    });

    it('边界值5返回高优先级', () => {
      const result = getPriorityInfo(5);
      assert.strictEqual(result.className, 'high');
    });

    it('边界值1返回低优先级', () => {
      const result = getPriorityInfo(1);
      assert.strictEqual(result.className, 'low');
    });

    it('优先级0应返回低优先级', () => {
      const result = getPriorityInfo(0);
      assert.strictEqual(result.className, 'low');
    });

    it('优先级6应返回高优先级', () => {
      const result = getPriorityInfo(6);
      assert.strictEqual(result.className, 'high');
    });

    it('null输入应返回低优先级', () => {
      const result = getPriorityInfo(null);
      assert.strictEqual(result.className, 'low');
    });

    it('undefined输入应返回低优先级', () => {
      const result = getPriorityInfo(undefined);
      assert.strictEqual(result.className, 'low');
    });
  });

  describe('limitAdvices', () => {
    const mockAdvices = [
      { id: '1', priority: 5 },
      { id: '2', priority: 4 },
      { id: '3', priority: 3 },
      { id: '4', priority: 2 },
      { id: '5', priority: 1 },
      { id: '6', priority: 1 },
    ];

    it('默认限制3条', () => {
      const result = limitAdvices(mockAdvices);
      assert.strictEqual(result.length, 3);
    });

    it('自定义限制5条', () => {
      const result = limitAdvices(mockAdvices, 5);
      assert.strictEqual(result.length, 5);
    });

    it('数据少于限制返回全部', () => {
      const result = limitAdvices(mockAdvices.slice(0, 2), 5);
      assert.strictEqual(result.length, 2);
    });

    it('空数组返回空数组', () => {
      const result = limitAdvices([]);
      assert.strictEqual(result.length, 0);
    });

    it('不修改原数组', () => {
      const original = [...mockAdvices];
      limitAdvices(mockAdvices, 2);
      assert.strictEqual(mockAdvices.length, original.length);
    });

    it('null输入返回空数组', () => {
      const result = limitAdvices(null);
      assert.strictEqual(result.length, 0);
    });
  });

  describe('常量', () => {
    it('MAX_ADVICE_COUNT应为3', () => {
      assert.strictEqual(MAX_ADVICE_COUNT, 3);
    });

    it('PRIORITY_CONFIG配置正确', () => {
      assert.strictEqual(PRIORITY_CONFIG.HIGH.min, 5);
      assert.strictEqual(PRIORITY_CONFIG.HIGH.max, 5);
      assert.strictEqual(PRIORITY_CONFIG.MEDIUM.min, 3);
      assert.strictEqual(PRIORITY_CONFIG.MEDIUM.max, 4);
      assert.strictEqual(PRIORITY_CONFIG.LOW.min, 1);
      assert.strictEqual(PRIORITY_CONFIG.LOW.max, 2);
    });
  });
});
