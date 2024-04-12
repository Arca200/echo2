const ShapeFlags = {
  ELEMENT: 1,
  STATEFUL_COMPONENT: 1 << 1,
  TEXT_CHILD: 1 << 2,
  ARRAY_CHILD: 1 << 3,
};

function isObject (param) {
  return Object.prototype.toString.call(param) === '[object Object]'
}

function isString (param) {
  return Object.prototype.toString.call(param) === '[object String]'
}

function isArray (param) {
  return Object.prototype.toString.call(param) === '[object Array]'
}

function isFunction (param) {
  return Object.prototype.toString.call(param) === '[object Function]'
}

function hasOwnProperty (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isOn (key) {
  return /^on[A-Za-z]+/.test(key)
}

const Fragment = Symbol('Fragment');
const Text = Symbol('Text');

function createVNode (type, props, children) {
  const vnode = {
    type,
    props,
    children,
    el: undefined,
    isVNode: true,
    shapeFlag: getShapeFlag(type)
  };
  if (isString(vnode.children)) {
    vnode.shapeFlag = vnode.shapeFlag | ShapeFlags.TEXT_CHILD;
  } else if (isArray(vnode.children)) {
    vnode.shapeFlag = vnode.shapeFlag | ShapeFlags.ARRAY_CHILD;
  }
  return vnode
}

function getShapeFlag (type) {
  if (isObject(type)) {
    return ShapeFlags.STATEFUL_COMPONENT
  } else if (isString(type)) {
    return ShapeFlags.ELEMENT
  }
}

function createTextVNode (string) {
  return createVNode(Text, {}, string)
}

function mountElement (vnode, container) {
  vnode.el = document.createElement(vnode.type);

  const { shapeFlag, children, props, el } = vnode;
  for (const elKey in props) {
    const val = props[elKey];
    if (isOn(elKey)) {
      const event = elKey.slice(2).toLowerCase();
      el.addEventListener(event, val);
    } else {
      el.setAttribute(elKey, val);
    }
  }
  if (shapeFlag & ShapeFlags.TEXT_CHILD) {
    el.textContent = children;
  } else if (shapeFlag & ShapeFlags.ARRAY_CHILD) {
    children.forEach(child => {
      patch(child, el);
    });
  }

  if (isString(container)) {
    document.querySelector(container).appendChild(el);
  } else {
    container.appendChild(el);
  }
}

let reactivrEffectStack = [];
window.currentReactiveEffect = undefined;

function createReactiveEffect (fn, scheduler) {
  const reactiveEffect = function () {
    if (!reactivrEffectStack.includes(reactiveEffect)) {
      try {
        reactivrEffectStack.push(reactiveEffect);
        currentReactiveEffect = reactiveEffect;
        fn();
      } finally {
        reactivrEffectStack.pop();
        currentReactiveEffect = reactivrEffectStack[reactivrEffectStack.length - 1];
      }
    }
  };
  reactiveEffect.scheduler = scheduler;
  return reactiveEffect
}

function effect (fn, option = { lazy: false, scheduler: undefined }) {
  const reactiveEffect = createReactiveEffect(fn, option.scheduler);
  if (option.lazy !== true) {
    reactiveEffect();
  }
}

const targetMap = new WeakMap();

function Track (target, key) {
  if (!currentReactiveEffect) {
    return
  }
  let depMap = targetMap.get(target);
  if (!depMap) {
    targetMap.set(target, (depMap = new Map));
  }
  let dep = depMap.get(key);
  if (!dep) {
    depMap.set(key, (dep = new Set));
  }
  if (!dep.has(currentReactiveEffect)) {
    dep.add(currentReactiveEffect);
  }
}

function Trigger (target, key) {
  let depMap = targetMap.get(target);
  if (!depMap) {
    return
  }
  const effectSet = new Set();
  depMap.get(key).forEach(effect => {
    effectSet.add(effect);
  });
  effectSet.forEach(effect => {
    if (effect.scheduler) {
      effect.scheduler();
    } else {
      effect();
    }
  });
}

function getCreator (isShallow = false, isReadOnly = false) {
  return (target, key) => {
    let res = Reflect.get(target, key);
    if (!isReadOnly) {
      //TODO 收集
      Track(target, key);
    }
    if (!isShallow && isObject(res)) {
      //TODO 将res转变成响应式对象
      return isReadOnly ? readonly(res) : reactive(res)
    } else {
      return res
    }
  }
}

function setCreator (isReadOnly = false) {
  return (target, key, val) => {
    if (isReadOnly) {
      throw new Error('这是一个只读的对象')
    }
    Reflect.set(target, key, val);
    //TODO 触发依赖
    Trigger(target, key);
  }
}

const reactiveHandler = {
  get: getCreator(),
  set: setCreator()
};
const readOnlyHandler = {
  get: getCreator(false, true),
  set: setCreator(true)
};
const shallowReadOnlyHandler = {
  get: getCreator(true, true),
  set: setCreator(true)
};

// TODO 为什么要设计两个Map来存储呢?
const reactiveMap = new WeakMap();
const readOnlyMap = new WeakMap();

function createReactiveObject (target, isReadOnly, handler) {
  if (isObject(target) !== true) {
    throw new Error('只能将对象转化为响应式对象')
  }
  const proxyMap = isReadOnly ? readOnlyMap : reactiveMap;
  let proxy = proxyMap.get(target);
  if (proxy) {
    return proxy
  } else {
    proxy = new Proxy(target, handler);
    proxyMap.set(target, proxy);
    return proxy
  }
}

function reactive (target) {
  return createReactiveObject(target, false, reactiveHandler)
}

function readonly (target) {
  return createReactiveObject(target, true, readOnlyHandler)
}

function shallowReadonly (target) {
  return createReactiveObject(target, true, shallowReadOnlyHandler)
}

function initComponentProps (instance, props) {
  instance.props = props || {};
}

const publicPropertiesMap = {
  $el: (i) => i.vnode.el,
  $slots: (i) => i.slots
};
const instanceProxyHandler = {
  get ({ _: instance }, key) {
    const { setupState, props } = instance;
    if (hasOwnProperty(setupState, key)) {
      return setupState[key]
    } else if (hasOwnProperty(props, key)) {
      return props[key]
    }
    const publicGetter = publicPropertiesMap[key];
    if (publicGetter) {
      return publicGetter(instance)
    }
  }
};

function initComponentSlots (instance, children) {
  if (!children) {
    return
  }
  const slots = {};
  for (let key in children) {
    const value = children[key];
    if (isArray(value)) {
      slots[key] = value;
    } else if (isFunction(value)) {
      slots[key] = value;
    } else {
      slots[key] = [value];
    }
  }
  instance.slots = slots;
}

function renderSlots (slots, name, prop) {
  const slot = slots[name];
  if (isFunction(slot)) {
    return h(Fragment, {}, [slot(prop)])
  } else {
    return h(Fragment, {}, slot)
  }
}

let currentInstance = null;

function getCurrentInstance () {
  return currentInstance
}

function setCurrentInstance (instance) {
  currentInstance = instance;
}

function setupComponent (componentInstance) {
  initComponentSlots(componentInstance, componentInstance.vnode.children);
  initComponentProps(componentInstance, componentInstance.vnode.props);
  setupStatefulComponent(componentInstance);
}

function setupStatefulComponent (componentInstance) {
  componentInstance.proxy = new Proxy({ _: componentInstance }, instanceProxyHandler);
  const component = componentInstance.type;
  if (component.setup) {
    setCurrentInstance(componentInstance);
    const setupResult = component.setup(shallowReadonly(componentInstance.props), { emit: componentInstance.emit });
    setCurrentInstance(null);
    handleSetupResult(componentInstance, setupResult);
  }
}

//存放setup的执行结果
function handleSetupResult (instance, setupResult) {
  if (isObject(setupResult)) {
    instance.setupState = setupResult;
  }
  finishComponentSetup(instance);
}

//存储render函数
function finishComponentSetup (instance) {
  const component = instance.type;
  if (component.render) {
    instance.render = component.render;
  }
}

function emit (instance, event) {
  const props = instance.props || {};
  const emitAction = props[event];
  emitAction && emitAction();
}

function createComponentInstance (vnode, parent) {
  const instance = {
    vnode, type: vnode.type, setupState: {}, props: {}, emit: () => {}, slots: {}, provide: {}, parent
  };
  instance.emit = emit.bind(null, instance);
  return instance
}

function mountComponent (vnode, container, parent) {
  const componentInstance = createComponentInstance(vnode, parent);
  setupComponent(componentInstance);
  setupRenderEffect(componentInstance, vnode, container);
}

//调用render函数，并且render函数的指向componentInstance.proxy
function setupRenderEffect (componentInstance, vnode, container) {
  effect(() => {
    const { proxy } = componentInstance;
    const subTree = componentInstance.render.call(proxy, proxy);
    patch(subTree, container, componentInstance);

    vnode.el = subTree.el;
  });
}

function patch (vnode, container, parent) {
  const { type, shapeFlag } = vnode;

  switch (type) {
    case Fragment:
      processFragment(vnode, container);
      break
    case Text:
      processTextNode(vnode, container);
      break
    default:
      if (shapeFlag & ShapeFlags.ELEMENT) {
        processElement(vnode, container);
      } else if (shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
        processComponent(vnode, container, parent);
      }
      break
  }

}

function processFragment (vnode, container) {
  vnode.children.forEach(child => {
    patch(child, container);
  });
}

function processTextNode (vnode, container) {
  const { children } = vnode;
  const textNode = (vnode.el = document.createTextNode(children));
  if (isString(container)) {
    document.querySelector(container).appendChild(textNode);
  } else {
    container.appendChild(textNode);
  }
}

function processElement (vnode, container, parent) {
  mountElement(vnode, container);
}

function processComponent (vnode, container, parent) {
  mountComponent(vnode, container, parent);
}

function render (vnode, rootContainer) {
  patch(vnode, rootContainer);
}

function createApp (rootComponent) {
  return {
    mount (rootContainer) {
      const vnode = createVNode(rootComponent);
      render(vnode, rootContainer);
    }
  }
}

// h函数用来创建vnode

function h$1 (type, props, children) {
  return createVNode(type, props, children)
}

function inject (key) {
  const instance = getCurrentInstance();
  if (instance) {
    if (instance.provide && instance.provide[key]) {
      return instance.provide[key]
    } else if (instance.parent) {
      return injectFromParent(instance.parent, key)
    }
  }
  return null
}

function injectFromParent (parent, key) {
  if (parent.provide && parent.provide[key]) {
    return parent.provide[key]
  } else if (parent.parent) {
    return injectFromParent(parent.parent, key)
  }
  return null
}

function provide (key, value) {
  const instance = getCurrentInstance();
  if (instance) {
    const { provide } = instance;
    provide[key] = value;
  }
}

export { createApp, createTextVNode, getCurrentInstance, h$1 as h, inject, provide, renderSlots };
//# sourceMappingURL=runtime-core.esm-bundler.js.map
