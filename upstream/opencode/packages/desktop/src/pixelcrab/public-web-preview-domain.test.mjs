import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resolvePixelCrabLocalPreviewURL, resolvePixelCrabManualPreviewURL,
  matchesPixelCrabEvidenceRoute, capturePixelCrabEvidenceScreenshots,
  normalizePixelCrabVisualChanges, sanitizePixelCrabPreviewConsoleMessage,
} from './web-preview-domain.ts'

test('agent navigation stays local while explicit browser navigation permits HTTP(S)', () => {
  assert.equal(resolvePixelCrabLocalPreviewURL('http://runtime-test.localhost:4173/'), 'http://runtime-test.localhost:4173/')
  for (const value of ['https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pass@localhost:4173']) assert.equal(resolvePixelCrabLocalPreviewURL(value), undefined)
  assert.equal(resolvePixelCrabManualPreviewURL('https://example.com'), 'https://example.com/')
  assert.equal(resolvePixelCrabManualPreviewURL('javascript:alert(1)'), undefined)
})

test('Evidence becomes stale on navigation, including query or fragment changes', () => {
  const route='http://localhost:4173/page?mode=one#first'
  assert.equal(matchesPixelCrabEvidenceRoute(route,route),true)
  for(const next of ['http://localhost:4173/page?mode=two#first','http://localhost:4173/page?mode=one#second','http://localhost:4174/page?mode=one#first'])assert.equal(matchesPixelCrabEvidenceRoute(next,route),false)
})

test('unavailable screenshots degrade without losing structured evidence work', async () => {
  const result=await capturePixelCrabEvidenceScreenshots(async()=>{throw new Error('no display surface')},String,{x:0,y:0,width:20,height:20})
  assert.deepEqual(result,{screenshot:undefined,regionScreenshot:undefined})
  const partial=await capturePixelCrabEvidenceScreenshots(async clip=>{if(clip)throw new Error('crop unavailable');return 'full'},String,{x:0,y:0,width:20,height:20})
  assert.deepEqual(partial,{screenshot:'full',regionScreenshot:undefined})
})

test('visual style evidence rejects active URLs and console output redacts authorization', () => {
  const changes=normalizePixelCrabVisualChanges([{id:'change',number:1,route:'http://localhost:4173/',selector:'#button',styles:{color:'red','background-image':'url(https://example.com/tracker)'}}])
  assert.equal(changes.length,1)
  assert.equal(changes[0].styles.color,'red')
  assert.equal(changes[0].styles['background-image'],undefined)
  assert.ok(!sanitizePixelCrabPreviewConsoleMessage('Authorization: Bearer privatevalue').includes('privatevalue'))
})
