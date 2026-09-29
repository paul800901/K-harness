Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let debug = require("debug");
debug = __toESM(debug, 1);
//#region browser-extension/src/relay/manualPromise.ts
/**
* Copyright (c) Microsoft Corporation.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var ManualPromise = class extends Promise {
	_resolve;
	_reject;
	_isDone;
	constructor() {
		let resolve;
		let reject;
		super((f, r) => {
			resolve = f;
			reject = r;
		});
		this._isDone = false;
		this._resolve = resolve;
		this._reject = reject;
	}
	isDone() {
		return this._isDone;
	}
	resolve(t) {
		this._isDone = true;
		this._resolve(t);
	}
	reject(e) {
		this._isDone = true;
		this._reject(e);
	}
	static get [Symbol.species]() {
		return Promise;
	}
	get [Symbol.toStringTag]() {
		return "ManualPromise";
	}
};
//#endregion
//#region browser-extension/src/relay/log.ts
/**
* Copyright (c) Microsoft Corporation.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
var errorDebug = (0, debug.default)("pw:mcp:error");
function logUnhandledError(error) {
	errorDebug(error);
}
(0, debug.default)("pw:mcp:test");
//#endregion
//#region browser-extension/src/relay/browserModel.ts
/**
* Copyright (c) Microsoft Corporation.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
/**
* Browser-side tab model used by the v2 relay. Owns the mapping between
* chrome tab ids and CDP session ids, and is the single place that
* translates between the chrome.* dialect spoken by the extension and the
* CDP dialect spoken by Playwright.
*
* Lifecycle:
*  1. Extension connects and, after the user allows, pushes a
*     `chrome.tabs.onCreated` for each initial tab followed by
*     `extension.initialized`. The model records these as "known" tabs
*     without attaching yet.
*  2. The relay observes `ready()` resolving and unpauses the Playwright ws.
*  3. Playwright sends `Target.setAutoAttach` → model calls
*     `enableAutoAttach()`, which attaches to every known tab and emits
*     `Target.attachedToTarget` for each.
*  4. Subsequent tab creates / debugger detaches / removes flow through the
*     same model inputs and are translated into CDP events on the fly.
*/
var BrowserModel = class {
	_sendToExtension;
	_sendToCDPClient = null;
	_knownTabs = /* @__PURE__ */ new Map();
	_tabSessions = /* @__PURE__ */ new Map();
	_autoAttach = false;
	_nextSessionId = 1;
	constructor(sendToExtension) {
		this._sendToExtension = sendToExtension;
	}
	connectOverCDP(sendToCDPClient) {
		this._sendToCDPClient = sendToCDPClient;
	}
	_emit(message) {
		this._sendToCDPClient?.(message);
	}
	onTabCreated(tab) {
		if (tab.id === void 0) return;
		this._knownTabs.set(tab.id, tab);
		if (this._autoAttach) this._attachTab(tab.id).catch(logUnhandledError);
	}
	onTabRemoved(tabId) {
		this._knownTabs.delete(tabId);
		this._detachTab(tabId);
	}
	onDebuggerEvent(source, method, params) {
		if (source.tabId === void 0) return;
		const tabSession = this._tabSessions.get(source.tabId);
		if (!tabSession) return;
		const childSessionId = params?.sessionId;
		if (method === "Target.attachedToTarget" && childSessionId) tabSession.childSessions.add(childSessionId);
		else if (method === "Target.detachedFromTarget" && childSessionId) tabSession.childSessions.delete(childSessionId);
		const sessionId = source.sessionId || tabSession.sessionId;
		this._emit({
			sessionId,
			method,
			params
		});
	}
	onDebuggerDetach(source) {
		if (source.tabId !== void 0) this._detachTab(source.tabId);
	}
	async enableAutoAttach() {
		this._autoAttach = true;
		const tabIds = [...this._knownTabs.keys()];
		await Promise.all(tabIds.map((tabId) => this._attachTab(tabId).catch(logUnhandledError)));
	}
	async createTarget(url) {
		const tab = await this._sendToExtension("chrome.tabs.create", [{ url }]);
		if (tab?.id === void 0) throw new Error("Failed to create tab");
		this._knownTabs.set(tab.id, tab);
		return { targetId: (await this._attachTab(tab.id)).targetInfo?.targetId };
	}
	async closeTarget(targetId) {
		const tabSession = targetId ? this._findTabSession((s) => s.targetInfo?.targetId === targetId) : void 0;
		if (!tabSession) return { success: false };
		await this._sendToExtension("chrome.tabs.remove", [tabSession.tabId]);
		return { success: true };
	}
	getTargetInfo(sessionId) {
		if (!sessionId) return void 0;
		return this._findTabSession((s) => s.sessionId === sessionId)?.targetInfo;
	}
	async sendBrowserCommand(method, params) {
		const tabSession = this._tabSessions.values().next().value;
		if (!tabSession) throw new Error(`No attached tab to forward browser-level command: ${method}`);
		return await this._sendToExtension("chrome.debugger.sendCommand", [
			{ tabId: tabSession.tabId },
			method,
			params
		]);
	}
	async sendCommand(sessionId, method, params) {
		let tabSession = this._findTabSession((s) => s.sessionId === sessionId);
		let cdpSessionId;
		if (!tabSession) {
			tabSession = this._findTabSession((s) => s.childSessions.has(sessionId));
			cdpSessionId = sessionId;
		}
		if (!tabSession) throw new Error(`No tab found for sessionId: ${sessionId}`);
		if (method === "Page.bringToFront") return await this._sendToExtension("chrome.debugger.sendCommand", [
			{
				tabId: tabSession.tabId,
				sessionId: cdpSessionId
			},
			"Emulation.setFocusEmulationEnabled",
			{ enabled: true }
		]);
		return await this._sendToExtension("chrome.debugger.sendCommand", [
			{
				tabId: tabSession.tabId,
				sessionId: cdpSessionId
			},
			method,
			params
		]);
	}
	async _attachTab(tabId) {
		const existing = this._tabSessions.get(tabId);
		if (existing) return existing;
		await this._sendToExtension("chrome.debugger.attach", [{ tabId }, "1.3"]);
		const result = await this._sendToExtension("chrome.debugger.sendCommand", [{ tabId }, "Target.getTargetInfo"]);
		await this._sendToExtension("chrome.debugger.sendCommand", [
			{ tabId },
			"Emulation.setFocusEmulationEnabled",
			{ enabled: true }
		]);
		const targetInfo = result?.targetInfo;
		const sessionId = `pw-tab-${this._nextSessionId++}`;
		const tabSession = {
			tabId,
			sessionId,
			targetInfo,
			childSessions: /* @__PURE__ */ new Set()
		};
		this._tabSessions.set(tabId, tabSession);
		this._emit({
			method: "Target.attachedToTarget",
			params: {
				sessionId,
				targetInfo: {
					...targetInfo,
					attached: true
				},
				waitingForDebugger: false
			}
		});
		return tabSession;
	}
	_detachTab(tabId) {
		const tabSession = this._tabSessions.get(tabId);
		if (!tabSession) return;
		this._tabSessions.delete(tabId);
		this._emit({
			method: "Target.detachedFromTarget",
			params: {
				sessionId: tabSession.sessionId,
				targetId: tabSession.targetInfo?.targetId
			}
		});
	}
	_findTabSession(predicate) {
		for (const session of this._tabSessions.values()) if (predicate(session)) return session;
	}
};
//#endregion
//#region browser-extension/src/relay/cdpRelayV2.ts
/**
* Copyright (c) Microsoft Corporation.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
/**
* Protocol v2: thin adapter between the extension wire protocol and the
* CDP wire protocol. All tab-model state lives in `BrowserModel`; this file
* only demultiplexes incoming extension events and dispatches CDP commands
* to the model.
*
* Handshake: the extension pushes `chrome.tabs.onCreated` for each initial
* tab, then `extension.initialized`. The relay does not process CDP
* commands until `ready()` resolves, so `Target.setAutoAttach` is always
* answered from a populated model.
*/
var ExtensionProtocolV2 = class {
	_model;
	_ready = new ManualPromise();
	constructor(sendCommand) {
		this._model = new BrowserModel(sendCommand);
		this._ready.catch(logUnhandledError);
	}
	ready() {
		return this._ready;
	}
	connectOverCDP(sendToCDPClient) {
		this._model.connectOverCDP(sendToCDPClient);
	}
	onExtensionDisconnect(reason) {
		if (!this._ready.isDone()) this._ready.reject(/* @__PURE__ */ new Error(`Extension disconnected before initialization: ${reason}`));
	}
	handleExtensionEvent(method, params) {
		switch (method) {
			case "chrome.debugger.onEvent": {
				const [source, cdpMethod, cdpParams] = params;
				this._model.onDebuggerEvent(source, cdpMethod, cdpParams);
				break;
			}
			case "chrome.debugger.onDetach": {
				const [source] = params;
				this._model.onDebuggerDetach(source);
				break;
			}
			case "chrome.tabs.onCreated": {
				const [tab] = params;
				this._model.onTabCreated(tab);
				break;
			}
			case "chrome.tabs.onRemoved": {
				const [tabId] = params;
				this._model.onTabRemoved(tabId);
				break;
			}
			case "extension.initialized": this._ready.resolve();
		}
	}
	async handleCDPCommand(method, params, sessionId) {
		switch (method) {
			case "Target.setAutoAttach":
				if (sessionId) return void 0;
				await this._model.enableAutoAttach();
				return { result: {} };
			case "Target.createTarget": return { result: await this._model.createTarget(params?.url) };
			case "Target.closeTarget": return { result: await this._model.closeTarget(params?.targetId) };
			case "Target.getTargetInfo": return { result: this._model.getTargetInfo(sessionId) };
		}
	}
	async forwardToExtension(method, params, sessionId) {
		if (!sessionId) return await this._model.sendBrowserCommand(method, params);
		return await this._model.sendCommand(sessionId, method, params);
	}
};
//#endregion
exports.ExtensionProtocolV2 = ExtensionProtocolV2;
