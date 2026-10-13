import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryErrorClass} from '../src/native-error-class.mjs';

test('proven hard limits outrank HTTP 429',()=>{
 assert.equal(recoveryErrorClass({message:'x',codexErrorInfo:'usageLimitExceeded'}),'hard');
 assert.equal(recoveryErrorClass({message:'x',codexErrorInfo:{responseTooManyFailedAttempts:{httpStatusCode:403}}}),'hard');
 assert.equal(recoveryErrorClass({message:"You've hit your weekly usage limit",codexErrorInfo:{responseTooManyFailedAttempts:{httpStatusCode:429}}}),'hard');
 assert.equal(recoveryErrorClass({message:'x',additionalDetails:{error:{code:'insufficient_quota'}}}),'hard');
});

test('ordinary rate limits are recoverable rate errors, not quota exhaustion',()=>{
 assert.equal(recoveryErrorClass({message:'x',codexErrorInfo:'rateLimitExceeded'}),'rate');
 assert.equal(recoveryErrorClass({message:'x',codexErrorInfo:{responseTooManyFailedAttempts:{httpStatusCode:429}}}),'rate');
 assert.equal(recoveryErrorClass({message:'exceeded retry limit, last status: 429 Too Many Requests'}),'rate');
 assert.equal(recoveryErrorClass({message:'Rate limit reached.'}),'rate');
});

test('other failures and malformed errors stay distinct',()=>{
 assert.equal(recoveryErrorClass({message:'stream disconnected',codexErrorInfo:'other'}),'other');
 assert.equal(recoveryErrorClass({codexErrorInfo:'rateLimitExceeded'}),'unknown');
 assert.equal(recoveryErrorClass(null),'unknown');
});
