import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeRateStatus} from '../src/claude-rate-status.mjs';

test('allowed with org-level-disabled extra usage is informational, not a warning',()=>{
  const result=claudeRateStatus({status:null}, {rate_limit_info:{status:'allowed',overageStatus:'rejected',overageDisabledReason:'org_level_disabled'}});
  assert.equal(result.status,'allowed');
  assert.equal(result.extraUsageDisabled,true);
  assert.equal(result.notice,null);
});

test('non-allowed rate-limit notices are deduplicated until the status changes',()=>{
  const event=status=>({rate_limit_info:{status}});
  const limited=claudeRateStatus({status:null},event('allowed_warning'));
  assert.equal(limited.notice.status,'allowed_warning');
  assert.equal(claudeRateStatus({status:limited.status},event('allowed_warning')).notice,null);
  assert.equal(claudeRateStatus({status:limited.status},event('allowed')).notice,null);
  assert.equal(claudeRateStatus({status:'allowed'},event('allowed_warning')).notice.status,'allowed_warning');
  assert.equal(claudeRateStatus({status:'allowed',extraUsageDisabled:true},event('rejected')).extraUsageDisabled,null);
});

test('missing native status remains unknown',()=>{
  const result=claudeRateStatus({status:null,extraUsageDisabled:null},{rate_limit_info:{overageStatus:'rejected'}});
  assert.equal(result.status,null);
  assert.equal(result.notice,null);
});
