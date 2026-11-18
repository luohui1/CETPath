// Grasso 的 bundle.js 是经典脚本，加载时从 window.React 取 React，所以要先挂上去
import * as React from "react";

(window as unknown as { React: typeof React }).React = React;
