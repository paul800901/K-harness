import React from 'react';
import {
  DIALOGUE_FONT_SIZE_OPTIONS,
  INTERFACE_SCALE_OPTIONS,
  normalizeAppearance,
} from './appearance.mjs';

/**
 * Settings-only view. The parent owns the state so the existing settings Modal
 * can keep its current close/finish behaviour and theme controls.
 */
export function AppearanceSettings({ value, onChange }) {
  const appearance = normalizeAppearance(value);
  const update = (key, next) => onChange?.(normalizeAppearance({ ...appearance, [key]: Number(next) }));
  return <section className="appearance-settings" aria-label="介面可讀性設定">
    <div className="setting-row appearance-setting-row">
      <div>
        <strong>介面縮放</strong>
        <small>調整整個 K 介面，包含側欄、對話、按鈕與視窗</small>
      </div>
      <select aria-label="介面縮放" value={appearance.interfaceScale} onChange={event => update('interfaceScale', event.target.value)}>
        {INTERFACE_SCALE_OPTIONS.map(option => <option key={option} value={option}>{option}%</option>)}
      </select>
    </div>
    <div className="setting-row appearance-setting-row">
      <div>
        <strong>對話字體大小</strong>
        <small>只調整工作對話文字，不會改變原始訊息內容</small>
      </div>
      <select aria-label="對話字體大小" value={appearance.dialogueFontSize} onChange={event => update('dialogueFontSize', event.target.value)}>
        {DIALOGUE_FONT_SIZE_OPTIONS.map(option => <option key={option} value={option}>{option}px</option>)}
      </select>
    </div>
  </section>;
}
