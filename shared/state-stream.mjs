const clone = value => structuredClone(value);
const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function entities(value) {
  return Array.isArray(value) ? value : [];
}

function withoutPayload(item, key) {
  const result = {...item};
  delete result[key];
  return result;
}

function signatures(items, key) {
  return entities(items).map(item => ({id:item.id,value:typeof item[key] === 'string' ? item[key] : '',rest:clone(withoutPayload(item,key))}));
}

function buildCollection(previous, current, key) {
  const oldItems = new Map(previous.map(item => [item.id, item]));
  const newItems = current;
  const newIds = new Set(newItems.map(item => item.id));
  const remove = [...oldItems.keys()].filter(id => !newIds.has(id));
  const upsert = [];
  for (const item of newItems) {
    const old = oldItems.get(item.id);
    const payloadKey = key === 'text' ? 'message' : 'tool';
    if (!old) {
      upsert.push({id:item.id, op:'set', [payloadKey]:{id:item.id,...item.rest,[key]:item.value}});
      continue;
    }
    if (old.value !== item.value) {
      const before = old.value;
      const after = item.value;
      if (after.startsWith(before)) upsert.push({id:item.id, op:'append', [key]:after.slice(before.length)});
      else if (key === 'output') upsert.push({id:item.id, op:'tail', output:after});
      else upsert.push({id:item.id, op:'set', [key]:after});
    }
    if (!jsonEqual(old.rest, item.rest)) upsert.push({id:item.id, op:'fields', [payloadKey]:{id:item.id,...item.rest}});
  }
  const order = newItems.map(item => item.id);
  const oldOrder = previous.map(item => item.id);
  return {remove, ...(upsert.length ? {upsert} : {}), ...(jsonEqual(order, oldOrder) ? {} : {order})};
}

/**
 * Makes compact SSE state events while tolerating controllers that mutate state
 * and entities in place. The retained entity baseline contains only IDs, the
 * message/output string, and a clone of the other entity fields; bulky message
 * text and tool output are never repeatedly JSON-serialized.
 */
export function createStateStream() {
  let revision = 0;
  let baseline = null;
  const split = state => {
    const {messages=[], tools=[], ...fields} = state;
    return {fields:clone(fields), messages:signatures(messages,'text'), tools:signatures(tools,'output')};
  };
  const snapshot = state => {
    const captured = split(state);
    baseline = captured;
    return {type:'snapshot', revision, state:{...captured.fields,messages:clone(state.messages??[]),tools:clone(state.tools??[])}};
  };
  const update = state => {
    const current = split(state);
    if (!baseline) return snapshot(state);
    const changes = {};
    const messageChanges = buildCollection(baseline.messages,current.messages,'text');
    const toolChanges = buildCollection(baseline.tools,current.tools,'output');
    if (messageChanges.remove.length || messageChanges.upsert?.length || messageChanges.order) changes.messages = messageChanges;
    if (toolChanges.remove.length || toolChanges.upsert?.length || toolChanges.order) changes.tools = toolChanges;
    for (const key of new Set([...Object.keys(baseline.fields),...Object.keys(current.fields)])) {
      if (!Object.hasOwn(baseline.fields,key) || !Object.hasOwn(current.fields,key) || !jsonEqual(baseline.fields[key],current.fields[key])) {
        changes[key] = Object.hasOwn(current.fields,key) ? current.fields[key] : null;
      }
    }
    // Keep independent copies so subsequent in-place controller mutations cannot
    // rewrite the baseline. Do not stringify the messages/tools collections.
    baseline = current;
    if (!Object.keys(changes).length) return null;
    return {type:'patch',revision:++revision,changes};
  };
  return {snapshot,update};
}

export function applyStateEvent(previous, event) {
  // Compatibility with the still-running legacy desktop server: it sends a
  // complete bare state object until that server is restarted. Do not treat
  // typed incremental events as snapshots here.
  if (event && !Object.hasOwn(event, 'type') && Object.hasOwn(event, 'status') && Array.isArray(event.messages)) {
    return clone(event);
  }
  if (event?.type === 'snapshot') return clone(event.state);
  if (event?.type !== 'patch' || !previous) return previous;
  const next = {...previous};
  const changes = event.changes ?? {};
  for (const [key,value] of Object.entries(changes)) {
    if (key === 'messages' || key === 'tools') continue;
    next[key] = clone(value);
  }
  for (const collection of ['messages','tools']) {
    const delta = changes[collection];
    if (!delta) continue;
    let values = [...entities(previous[collection])];
    if (delta.remove?.length) {
      const removed = new Set(delta.remove);
      values = values.filter(item => !removed.has(item.id));
    }
    for (const op of delta.upsert ?? []) {
      const index = values.findIndex(item => item.id === op.id);
      const payloadKey = collection === 'messages' ? 'message' : 'tool';
      if (op.op === 'set' && op[payloadKey]) {
        if (index < 0) values.push(clone(op[payloadKey])); else values[index] = clone(op[payloadKey]);
      } else if (op.op === 'append' && index >= 0) {
        const field = collection === 'messages' ? 'text' : 'output';
        values[index] = {...values[index],[field]:(values[index][field] ?? '') + op[field]};
      } else if (op.op === 'tail' && index >= 0) {
        values[index] = {...values[index],output:op.output};
      } else if (op.op === 'fields') {
        const fieldValues = op[payloadKey] ?? {};
        if (index < 0) continue;
        const field = collection === 'messages' ? 'text' : 'output';
        values[index] = {...fieldValues,[field]:values[index][field]};
      } else if (op.op === 'set' && !op[payloadKey]) {
        const field = collection === 'messages' ? 'text' : 'output';
        if (index >= 0) values[index] = {...values[index],[field]:op[field]};
      }
    }
    if (delta.order) {
      const byId = new Map(values.map(item => [item.id,item]));
      values = delta.order.map(id => byId.get(id)).filter(Boolean);
      // Preserve any items omitted by a partial order defensively.
      for (const item of byId.values()) if (!delta.order.includes(item.id)) values.push(item);
    }
    next[collection] = values;
  }
  return next;
}
