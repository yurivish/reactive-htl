// signals-core-1.2.1.js
function cycleDetected() {
  throw new Error("Cycle detected");
}
var RUNNING = 1 << 0;
var NOTIFIED = 1 << 1;
var OUTDATED = 1 << 2;
var DISPOSED = 1 << 3;
var HAS_ERROR = 1 << 4;
var TRACKING = 1 << 5;
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
var evalContext = void 0;
var batchedEffect = void 0;
var batchDepth = 0;
var batchIteration = 0;
var globalVersion = 0;
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

// htl-special-0.3.1.js
function renderHtml(string) {
  const template = document.createElement("template");
  template.innerHTML = string;
  return document.importNode(template.content, true);
}
function renderSvg(string) {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.innerHTML = string;
  return g;
}
var html = Object.assign(hypertext(renderHtml, (fragment) => {
  if (fragment.firstChild === null)
    return null;
  if (fragment.firstChild === fragment.lastChild)
    return fragment.removeChild(fragment.firstChild);
  const span = document.createElement("span");
  span.appendChild(fragment);
  return span;
}), { fragment: hypertext(renderHtml, (fragment) => fragment) });
var svg = Object.assign(hypertext(renderSvg, (g) => {
  if (g.firstChild === null)
    return null;
  if (g.firstChild === g.lastChild)
    return g.removeChild(g.firstChild);
  return g;
}), { fragment: hypertext(renderSvg, (g) => {
  const fragment = document.createDocumentFragment();
  while (g.firstChild)
    fragment.appendChild(g.firstChild);
  return fragment;
}) });
var CODE_TAB = 9;
var CODE_LF = 10;
var CODE_FF = 12;
var CODE_CR = 13;
var CODE_SPACE = 32;
var CODE_UPPER_A = 65;
var CODE_UPPER_Z = 90;
var CODE_LOWER_A = 97;
var CODE_LOWER_Z = 122;
var CODE_LT = 60;
var CODE_GT = 62;
var CODE_SLASH = 47;
var CODE_DASH = 45;
var CODE_BANG = 33;
var CODE_EQ = 61;
var CODE_DQUOTE = 34;
var CODE_SQUOTE = 39;
var CODE_QUESTION = 63;
var STATE_DATA = 1;
var STATE_TAG_OPEN = 2;
var STATE_END_TAG_OPEN = 3;
var STATE_TAG_NAME = 4;
var STATE_BOGUS_COMMENT = 5;
var STATE_BEFORE_ATTRIBUTE_NAME = 6;
var STATE_AFTER_ATTRIBUTE_NAME = 7;
var STATE_ATTRIBUTE_NAME = 8;
var STATE_BEFORE_ATTRIBUTE_VALUE = 9;
var STATE_ATTRIBUTE_VALUE_DOUBLE_QUOTED = 10;
var STATE_ATTRIBUTE_VALUE_SINGLE_QUOTED = 11;
var STATE_ATTRIBUTE_VALUE_UNQUOTED = 12;
var STATE_AFTER_ATTRIBUTE_VALUE_QUOTED = 13;
var STATE_SELF_CLOSING_START_TAG = 14;
var STATE_COMMENT_START = 15;
var STATE_COMMENT_START_DASH = 16;
var STATE_COMMENT = 17;
var STATE_COMMENT_LESS_THAN_SIGN = 18;
var STATE_COMMENT_LESS_THAN_SIGN_BANG = 19;
var STATE_COMMENT_LESS_THAN_SIGN_BANG_DASH = 20;
var STATE_COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH = 21;
var STATE_COMMENT_END_DASH = 22;
var STATE_COMMENT_END = 23;
var STATE_COMMENT_END_BANG = 24;
var STATE_MARKUP_DECLARATION_OPEN = 25;
var STATE_RAWTEXT = 26;
var STATE_RAWTEXT_LESS_THAN_SIGN = 27;
var STATE_RAWTEXT_END_TAG_OPEN = 28;
var STATE_RAWTEXT_END_TAG_NAME = 29;
var SHOW_COMMENT = 128;
var SHOW_ELEMENT2 = 1;
var TYPE_COMMENT = 8;
var TYPE_ELEMENT = 1;
var NS_SVG = "http://www.w3.org/2000/svg";
var NS_XLINK = "http://www.w3.org/1999/xlink";
var NS_XML = "http://www.w3.org/XML/1998/namespace";
var NS_XMLNS = "http://www.w3.org/2000/xmlns/";
var svgAdjustAttributes = new Map([
  "attributeName",
  "attributeType",
  "baseFrequency",
  "baseProfile",
  "calcMode",
  "clipPathUnits",
  "diffuseConstant",
  "edgeMode",
  "filterUnits",
  "glyphRef",
  "gradientTransform",
  "gradientUnits",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lengthAdjust",
  "limitingConeAngle",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "maskContentUnits",
  "maskUnits",
  "numOctaves",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "preserveAspectRatio",
  "primitiveUnits",
  "refX",
  "refY",
  "repeatCount",
  "repeatDur",
  "requiredExtensions",
  "requiredFeatures",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "textLength",
  "viewBox",
  "viewTarget",
  "xChannelSelector",
  "yChannelSelector",
  "zoomAndPan"
].map((name2) => [name2.toLowerCase(), name2]));
var svgForeignAttributes = /* @__PURE__ */ new Map([
  ["xlink:actuate", NS_XLINK],
  ["xlink:arcrole", NS_XLINK],
  ["xlink:href", NS_XLINK],
  ["xlink:role", NS_XLINK],
  ["xlink:show", NS_XLINK],
  ["xlink:title", NS_XLINK],
  ["xlink:type", NS_XLINK],
  ["xml:lang", NS_XML],
  ["xml:space", NS_XML],
  ["xmlns", NS_XMLNS],
  ["xmlns:xlink", NS_XMLNS]
]);
function hypertext(render, postprocess, isSpecial2, processSpecial2) {
  return function({ raw: strings }) {
    let state = STATE_DATA;
    let string = "";
    let tagNameStart;
    let tagName;
    let attributeNameStart;
    let attributeNameEnd;
    let nodeFilter = 0;
    for (let j = 0, m = arguments.length; j < m; ++j) {
      const input = strings[j];
      if (j > 0) {
        const value = arguments[j];
        const valueIsSpecial = isSpecial2 && isSpecial2(value);
        switch (state) {
          case STATE_RAWTEXT: {
            if (value != null) {
              const text = `${value}`;
              if (isEscapableRawText(tagName)) {
                string += text.replace(/[<]/g, entity);
              } else if (new RegExp(`</${tagName}[\\s>/]`, "i").test(string.slice(-tagName.length - 2) + text)) {
                throw new Error("unsafe raw text");
              } else {
                string += text;
              }
            }
            break;
          }
          case STATE_DATA: {
            if (value == null) {
            } else if (valueIsSpecial || value instanceof Node || typeof value !== "string" && value[Symbol.iterator] || /(?:^|>)$/.test(strings[j - 1]) && /^(?:<|$)/.test(input)) {
              string += "<!--::" + j + "-->";
              nodeFilter |= SHOW_COMMENT;
            } else {
              string += `${value}`.replace(/[<&]/g, entity);
            }
            break;
          }
          case STATE_BEFORE_ATTRIBUTE_VALUE: {
            state = STATE_ATTRIBUTE_VALUE_UNQUOTED;
            let text;
            if (/^[\s>]/.test(input)) {
              if (!valueIsSpecial && (value == null || value === false)) {
                string = string.slice(0, attributeNameStart - strings[j - 1].length);
                break;
              }
              if (!valueIsSpecial && (value === true || (text = `${value}`) === "")) {
                string += "''";
                break;
              }
              const name2 = strings[j - 1].slice(attributeNameStart, attributeNameEnd);
              if (valueIsSpecial || name2 === "style" && isObjectLiteral(value) || typeof value === "function") {
                string += "::" + j;
                nodeFilter |= SHOW_ELEMENT2;
                break;
              }
            }
            if (text === void 0)
              text = `${value}`;
            if (text === "")
              throw new Error("unsafe unquoted empty string");
            string += text.replace(/^['"]|[\s>&]/g, entity);
            break;
          }
          case STATE_ATTRIBUTE_VALUE_UNQUOTED: {
            string += `${value}`.replace(/[\s>&]/g, entity);
            break;
          }
          case STATE_ATTRIBUTE_VALUE_SINGLE_QUOTED: {
            string += `${value}`.replace(/['&]/g, entity);
            break;
          }
          case STATE_ATTRIBUTE_VALUE_DOUBLE_QUOTED: {
            string += `${value}`.replace(/["&]/g, entity);
            break;
          }
          case STATE_BEFORE_ATTRIBUTE_NAME: {
            if (valueIsSpecial || isObjectLiteral(value)) {
              string += "::" + j + "=''";
              nodeFilter |= SHOW_ELEMENT2;
              break;
            }
            throw new Error("invalid binding");
          }
          case STATE_COMMENT:
            break;
          default:
            throw new Error("invalid binding");
        }
      }
      for (let i = 0, n = input.length; i < n; ++i) {
        const code = input.charCodeAt(i);
        switch (state) {
          case STATE_DATA: {
            if (code === CODE_LT) {
              state = STATE_TAG_OPEN;
            }
            break;
          }
          case STATE_TAG_OPEN: {
            if (code === CODE_BANG) {
              state = STATE_MARKUP_DECLARATION_OPEN;
            } else if (code === CODE_SLASH) {
              state = STATE_END_TAG_OPEN;
            } else if (isAsciiAlphaCode(code)) {
              tagNameStart = i, tagName = void 0;
              state = STATE_TAG_NAME, --i;
            } else if (code === CODE_QUESTION) {
              state = STATE_BOGUS_COMMENT, --i;
            } else {
              state = STATE_DATA, --i;
            }
            break;
          }
          case STATE_END_TAG_OPEN: {
            if (isAsciiAlphaCode(code)) {
              state = STATE_TAG_NAME, --i;
            } else if (code === CODE_GT) {
              state = STATE_DATA;
            } else {
              state = STATE_BOGUS_COMMENT, --i;
            }
            break;
          }
          case STATE_TAG_NAME: {
            if (isSpaceCode(code)) {
              state = STATE_BEFORE_ATTRIBUTE_NAME;
              tagName = lower(input, tagNameStart, i);
            } else if (code === CODE_SLASH) {
              state = STATE_SELF_CLOSING_START_TAG;
            } else if (code === CODE_GT) {
              tagName = lower(input, tagNameStart, i);
              state = isRawText(tagName) ? STATE_RAWTEXT : STATE_DATA;
            }
            break;
          }
          case STATE_BEFORE_ATTRIBUTE_NAME: {
            if (isSpaceCode(code)) {
            } else if (code === CODE_SLASH || code === CODE_GT) {
              state = STATE_AFTER_ATTRIBUTE_NAME, --i;
            } else if (code === CODE_EQ) {
              state = STATE_ATTRIBUTE_NAME;
              attributeNameStart = i + 1, attributeNameEnd = void 0;
            } else {
              state = STATE_ATTRIBUTE_NAME, --i;
              attributeNameStart = i + 1, attributeNameEnd = void 0;
            }
            break;
          }
          case STATE_ATTRIBUTE_NAME: {
            if (isSpaceCode(code) || code === CODE_SLASH || code === CODE_GT) {
              state = STATE_AFTER_ATTRIBUTE_NAME, --i;
              attributeNameEnd = i;
            } else if (code === CODE_EQ) {
              state = STATE_BEFORE_ATTRIBUTE_VALUE;
              attributeNameEnd = i;
            }
            break;
          }
          case STATE_AFTER_ATTRIBUTE_NAME: {
            if (isSpaceCode(code)) {
            } else if (code === CODE_SLASH) {
              state = STATE_SELF_CLOSING_START_TAG;
            } else if (code === CODE_EQ) {
              state = STATE_BEFORE_ATTRIBUTE_VALUE;
            } else if (code === CODE_GT) {
              state = isRawText(tagName) ? STATE_RAWTEXT : STATE_DATA;
            } else {
              state = STATE_ATTRIBUTE_NAME, --i;
              attributeNameStart = i + 1, attributeNameEnd = void 0;
            }
            break;
          }
          case STATE_BEFORE_ATTRIBUTE_VALUE: {
            if (isSpaceCode(code)) {
            } else if (code === CODE_DQUOTE) {
              state = STATE_ATTRIBUTE_VALUE_DOUBLE_QUOTED;
            } else if (code === CODE_SQUOTE) {
              state = STATE_ATTRIBUTE_VALUE_SINGLE_QUOTED;
            } else if (code === CODE_GT) {
              state = isRawText(tagName) ? STATE_RAWTEXT : STATE_DATA;
            } else {
              state = STATE_ATTRIBUTE_VALUE_UNQUOTED, --i;
            }
            break;
          }
          case STATE_ATTRIBUTE_VALUE_DOUBLE_QUOTED: {
            if (code === CODE_DQUOTE) {
              state = STATE_AFTER_ATTRIBUTE_VALUE_QUOTED;
            }
            break;
          }
          case STATE_ATTRIBUTE_VALUE_SINGLE_QUOTED: {
            if (code === CODE_SQUOTE) {
              state = STATE_AFTER_ATTRIBUTE_VALUE_QUOTED;
            }
            break;
          }
          case STATE_ATTRIBUTE_VALUE_UNQUOTED: {
            if (isSpaceCode(code)) {
              state = STATE_BEFORE_ATTRIBUTE_NAME;
            } else if (code === CODE_GT) {
              state = isRawText(tagName) ? STATE_RAWTEXT : STATE_DATA;
            }
            break;
          }
          case STATE_AFTER_ATTRIBUTE_VALUE_QUOTED: {
            if (isSpaceCode(code)) {
              state = STATE_BEFORE_ATTRIBUTE_NAME;
            } else if (code === CODE_SLASH) {
              state = STATE_SELF_CLOSING_START_TAG;
            } else if (code === CODE_GT) {
              state = isRawText(tagName) ? STATE_RAWTEXT : STATE_DATA;
            } else {
              state = STATE_BEFORE_ATTRIBUTE_NAME, --i;
            }
            break;
          }
          case STATE_SELF_CLOSING_START_TAG: {
            if (code === CODE_GT) {
              state = STATE_DATA;
            } else {
              state = STATE_BEFORE_ATTRIBUTE_NAME, --i;
            }
            break;
          }
          case STATE_BOGUS_COMMENT: {
            if (code === CODE_GT) {
              state = STATE_DATA;
            }
            break;
          }
          case STATE_COMMENT_START: {
            if (code === CODE_DASH) {
              state = STATE_COMMENT_START_DASH;
            } else if (code === CODE_GT) {
              state = STATE_DATA;
            } else {
              state = STATE_COMMENT, --i;
            }
            break;
          }
          case STATE_COMMENT_START_DASH: {
            if (code === CODE_DASH) {
              state = STATE_COMMENT_END;
            } else if (code === CODE_GT) {
              state = STATE_DATA;
            } else {
              state = STATE_COMMENT, --i;
            }
            break;
          }
          case STATE_COMMENT: {
            if (code === CODE_LT) {
              state = STATE_COMMENT_LESS_THAN_SIGN;
            } else if (code === CODE_DASH) {
              state = STATE_COMMENT_END_DASH;
            }
            break;
          }
          case STATE_COMMENT_LESS_THAN_SIGN: {
            if (code === CODE_BANG) {
              state = STATE_COMMENT_LESS_THAN_SIGN_BANG;
            } else if (code !== CODE_LT) {
              state = STATE_COMMENT, --i;
            }
            break;
          }
          case STATE_COMMENT_LESS_THAN_SIGN_BANG: {
            if (code === CODE_DASH) {
              state = STATE_COMMENT_LESS_THAN_SIGN_BANG_DASH;
            } else {
              state = STATE_COMMENT, --i;
            }
            break;
          }
          case STATE_COMMENT_LESS_THAN_SIGN_BANG_DASH: {
            if (code === CODE_DASH) {
              state = STATE_COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH;
            } else {
              state = STATE_COMMENT_END, --i;
            }
            break;
          }
          case STATE_COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH: {
            state = STATE_COMMENT_END, --i;
            break;
          }
          case STATE_COMMENT_END_DASH: {
            if (code === CODE_DASH) {
              state = STATE_COMMENT_END;
            } else {
              state = STATE_COMMENT, --i;
            }
            break;
          }
          case STATE_COMMENT_END: {
            if (code === CODE_GT) {
              state = STATE_DATA;
            } else if (code === CODE_BANG) {
              state = STATE_COMMENT_END_BANG;
            } else if (code !== CODE_DASH) {
              state = STATE_COMMENT, --i;
            }
            break;
          }
          case STATE_COMMENT_END_BANG: {
            if (code === CODE_DASH) {
              state = STATE_COMMENT_END_DASH;
            } else if (code === CODE_GT) {
              state = STATE_DATA;
            } else {
              state = STATE_COMMENT, --i;
            }
            break;
          }
          case STATE_MARKUP_DECLARATION_OPEN: {
            if (code === CODE_DASH && input.charCodeAt(i + 1) === CODE_DASH) {
              state = STATE_COMMENT_START, ++i;
            } else {
              state = STATE_BOGUS_COMMENT, --i;
            }
            break;
          }
          case STATE_RAWTEXT: {
            if (code === CODE_LT) {
              state = STATE_RAWTEXT_LESS_THAN_SIGN;
            }
            break;
          }
          case STATE_RAWTEXT_LESS_THAN_SIGN: {
            if (code === CODE_SLASH) {
              state = STATE_RAWTEXT_END_TAG_OPEN;
            } else {
              state = STATE_RAWTEXT, --i;
            }
            break;
          }
          case STATE_RAWTEXT_END_TAG_OPEN: {
            if (isAsciiAlphaCode(code)) {
              tagNameStart = i;
              state = STATE_RAWTEXT_END_TAG_NAME, --i;
            } else {
              state = STATE_RAWTEXT, --i;
            }
            break;
          }
          case STATE_RAWTEXT_END_TAG_NAME: {
            if (isSpaceCode(code) && tagName === lower(input, tagNameStart, i)) {
              state = STATE_BEFORE_ATTRIBUTE_NAME;
            } else if (code === CODE_SLASH && tagName === lower(input, tagNameStart, i)) {
              state = STATE_SELF_CLOSING_START_TAG;
            } else if (code === CODE_GT && tagName === lower(input, tagNameStart, i)) {
              state = STATE_DATA;
            } else if (!isAsciiAlphaCode(code)) {
              state = STATE_RAWTEXT, --i;
            }
            break;
          }
          default: {
            state = void 0;
            break;
          }
        }
      }
      string += input;
    }
    const root = render(string);
    const walker = document.createTreeWalker(root, nodeFilter, null, false);
    const removeNodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      switch (node.nodeType) {
        case TYPE_ELEMENT: {
          const attributes = node.attributes;
          for (let i = 0, n = attributes.length; i < n; ++i) {
            const { name: name2, value: currentValue } = attributes[i];
            if (/^::/.test(name2)) {
              const value = arguments[+name2.slice(2)];
              removeAttribute(node, name2), --i, --n;
              if (isSpecial2 && isSpecial2(value))
                processSpecial2(processAttrs, node, name2, value, root);
              else
                processAttrs(node, name2, value);
            } else if (/^::/.test(currentValue)) {
              const value = arguments[+currentValue.slice(2)];
              removeAttribute(node, name2), --i, --n;
              if (isSpecial2 && isSpecial2(value))
                processSpecial2(processAttr, node, name2, value, root);
              else
                processAttr(node, name2, value);
            }
          }
          break;
        }
        case TYPE_COMMENT: {
          if (/^::/.test(node.data)) {
            const parent = node.parentNode;
            const value = arguments[+node.data.slice(2)];
            if (isSpecial2 && isSpecial2(value))
              processSpecial2(processChildren, node, name, value, root);
            else
              processChildren(node, parent, value);
            removeNodes.push(node);
          }
          break;
        }
      }
    }
    for (const node of removeNodes) {
      node.parentNode.removeChild(node);
    }
    return postprocess(root);
  };
}
function processAttrs(node, name2, value) {
  for (const key2 in value) {
    const subvalue2 = value[key2];
    if (subvalue2 == null || subvalue2 === false) {
    } else if (typeof subvalue2 === "function") {
      node[key2] = subvalue2;
    } else if (key2 === "style" && isObjectLiteral(subvalue2)) {
      setStyles(node[key2], subvalue2);
    } else {
      setAttribute(node, key2, subvalue2 === true ? "" : subvalue2);
    }
  }
}
function processAttr(node, name2, value) {
  if (typeof value === "function") {
    node[name2] = value;
  } else {
    setStyles(node[name2], value);
  }
}
function processChildren(node, parent, value) {
  if (value instanceof Node) {
    parent.insertBefore(value, node);
  } else if (typeof value !== "string" && value[Symbol.iterator]) {
    if (value instanceof NodeList || value instanceof HTMLCollection) {
      for (let i = value.length - 1, r = node; i >= 0; --i) {
        r = parent.insertBefore(value[i], r);
      }
    } else {
      for (const subvalue2 of value) {
        if (subvalue2 == null)
          continue;
        parent.insertBefore(subvalue2 instanceof Node ? subvalue2 : document.createTextNode(subvalue2), node);
      }
    }
  } else {
    parent.insertBefore(document.createTextNode(value), node);
  }
}
function entity(character) {
  return `&#${character.charCodeAt(0).toString()};`;
}
function isAsciiAlphaCode(code) {
  return CODE_UPPER_A <= code && code <= CODE_UPPER_Z || CODE_LOWER_A <= code && code <= CODE_LOWER_Z;
}
function isSpaceCode(code) {
  return code === CODE_TAB || code === CODE_LF || code === CODE_FF || code === CODE_SPACE || code === CODE_CR;
}
function isObjectLiteral(value) {
  return value && value.toString === Object.prototype.toString;
}
function isRawText(tagName) {
  return tagName === "script" || tagName === "style" || isEscapableRawText(tagName);
}
function isEscapableRawText(tagName) {
  return tagName === "textarea" || tagName === "title";
}
function lower(input, start, end) {
  return input.slice(start, end).toLowerCase();
}
function setAttribute(node, name2, value) {
  if (node.namespaceURI === NS_SVG) {
    name2 = name2.toLowerCase();
    name2 = svgAdjustAttributes.get(name2) || name2;
    if (svgForeignAttributes.has(name2)) {
      node.setAttributeNS(svgForeignAttributes.get(name2), name2, value);
      return;
    }
  }
  node.setAttribute(name2, value);
}
function removeAttribute(node, name2) {
  if (node.namespaceURI === NS_SVG) {
    name2 = name2.toLowerCase();
    name2 = svgAdjustAttributes.get(name2) || name2;
    if (svgForeignAttributes.has(name2)) {
      node.removeAttributeNS(svgForeignAttributes.get(name2), name2);
      return;
    }
  }
  node.removeAttribute(name2);
}
function setStyles(style, values) {
  for (const name2 in values) {
    const value = values[name2];
    if (name2.startsWith("--"))
      style.setProperty(name2, value);
    else
      style[name2] = value;
  }
}

// index.js
var html2 = hypertext(
  renderHtml,
  (fragment) => {
    const cleanup = effectsCleanup(fragment.removeEffects);
    if (fragment.firstChild === null)
      return null;
    if (fragment.firstChild === fragment.lastChild && !isComment(fragment.firstChild)) {
      return onUnmount(fragment.removeChild(fragment.firstChild), cleanup);
    }
    const span = document.createElement("span");
    span.appendChild(fragment);
    return onUnmount(span, cleanup);
  },
  isSpecial,
  processSpecial
);
var svg2 = hypertext(
  renderSvg,
  (g) => {
    const cleanup = effectsCleanup(g.removeEffects);
    if (g.firstChild === null)
      return null;
    if (g.firstChild === g.lastChild && !isComment(g.firstChild)) {
      return onUnmount(g.removeChild(g.firstChild), cleanup);
    }
    return onUnmount(g, cleanup);
  },
  isSpecial,
  processSpecial
);
function effectsCleanup(removeEffects) {
  if (removeEffects && removeEffects.length > 0) {
    return () => {
      for (const dispose of removeEffects)
        dispose();
    };
  }
  return null;
}
function isComment(node) {
  return node.nodeType === 8;
}
function processSpecial(process, node, name2, value, fragment) {
  const removeEffects = fragment.removeEffects ??= [];
  switch (process) {
    case processAttr:
      value = { [name2]: value };
    case processAttrs:
      if (isSignal(value)) {
        let prev = value.peek();
        removeEffects.push(
          effect(() => {
            const v = value.value;
            if (!isObjectLiteral(v))
              throw new Error("invalid binding");
            removeStaleAttrs(node, prev, v);
            processAttrs(node, name2, v);
            prev = v;
          })
        );
      } else {
        const staticAttrs = {};
        for (const attr in value) {
          const attrvalue = value[attr];
          if (isSignal(attrvalue)) {
            let prev = attrvalue.peek();
            removeEffects.push(
              effect(() => {
                const v = attrvalue.value;
                if (attr === "value")
                  node.value = v;
                else {
                  removeStaleAttr(node, attr, prev, v);
                  processAttrs(node, name2, { [attr]: v });
                  prev = v;
                }
              })
            );
          } else if (isStyleObjectLiteral(attr, attrvalue)) {
            const staticStyleAttrs = staticAttrs.style = {};
            const style = value[attr];
            for (const prop in style) {
              const propvalue = style[prop];
              if (isSignal(propvalue)) {
                removeEffects.push(
                  effect(() => {
                    const v = propvalue.value;
                    processAttrs(node, name2, { style: { [prop]: v } });
                  })
                );
              } else {
                staticStyleAttrs[prop] = propvalue;
              }
            }
          } else {
            staticAttrs[key] = subvalue;
          }
          processAttrs(node, name2, staticAttrs);
        }
      }
      break;
    case processChildren:
      if (isSignal(value)) {
        const insertionMarker = node.parentNode.insertBefore(document.createComment(" "), node);
        const fragment2 = document.createDocumentFragment();
        const removeChildren = [];
        removeEffects.push(
          effect(() => {
            for (const child of removeChildren)
              child.parentNode.removeChild(child);
            processChildren(null, fragment2, value.value ?? []);
            removeChildren.length = 0;
            for (const child of fragment2.childNodes)
              removeChildren.push(child);
            insertionMarker.parentNode.insertBefore(fragment2, insertionMarker);
          })
        );
      } else {
        processChildren(node, node.parentNode, value);
      }
      break;
  }
}
function isSpecial(value) {
  if (isSignal(value))
    return true;
  if (isObjectLiteral(value)) {
    for (const key2 in value) {
      const subvalue2 = value[key2];
      if (isSignal(subvalue2))
        return true;
      if (isStyleObjectLiteral(key2, subvalue2)) {
        for (const styleprop in subvalue2)
          if (isSignal(subvalue2[styleprop]))
            return true;
      }
    }
  }
  return false;
}
function removeStaleAttrs(node, prev, value) {
  for (const key2 in prev)
    removeStaleAttr(node, key2, prev[key2], value[key2]);
}
function removeStaleAttr(node, key2, prev, value) {
  if (value == null || value === false) {
    if (typeof prev === "function" || key2 === "value")
      delete node[key2];
    else if (isStyleObjectLiteral(key2, prev))
      setStyles(node.style, { style: null });
    else
      removeAttribute(node, key2);
  } else if (key2 === "style") {
    const prevIsLiteral = isObjectLiteral(prev[key2]);
    const valueIsLiteral = isObjectLiteral(value[key2]);
    if (prevIsLiteral && valueIsLiteral)
      removeStaleStyles(node[key2], prev[key2], value[key2]);
    else if (prevIsLiteral)
      removeStaleStyles(node[key2], prev, {});
    else
      removeAttribute(node, key2);
  }
}
function removeStaleStyles(style, prev, value) {
  for (const key2 in prev)
    if (!(key2 in value))
      setStyles(style, { [key2]: null });
}
function mountMutationCallback(mutationList) {
  for (const mutation of mutationList) {
    for (const node of mutation.removedNodes) {
      if (node instanceof HTMLElement || node instanceof DocumentFragment) {
        const walker = document.createTreeWalker(node, SHOW_ELEMENT, null, false);
        if (node.onunmount)
          node.onunmount();
        while (walker.nextNode()) {
          const node2 = walker.currentNode;
          if (node2.onunmount)
            node2.onunmount();
        }
      }
    }
  }
}
function onUnmount(node, cleanup) {
  console.assert(!(node instanceof DocumentFragment));
  if (!cleanup)
    return node;
  const current = node.onunmount;
  if (current === void 0) {
    node.onunmount = cleanup;
  } else {
    node.onunmount = () => {
      current();
      cleanup();
    };
  }
  return node;
}
function mount(component, parent, insertBefore) {
  return batch(() => {
    const elem = component();
    if (elem === null)
      return () => null;
    const observer = new MutationObserver(mountMutationCallback);
    observer.observe(parent, { childList: true, subtree: true });
    if (insertBefore)
      parent.insertBefore(elem, insertBefore);
    else
      parent.appendChild(elem);
    return () => {
      parent.removeChild(elem);
      mutationCallback(observer.takeRecords());
      observer.disconnect();
    };
  });
}
function isSignal(value) {
  return value instanceof Signal;
}
function isStyleObjectLiteral(key2, value) {
  return key2 === "style" && isObjectLiteral(value);
}
function customElement(component, shadowMode, observedAttributes) {
  return class extends HTMLElement {
    connectedCallback() {
      const self = this;
      let root = shadowMode ? this.attachShadow({ mode: shadowMode }) : this;
      this.attributeSignals = {};
      for (name of observedAttributes) {
        this.attributeSignals[name] = signal(self.getAttribute(name));
      }
      const attrProxy = new Proxy(this.attributeSignals, {
        get(target, prop) {
          if (prop in target)
            return target[prop];
          if (typeof prop === "symbol")
            return void 0;
          return self.getAttribute(prop);
        }
      });
      this.dispose = mount(() => component(attrProxy), root);
      this.dataset.rendered = true;
    }
    attributeChangedCallback(name2, oldValue, newValue) {
      this.attributeSignals[name2].value = newValue;
    }
    disconnectedCallback() {
      if (this.dispose)
        this.dispose();
    }
    static get observedAttributes() {
      return observedAttributes;
    }
  };
}
function defineCustomElement(name2, component, { shadowMode, observedAttributes = [] } = {}) {
  customElements.define(name2, customElement(component, shadowMode, observedAttributes));
}
function recomputed(reduce, initialValue) {
  let value = initialValue;
  const changed = computed(() => {
    value = reduce(value);
    return NaN;
  });
  return {
    get value() {
      changed.value;
      return value;
    }
  };
}
var p = (...args) => (console.log(...args), args[args.length - 1]);
export {
  batch,
  computed,
  customElement,
  defineCustomElement,
  effect,
  html2 as html,
  mount,
  onUnmount,
  p,
  recomputed,
  signal,
  svg2 as svg
};
