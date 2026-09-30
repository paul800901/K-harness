import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeRateStatus} from '../src/claude-rate-status.mjs';

test('allowed with org-level-disabled extra usage is informational, not a warning',()=>{
  const result=claudeRateStatus({status:null}, {rate_limit_info:{status:'allowed',overageStatus:'rejected',overageDisabledReason:'org_level_disabled'}});
  assert.equal(result.status,'allowed');
  assert.equal(result.extraUsageDisabled,true);
  assert.equal('notice' in result,false);
});

test('native rate status updates usage data without synthesizing a K notice',()=>{
  const event=status=>({rate_limit_info:{status}});
  for(const status of ['allowed_warning','rejected','rejected','allowed']){
    const result=claudeRateStatus({status:null},event(status));
    assert.equal(result.status,status);
    assert.equal('notice' in result,false);
  }
  assert.equal(claudeRateStatus({status:'allowed',extraUsageDisabled:true},event('rejected')).extraUsageDisabled,null);
});

test('missing native status remains unknown',()=>{
  const result=claudeRateStatus({status:null,extraUsageDisabled:null},{rate_limit_info:{overageStatus:'rejected'}});
  assert.equal(result.status,null);
  assert.equal('notice' in result,false);
});
