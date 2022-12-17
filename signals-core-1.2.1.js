"use strict";
function cycleDetected() {
  throw new Error("Cycle detected");
}
const RUNNING = 1 << 0;
const NOTIFIED = 1 << 1;
const OUTDATED = 1 << 2;
const DISPOSED = 1 << 3;
const HAS_ERROR = 1 << 4;
const TRACKING = 1 << 5;
function startBatch() {
  batchDepth++;
}
function endBatch() {
  if (batchDepth > 1) {
    batchDepth--;
    return;
  }
  let error;
  let hasError = false;
  while (batchedEffect !== void 0) {
    let effect2 = batchedEffect;
    batchedEffect = void 0;
    batchIteration++;
    while (effect2 !== void 0) {
      const next = effect2._nextBatchedEffect;
      effect2._nextBatchedEffect = void 0;
      effect2._flags &= ~NOTIFIED;
      if (!(effect2._flags & DISPOSED) && needsToRecompute(effect2)) {
        try {
          effect2._callback();
        } catch (err) {
          if (!hasError) {
            error = err;
            hasError = true;
          }
        }
      }
      effect2 = next;
    }
  }
  batchIteration = 0;
  batchDepth--;
  if (hasError) {
    throw error;
  }
}
function batch(callback) {
  if (batchDepth > 0) {
    return callback();
  }
  startBatch();
  try {
    return callback();
  } finally {
    endBatch();
  }
}
let evalContext = void 0;
let batchedEffect = void 0;
let batchDepth = 0;
let batchIteration = 0;
let globalVersion = 0;
function addDependency(signal2) {
  if (evalContext === void 0) {
    return void 0;
  }
  let node = signal2._node;
  if (node === void 0 || node._target !== evalContext) {
    node = {
      _version: 0,
      _source: signal2,
      _prevSource: void 0,
      _nextSource: evalContext._sources,
      _target: evalContext,
      _prevTarget: void 0,
      _nextTarget: void 0,
      _rollbackNode: node
    };
    evalContext._sources = node;
    signal2._node = node;
    if (evalContext._flags & TRACKING) {
      signal2._subscribe(node);
    }
    return node;
  } else if (node._version === -1) {
    node._version = 0;
    if (node._prevSource !== void 0) {
      node._prevSource._nextSource = node._nextSource;
      if (node._nextSource !== void 0) {
        node._nextSource._prevSource = node._prevSource;
      }
      node._prevSource = void 0;
      node._nextSource = evalContext._sources;
      evalContext._sources._prevSource = node;
      evalContext._sources = node;
    }
    return node;
  }
  return void 0;
}
function Signal(value) {
  this._value = value;
  this._version = 0;
  this._node = void 0;
  this._targets = void 0;
}
Signal.prototype._refresh = function() {
  return true;
};
Signal.prototype._subscribe = function(node) {
  if (this._targets !== node && node._prevTarget === void 0) {
    node._nextTarget = this._targets;
    if (this._targets !== void 0) {
      this._targets._prevTarget = node;
    }
    this._targets = node;
  }
};
Signal.prototype._unsubscribe = function(node) {
  const prev = node._prevTarget;
  const next = node._nextTarget;
  if (prev !== void 0) {
    prev._nextTarget = next;
    node._prevTarget = void 0;
  }
  if (next !== void 0) {
    next._prevTarget = prev;
    node._nextTarget = void 0;
  }
  if (node === this._targets) {
    this._targets = next;
  }
};
Signal.prototype.subscribe = function(fn) {
  const signal2 = this;
  return effect(function() {
    const value = signal2.value;
    const flag = this._flags & TRACKING;
    this._flags &= ~TRACKING;
    try {
      fn(value);
    } finally {
      this._flags |= flag;
    }
  });
};
Signal.prototype.valueOf = function() {
  return this.value;
};
Signal.prototype.toString = function() {
  return this.value + "";
};
Signal.prototype.peek = function() {
  return this._value;
};
Object.defineProperty(Signal.prototype, "value", {
  get() {
    const node = addDependency(this);
    if (node !== void 0) {
      node._version = this._version;
    }
    return this._value;
  },
  set(value) {
    if (value !== this._value) {
      if (batchIteration > 100) {
        cycleDetected();
      }
      this._value = value;
      this._version++;
      globalVersion++;
      startBatch();
      try {
        for (let node = this._targets; node !== void 0; node = node._nextTarget) {
          node._target._notify();
        }
      } finally {
        endBatch();
      }
    }
  }
});
function signal(value) {
  return new Signal(value);
}
function needsToRecompute(target) {
  for (let node = target._sources; node !== void 0; node = node._nextSource) {
    if (node._source._version !== node._version || !node._source._refresh() || node._source._version !== node._version) {
      return true;
    }
  }
  return false;
}
function prepareSources(target) {
  for (let node = target._sources; node !== void 0; node = node._nextSource) {
    const rollbackNode = node._source._node;
    if (rollbackNode !== void 0) {
      node._rollbackNode = rollbackNode;
    }
    node._source._node = node;
    node._version = -1;
  }
}
function cleanupSources(target) {
  let node = target._sources;
  let sources = void 0;
  while (node !== void 0) {
    const next = node._nextSource;
    if (node._version === -1) {
      node._source._unsubscribe(node);
      node._nextSource = void 0;
    } else {
      if (sources !== void 0) {
        sources._prevSource = node;
      }
      node._prevSource = void 0;
      node._nextSource = sources;
      sources = node;
    }
    node._source._node = node._rollbackNode;
    if (node._rollbackNode !== void 0) {
      node._rollbackNode = void 0;
    }
    node = next;
  }
  target._sources = sources;
}
function Computed(compute) {
  Signal.call(this, void 0);
  this._compute = compute;
  this._sources = void 0;
  this._globalVersion = globalVersion - 1;
  this._flags = OUTDATED;
}
Computed.prototype = new Signal();
Computed.prototype._refresh = function() {
  this._flags &= ~NOTIFIED;
  if (this._flags & RUNNING) {
    return false;
  }
  if ((this._flags & (OUTDATED | TRACKING)) === TRACKING) {
    return true;
  }
  this._flags &= ~OUTDATED;
  if (this._globalVersion === globalVersion) {
    return true;
  }
  this._globalVersion = globalVersion;
  this._flags |= RUNNING;
  if (this._version > 0 && !needsToRecompute(this)) {
    this._flags &= ~RUNNING;
    return true;
  }
  const prevContext = evalContext;
  try {
    prepareSources(this);
    evalContext = this;
    const value = this._compute();
    if (this._flags & HAS_ERROR || this._value !== value || this._version === 0) {
      this._value = value;
      this._flags &= ~HAS_ERROR;
      this._version++;
    }
  } catch (err) {
    this._value = err;
    this._flags |= HAS_ERROR;
    this._version++;
  }
  evalContext = prevContext;
  cleanupSources(this);
  this._flags &= ~RUNNING;
  return true;
};
Computed.prototype._subscribe = function(node) {
  if (this._targets === void 0) {
    this._flags |= OUTDATED | TRACKING;
    for (let node2 = this._sources; node2 !== void 0; node2 = node2._nextSource) {
      node2._source._subscribe(node2);
    }
  }
  Signal.prototype._subscribe.call(this, node);
};
Computed.prototype._unsubscribe = function(node) {
  Signal.prototype._unsubscribe.call(this, node);
  if (this._targets === void 0) {
    this._flags &= ~TRACKING;
    for (let node2 = this._sources; node2 !== void 0; node2 = node2._nextSource) {
      node2._source._unsubscribe(node2);
    }
  }
};
Computed.prototype._notify = function() {
  if (!(this._flags & NOTIFIED)) {
    this._flags |= OUTDATED | NOTIFIED;
    for (let node = this._targets; node !== void 0; node = node._nextTarget) {
      node._target._notify();
    }
  }
};
Computed.prototype.peek = function() {
  if (!this._refresh()) {
    cycleDetected();
  }
  if (this._flags & HAS_ERROR) {
    throw this._value;
  }
  return this._value;
};
Object.defineProperty(Computed.prototype, "value", {
  get() {
    if (this._flags & RUNNING) {
      cycleDetected();
    }
    const node = addDependency(this);
    this._refresh();
    if (node !== void 0) {
      node._version = this._version;
    }
    if (this._flags & HAS_ERROR) {
      throw this._value;
    }
    return this._value;
  }
});
function computed(compute) {
  return new Computed(compute);
}
function cleanupEffect(effect2) {
  const cleanup = effect2._cleanup;
  effect2._cleanup = void 0;
  if (typeof cleanup === "function") {
    startBatch();
    const prevContext = evalContext;
    evalContext = void 0;
    try {
      cleanup();
    } catch (err) {
      effect2._flags &= ~RUNNING;
      effect2._flags |= DISPOSED;
      disposeEffect(effect2);
      throw err;
    } finally {
      evalContext = prevContext;
      endBatch();
    }
  }
}
function disposeEffect(effect2) {
  for (let node = effect2._sources; node !== void 0; node = node._nextSource) {
    node._source._unsubscribe(node);
  }
  effect2._compute = void 0;
  effect2._sources = void 0;
  cleanupEffect(effect2);
}
function endEffect(prevContext) {
  if (evalContext !== this) {
    throw new Error("Out-of-order effect");
  }
  cleanupSources(this);
  evalContext = prevContext;
  this._flags &= ~RUNNING;
  if (this._flags & DISPOSED) {
    disposeEffect(this);
  }
  endBatch();
}
function Effect(compute) {
  this._compute = compute;
  this._cleanup = void 0;
  this._sources = void 0;
  this._nextBatchedEffect = void 0;
  this._flags = TRACKING;
}
Effect.prototype._callback = function() {
  const finish = this._start();
  try {
    if (!(this._flags & DISPOSED) && this._compute !== void 0) {
      this._cleanup = this._compute();
    }
  } finally {
    finish();
  }
};
Effect.prototype._start = function() {
  if (this._flags & RUNNING) {
    cycleDetected();
  }
  this._flags |= RUNNING;
  this._flags &= ~DISPOSED;
  cleanupEffect(this);
  prepareSources(this);
  startBatch();
  const prevContext = evalContext;
  evalContext = this;
  return endEffect.bind(this, prevContext);
};
Effect.prototype._notify = function() {
  if (!(this._flags & NOTIFIED)) {
    this._flags |= NOTIFIED;
    this._nextBatchedEffect = batchedEffect;
    batchedEffect = this;
  }
};
Effect.prototype._dispose = function() {
  this._flags |= DISPOSED;
  if (!(this._flags & RUNNING)) {
    disposeEffect(this);
  }
};
function effect(compute) {
  const effect2 = new Effect(compute);
  effect2._callback();
  return effect2._dispose.bind(effect2);
}
export { signal, computed, effect, batch, Signal };
