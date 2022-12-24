import { signal, computed, effect, batch, Signal } from './signals-core-1.2.1.js';
export { signal, computed, effect, batch } from './signals-core-1.2.1.js';
import {
  hypertext,
  processAttr,
  processAttrs,
  processChildren,
  removeAttribute,
  isObjectLiteral,
  setStyles,
  renderHtml,
  renderSvg,
} from './htl-special-0.3.1.js';

export const html = hypertext(
  renderHtml,
  (fragment) => {
    const cleanup = effectsCleanup(fragment.removeEffects);
    if (fragment.firstChild === null) return null;
    // a single comment node indicates the presence of reactive children, which need
    // to maintain a non-null parent node for updates (which use parent.insertBefore)
    if (fragment.firstChild === fragment.lastChild && !isComment(fragment.firstChild)) {
      return onUnmount(fragment.removeChild(fragment.firstChild), cleanup);
    }
    const span = document.createElement('span');
    span.appendChild(fragment);
    return onUnmount(span, cleanup);
  },
  isSpecial,
  processSpecial,
);

export const svg = hypertext(
  renderSvg,
  (g) => {
    const cleanup = effectsCleanup(g.removeEffects);
    if (g.firstChild === null) return null;
    if (g.firstChild === g.lastChild && !isComment(g.firstChild)) {
      return onUnmount(g.removeChild(g.firstChild), cleanup);
    }
    return onUnmount(g, cleanup);
  },
  isSpecial,
  processSpecial,
);

function effectsCleanup(removeEffects) {
  if (removeEffects && removeEffects.length > 0) {
    return () => {
      for (const dispose of removeEffects) dispose();
    };
  }
  return null;
}

function isComment(node) {
  return node.nodeType === 8 /* TYPE_COMMENT */;
}

function processSpecial(process, node, name, value, fragment) {
  const removeEffects = (fragment.removeEffects ??= []);
  switch (process) {
    // fall through, treating this as a case of processAttrs.
    case processAttr:
      value = { [name]: value };
      // fallthrough
    case processAttrs:
      // cases:
      // - signal w/ attrs object
      // - attrs object w/ signal value(s)
      // - attr object w/ style: object w/ signal value(s)
      if (isSignal(value)) {
        // value is a signal w/ attrs object
        let prev = value.peek();
        removeEffects.push(
          effect(() => {
            const v = value.value;
            if (!isObjectLiteral(v)) throw new Error('invalid binding');
            removeStaleAttrs(node, prev, v);
            processAttrs(node, name, v);
            prev = v;
          }),
        );
      } else {
        // set all non-dynamic attributes on initialization
        const staticAttrs = {};
        for (const attr in value) {
          const attrvalue = value[attr];
          if (isSignal(attrvalue)) {
            // value is an attrs object w/ potential signal value(s)
            let prev = attrvalue.peek();
            removeEffects.push(
              effect(() => {
                const v = attrvalue.value;
                // treat the value attribute specially to allow controlling <input> values
                if (attr === 'value') node.value = v;
                else {
                  removeStaleAttr(node, attr, prev, v);
                  processAttrs(node, name, { [attr]: v });
                  prev = v;
                }
              }),
            );
          } else if (isStyleObjectLiteral(attr, attrvalue)) {
            // value is an style attrs object w/ potential signal value(s)
            const staticStyleAttrs = (staticAttrs.style = {});
            const style = value[attr];
            for (const prop in style) {
              const propvalue = style[prop];
              if (isSignal(propvalue)) {
                removeEffects.push(
                  effect(() => {
                    const v = propvalue.value;
                    processAttrs(node, name, { style: { [prop]: v } });
                  }),
                );
              } else {
                staticStyleAttrs[prop] = propvalue;
              }
            }
          } else {
            // attribute is neither { key: signal } nor { style: obj }, so
            // it must be a static { key: subvalue } attribute.
            staticAttrs[key] = subvalue;
          }
          processAttrs(node, name, staticAttrs);
        }
      }
      break;
    case processChildren:
      if (isSignal(value)) {
        // process reactive children by appending them into a document fragment so that we
        // can queue their removal for the next update.
        const insertionMarker = node.parentNode.insertBefore(document.createComment(' '), node);
        const fragment = document.createDocumentFragment();
        const removeChildren = [];
        removeEffects.push(
          effect(() => {
            for (const child of removeChildren) child.parentNode.removeChild(child);
            processChildren(null, fragment, value.value ?? []);
            removeChildren.length = 0;
            for (const child of fragment.childNodes) removeChildren.push(child);
            insertionMarker.parentNode.insertBefore(fragment, insertionMarker);
          }),
        );
      } else {
        processChildren(node, node.parentNode, value);
      }
      break;
  }
}

function isSpecial(value) {
  // this function may return a false positive since it lacks the context of where
  // this value is being interpolated. This can result in special values being interpolated
  // into non-special places, leading to a lack of reactivity. For example,
  // html`<div style="color: ${colorSignal}">Hello` will not reactively update. The reactive
  // alternative is html`<div style=${{color: colorSignal}}>Hello` or, if a string is desired,
  // html`<div style=${computed(() => `color: ${colorSignal}`)}>Hello`.
  if (isSignal(value)) return true;
  if (isObjectLiteral(value)) {
    for (const key in value) {
      const subvalue = value[key];
      if (isSignal(subvalue)) return true;
      if (isStyleObjectLiteral(key, subvalue)) {
        for (const styleprop in subvalue) if (isSignal(subvalue[styleprop])) return true;
      }
    }
  }
  return false;
}

function removeStaleAttrs(node, prev, value) {
  for (const key in prev) removeStaleAttr(node, key, prev[key], value[key]);
}

function removeStaleAttr(node, key, prev, value) {
  if (value == null || value === false) {
    if (typeof prev === 'function' || key === 'value') delete node[key];
    else if (isStyleObjectLiteral(key, prev)) setStyles(node.style, { style: null });
    else removeAttribute(node, key);
  } else if (key === 'style') {
    const prevIsLiteral = isObjectLiteral(prev[key]);
    const valueIsLiteral = isObjectLiteral(value[key]);
    if (prevIsLiteral && valueIsLiteral) removeStaleStyles(node[key], prev[key], value[key]);
    // handle the case where the style changes between being an object and a string/non-object
    else if (prevIsLiteral) removeStaleStyles(node[key], prev, {});
    else removeAttribute(node, key);
  }
}

function removeStaleStyles(style, prev, value) {
  for (const key in prev) if (!(key in value)) setStyles(style, { [key]: null });
}

function mountMutationCallback(mutationList) {
  for (const mutation of mutationList) {
    for (const node of mutation.removedNodes) {
      // Walk the removed node and call all cleanup functions. Since we allow specifying
      // custom cleanup functions as attributes, and because literals may be nested,
      // there can be cleanup functions anywhere below the child node that was removed.
      if (node instanceof HTMLElement || node instanceof DocumentFragment) {
        const walker = document.createTreeWalker(node, SHOW_ELEMENT, null, false);
        if (node.onunmount) node.onunmount();
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.onunmount) node.onunmount();
        }
      }
    }
  }
}

// Add a cleanup handler to the node and return the node. Cleanup handlers
// will be called in the order they were defined.
export function onUnmount(node, cleanup) {
  console.assert(!(node instanceof DocumentFragment));
  if (!cleanup) return node;
  const current = node.onunmount;
  if (current === undefined) {
    node.onunmount = cleanup;
  } else {
    node.onunmount = () => {
      current();
      cleanup();
    };
  }
  return node;
}

// Instantiate and mount the component to the provided parent DOM node and return
// a disposal function that will run cleanup functions and detatch the component
// node from its parent.
export function mount(component, parent, insertBefore) {
  // Using batch ensures that signal updates that happen during component initialization
  // are processed after the mutation observer is ready .If a signal value is updated
  // multiple times during component initialization, cleaning up their the resources of
  // intermediate values is the responsibility of the component.
  return batch(() => {
    const elem = component();
    if (elem === null) return () => null;
    // To avoid edge cases, we use a separate MutationObserver for each mount point.
    // https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe#reusing_mutationobservers
    const observer = new MutationObserver(mountMutationCallback);
    observer.observe(parent, { childList: true, subtree: true });
    if (insertBefore) parent.insertBefore(elem, insertBefore);
    else parent.appendChild(elem);
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

function isStyleObjectLiteral(key, value) {
  return key === 'style' && isObjectLiteral(value);
}

// Creates custom elements from components, designed for lightweight authoring of reactive documents.
// The component is passed a simple Proxy as props, which returns signals for observed attributes and
// element.getAttribute(prop) otherwise. The Proxy does not currently support being used with
// {...props} spread syntax or other behaviors beyond plain property access.
export function customElement(component, shadowMode, observedAttributes) {
  return class extends HTMLElement {
    connectedCallback() {
      const self = this;
      let root = shadowMode ? this.attachShadow({ mode: shadowMode }) : this;

      // Create a signal for every observed attribute
      this.attributeSignals = {};
      for (name of observedAttributes) {
        this.attributeSignals[name] = signal(self.getAttribute(name));
      }

      // Create a Proxy that delegates non-observed attributes to property access
      const attrProxy = new Proxy(this.attributeSignals, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop === 'symbol') return undefined;
          return self.getAttribute(prop);
        },
      });

      // Mount and store the disposal function
      this.dispose = mount(() => component(attrProxy), root);

      // Add an attribute enabling CSS-based loading indicators that display before the component mounts.
      // The selector looks for elements with no children that have not yet been rendered (ie. HTML has
      // loaded but initial JS has not run):
      // body :empty:not([data-rendered])::before { content: "…"; }
      this.dataset.rendered = true;
    }

    attributeChangedCallback(name, oldValue, newValue) {
      // Update the signal
      this.attributeSignals[name].value = newValue;
    }

    disconnectedCallback() {
      if (this.dispose) this.dispose();
      // Don't delete the rendered attribute since the rendered content is still present.
    }

    static get observedAttributes() {
      return observedAttributes;
    }

    // adoptedCallback { }
  };
}

export function defineCustomElement(name, component, { shadowMode, observedAttributes = [] } = {}) {
  customElements.define(name, customElement(component, shadowMode, observedAttributes));
}

// Creates something akin to an un-cached computed signal,
// which behaves as if its value is never equal to its
// previous value (it will always fire when a dependency is
// updated).
// First argument: compute function f(value); signal accesses are tracked
// Second argument: initial value.
// This is useful for maintaining a signal containing a
// mutable value that updates in response to signals,
// such as a d3 scale which updates its domain and range
// in response to signals (but maintains object identity).
// Example:
// {
//   // Here's how to have a "reducer" pattern
//   // where a mutable d3 scale can be mutated
//   // in response to events (eg. set the domain)
//   // and anything that calls scale() will re-run
//   // when the scale is modified, even though it's
//   // still the same object
//   const x = signal(0);
//   const y = signal(1);
//   const scale = recomputed(
//     (s) => {
//       s.x = x.value;
//       s.y = y.value;
//       return s;
//     },
//     { x: 0, y: 0 }
//   );
//   let render = effect(() => {
//     const s = scale.value;
//     // const s = _scale;
//     console.log("rendering with s.x", s.x, "s.y", s.y);
//   });
//   x.value = 2;
//   x.value = 2;
//   y.value = 3;
//   y.value = 3;
// }
export function recomputed(reduce, initialValue) {
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

export const p = (...args) => (console.log(...args), args[args.length - 1]);
