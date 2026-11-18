/*
 * 卷面手势的共享状态。双指缩放由考场在画布上处理，开始时通知每一页的笔记层停笔；
 * 手指点词由考场统一查，记下时间，单词层随后收到的同一下 click 就不再查第二遍。
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export const gesture = { pinching: false, touchLookupAt: 0 };

export function startPinch() {
  gesture.pinching = true;
  for (const f of listeners) f();
}

export function endPinch() {
  gesture.pinching = false;
}

/** 双指缩放开始时调用（笔记层用来丢掉画了一半的笔迹） */
export function onPinchStart(f: Listener) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
