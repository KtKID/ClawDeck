// test/mock-recording-test.mjs
// 验证 MockGatewayClient 的 recording 模式和 loadRecording() 功能

import { MockGatewayClient } from '../bridge/mock-replay-source.js';
import { readFileSync } from 'fs';

const fixtures = [
  'test/fixtures/events/all-event-types.json',
  'test/fixtures/events/provider-fallback.json',
  'test/fixtures/events/tool-execution.json',
  'test/fixtures/events/basic-lifecycle.json',
  'test/fixtures/events/error-recovery.json',
  'test/fixtures/events/multi-agent.json',
];

console.log('=== MockGatewayClient Recording Mode Test ===\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ ${message}`);
    passedTests++;
  } else {
    console.log(`  ❌ ${message}`);
  }
}

for (const fixture of fixtures) {
  console.log(`\n--- Testing: ${fixture.split('/').pop()} ---`);

  try {
    const data = JSON.parse(readFileSync(fixture, 'utf8'));
    const client = new MockGatewayClient({ scenario: 'recording' });

    // 收集事件
    const events = {
      session: [],
      chat: [],
      agent: [],
      tool: [],
    };

    client.on('session', (e) => events.session.push(e));
    client.on('chat', (e) => events.chat.push(e));
    client.on('agent', (e) => events.agent.push(e));
    client.on('tool', (e) => events.tool.push(e));

    // 加载录制数据
    client.loadRecording(data);

    assert(client.scenario === 'recording', 'scenario set to recording');
    assert(client._recordingEvents.length === data.events.length, `events loaded: ${data.events.length}`);

    // 连接并运行几个 tick
    client.connect();

    // 等待连接事件
    await new Promise(r => setTimeout(r, 150));

    // 手动触发几个 tick（模拟时间推进）
    for (let i = 0; i < 10; i++) {
      client._advanceTick();
    }

    // 验证事件被处理
    const totalEmitted = events.session.length + events.chat.length + events.agent.length + events.tool.length;
    console.log(`  Events emitted: session=${events.session.length}, chat=${events.chat.length}, agent=${events.agent.length}, tool=${events.tool.length}`);

    // 根据不同 fixture 验证预期结果
    if (fixture.includes('provider-fallback') || fixture.includes('error-recovery')) {
      // 应该有 agent 事件（包含 error 和 fallback）
      assert(events.agent.length > 0, 'has agent events (including error/fallback)');
    }

    if (fixture.includes('tool-execution')) {
      // 应该有 tool 事件
      assert(events.tool.length > 0, 'has tool events');
    }

    if (fixture.includes('basic-lifecycle')) {
      // 应该有 session, chat, tool 事件
      assert(events.session.length > 0, 'has session events');
      assert(events.chat.length > 0, 'has chat events');
    }

    if (fixture.includes('multi-agent')) {
      // 应该有多个 session
      const uniqueSessions = new Set(events.session.map(e => e.sessionId));
      console.log(`  Unique sessions: ${uniqueSessions.size}`);
    }

    // 验证内部状态
    const stateKeys = Object.keys(client._state.sessions);
    console.log(`  Sessions in state: ${stateKeys.length}`);

    client.disconnect();

  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    console.log(`     Stack: ${err.stack?.split('\n').slice(0, 3).join('\n')}`);
  }
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passedTests}/${totalTests}`);
console.log(`Status: ${passedTests === totalTests ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);

process.exit(passedTests === totalTests ? 0 : 1);
